import 'server-only';
import { NextResponse } from 'next/server';
import type { Pool } from 'pg';
import { z } from 'zod';
import { accessConfig, opaque, rateLimit, RateLimited, AccessDenied } from './access';
import { sameOrigin, privateHeaders } from './access-http';
import { previewPublicStay, acceptPublicStay, publicBookingStatus } from './public-booking';
import { openReceipt, PublicBookingError } from './public-booking-token';
import { QuoteError } from './quote';
import { AcceptanceError } from './booking-acceptance';
import { dispatchSessionCreate } from './checkout-worker';
import { stripeGateway } from './stripe-adapter';
import { isLocale, localePath } from '../i18n/routing';
export const bookingCookie=(kind:'browser'|'receipt')=>`${accessConfig().secure?'__Host-':''}zce_booking_${kind}`;
export function bookingCookieValue(request:Request,kind:'browser'|'receipt') {
  const name=bookingCookie(kind);return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1)??'';
}
function setCookie(response:NextResponse,kind:'browser'|'receipt',value:string,maxAge:number) {
  response.cookies.set(bookingCookie(kind),value,{httpOnly:true,secure:accessConfig().secure,sameSite:'lax',path:'/',maxAge});
}
async function body(request:Request) {
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new PublicBookingError('INVALID_INPUT');
  const reader=request.body?.getReader();if(!reader)throw new PublicBookingError('INVALID_INPUT');
  let length=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>240_000){await reader.cancel();throw new PublicBookingError('INVALID_INPUT');}chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function safeCheckoutUrl(raw:string) {
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.port||url.username||url.password)throw new PublicBookingError('PAYMENT_UNAVAILABLE');
  return url.href;
}
export async function publicBookingRequest(pool:Pool,request:Request,action:string) {
  const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:privateHeaders});
  try {
    try { accessConfig(); } catch { return json({code:'RETRY'},503); }
    if(request.method!=='POST')return new NextResponse(null,{status:405,headers:{...privateHeaders,Allow:'POST'}});
    if(!['quote','accept','resume'].includes(action))return json({code:'INVALID_INPUT'},404);
    await sameOrigin(pool,request);
    await rateLimit(pool,'public-booking:global',120);
    const browser=bookingCookieValue(request,'browser')||opaque();
    await rateLimit(pool,`public-booking:${browser}`,20);
    const input=await body(request);
    if(action==='quote') {
      const v=z.object({locale:z.enum(['lt','en','de']),stay:z.unknown()}).strict().parse(input);
      const quote=await previewPublicStay(pool,v.stay,browser,v.locale);
      const response=json(quote);setCookie(response,'browser',browser,86400);return response;
    }
    // Validate test-only configuration before accepting inventory, without contacting Stripe.
    let gateway;
    try { gateway=stripeGateway(); } catch { throw new PublicBookingError('PAYMENT_UNAVAILABLE'); }
    let receipt,locale;
    if(action==='accept') {
      const v=z.object({ticket:z.string().max(220000),acceptedTerms:z.literal(true),acknowledgedPayment:z.literal(true),syntheticOnly:z.literal(true)}).strict().parse(input);
      const result=await acceptPublicStay(pool,v.ticket,browser);receipt=result.receipt;locale=result.locale;
    } else {
      const v=z.object({locale:z.enum(['lt','en','de'])}).strict().parse(input);locale=v.locale;
      receipt=openReceipt(bookingCookieValue(request,'receipt'),browser);
    }
    if(!isLocale(locale))throw new PublicBookingError('INVALID_INPUT');
    const status=await publicBookingStatus(pool,receipt);
    let destination=localePath(locale,'/booking/return');
    // The cookie is narrowly scoped to this initial attempt; it cannot grant management access or create a replacement attempt.
    if(status.status==='AWAITING_INITIAL_PAYMENT') {
      const returnUrl=`${accessConfig().origin}${destination}`;
      try {
      const dispatched=await dispatchSessionCreate(pool,gateway,receipt.attemptId,`public-${receipt.attemptId}`,{successUrl:returnUrl,cancelUrl:returnUrl});
      if(dispatched.status==='READY')destination=safeCheckoutUrl(dispatched.url);
      } catch { /* Acceptance is durable: preserve the receipt and offer recovery for the same attempt. */ }
    }
    const response=json({destination});
    const {sealBookingToken}=await import('./public-booking-token');
    setCookie(response,'receipt',sealBookingToken(receipt),86400);
    return response;
  } catch(error) {
    const code=error instanceof PublicBookingError?error.code:error instanceof RateLimited?'RATE_LIMITED':error instanceof AccessDenied?'INVALID_INPUT':
      error instanceof AcceptanceError?(['STALE_QUOTE','TERMS_CHANGED'].includes(error.code)?'EXPIRED_QUOTE':error.code==='INVENTORY_CONFLICT'?'UNAVAILABLE':'INVALID_INPUT'):
      error instanceof QuoteError?(['RATE_COVERAGE','NO_ACTIVE_TARIFF','INVALID_RATE'].includes(error.code)?'NO_PRICE':error.code==='INVALID_INPUT'?'INVALID_INPUT':'UNAVAILABLE'):
      error instanceof z.ZodError||error instanceof SyntaxError?'INVALID_INPUT':'RETRY';
    return json({code},code==='RATE_LIMITED'?429:code==='RETRY'||code==='PAYMENT_UNAVAILABLE'?503:code==='UNAVAILABLE'||code==='EXPIRED_QUOTE'?409:400);
  }
}
