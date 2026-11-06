import 'server-only';
import { z } from 'zod';
import { stayInput } from './public-booking';
import { StripeAcceptanceError, stripeAcceptanceConfig, authorizeStripeAcceptance,
  createStripeAcceptanceBoundary, type AcceptanceAuthority, type AcceptanceDependencies } from './stripe-acceptance';
import type { ExplicitEnvironment } from '../../scripts/lib/stripe-automation-connection';
import { WebhookInputError } from './stripe-webhooks';

const booking=z.object({stay:stayInput,locale:z.enum(['lt','en','de']),operationKey:z.string().max(160),
  acknowledgedInitialCents:z.string().regex(/^\d{1,15}$/),acceptedTerms:z.literal(true),syntheticOnly:z.literal(true)}).strict();
const headers={'Cache-Control':'no-store'};
async function body(request:Request) {
  const reader=request.body?.getReader();if(!reader)throw new StripeAcceptanceError('INPUT');
  let size=0;const chunks:Uint8Array[]=[];
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>1024*1024)throw new StripeAcceptanceError('INPUT');chunks.push(value);}
    return Buffer.concat(chunks);
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** Unmounted handler factory. No Next.js route imports this module. This is a
 * service-authenticated host acceptance adapter, not a public guest endpoint. */
export function stripeAcceptanceHttp(env:ExplicitEnvironment,authority:AcceptanceAuthority|undefined,deps:AcceptanceDependencies) {
  return async(request:Request):Promise<Response>=>{
    let boundary:Awaited<ReturnType<typeof createStripeAcceptanceBoundary>>|undefined;
    let response:Response;
    try {
      const cfg=stripeAcceptanceConfig(env),token=request.headers.get('authorization');
      authorizeStripeAcceptance(token,cfg);
      const url=new URL(request.url);
      if(request.method!=='POST')return new Response(null,{status:405,headers:{...headers,Allow:'POST'}});
      if(url.origin!==cfg.STRIPE_ACCEPTANCE_ORIGIN || url.search || url.hash || url.username || url.password ||
        request.headers.has('origin') && request.headers.get('origin')!==cfg.STRIPE_ACCEPTANCE_ORIGIN)
        throw new StripeAcceptanceError('INPUT');
      if(!['/api/acceptance/booking','/api/acceptance/stripe/webhook'].includes(url.pathname))
        return Response.json({code:'INACTIVE'},{status:503,headers});
      const raw=await body(request);
      const input=url.pathname==='/api/acceptance/booking'
        ?booking.parse(JSON.parse(raw.toString('utf8'))):undefined;
      if(input && request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new StripeAcceptanceError('INPUT');
      if(!input && !request.headers.get('stripe-signature'))throw new WebhookInputError();
      boundary=await createStripeAcceptanceBoundary(env,authority,token,deps);
      if(input) {
        const quote=await boundary.quote(token,input.stay);
        await boundary.accept(token,{guestId:authority!.guestId,locale:input.locale,quote,operationKey:input.operationKey,
          termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:input.acceptedTerms,
          acknowledgedInitialCents:BigInt(input.acknowledgedInitialCents),syntheticPortfolioOnly:input.syntheticOnly});
      } else {await boundary.webhook(token,raw,request.headers.get('stripe-signature')!);}
      // No Checkout dispatch, return-page payment transition, or automation invocation.
      response=Response.json({status:'RECORDED'},{status:200,headers});
    } catch(error) {
      const status=error instanceof StripeAcceptanceError
        ?error.code==='UNAUTHORIZED'?401:error.code==='INPUT'?400:503
        :error instanceof WebhookInputError || error instanceof z.ZodError || error instanceof SyntaxError?400:503;
      const code=error instanceof StripeAcceptanceError && error.code==='CLEANUP_UNCERTAIN'?'UNCERTAIN'
        :status===401?'UNAUTHORIZED':status===400?'INVALID_INPUT':'UNAVAILABLE';
      response=Response.json({code},{status,headers});
    }
    if(boundary)try {await boundary.close();}catch {return Response.json({code:'UNCERTAIN'},{status:503,headers});}
    return response;
  };
}
