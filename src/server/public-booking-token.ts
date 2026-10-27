import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { accessConfig, credential } from './access';
import { isLocale, type Locale } from '../i18n/routing';
import type { QuotePreview } from './quote';
export class PublicBookingError extends Error {
  constructor(readonly code: 'INVALID_INPUT'|'EXPIRED_QUOTE'|'UNAVAILABLE'|'PAYMENT_UNAVAILABLE') { super(code); }
}
type Ticket = { kind:'quote'; browser:string; expires:number; operationKey:string; guestId:string; locale:Locale; quote:QuotePreview };
export type Receipt = { kind:'receipt'; browser:string; expires:number; bookingId:string; guestId:string; attemptId:string; accessGeneration:0 };
function key() { return createHmac('sha256',accessConfig().key).update('public-booking:v1').digest(); }
export function browserBinding(raw:string) {
  if(!credential.safeParse(raw).success) throw new PublicBookingError('EXPIRED_QUOTE');
  return createHmac('sha256',key()).update(raw).digest('hex');
}
export function sealBookingToken(value:Ticket|Receipt) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
  cipher.setAAD(Buffer.from('zce-public-booking:v1'));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v)),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
function open(raw:string,browser:string):Ticket|Receipt {
  try {
    if(!/^[A-Za-z0-9_-]{50,220000}$/.test(raw))throw new Error();
    const data=Buffer.from(raw,'base64url'),decipher=createDecipheriv('aes-256-gcm',key(),data.subarray(0,12));
    decipher.setAAD(Buffer.from('zce-public-booking:v1'));decipher.setAuthTag(data.subarray(12,28));
    const value=JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString());
    const binding=browserBinding(browser);
    if(typeof value.browser!=='string'||value.browser.length!==binding.length||!timingSafeEqual(Buffer.from(value.browser),Buffer.from(binding))||!Number.isSafeInteger(value.expires)||value.expires<=Date.now())throw new Error();
    return value;
  } catch { throw new PublicBookingError('EXPIRED_QUOTE'); }
}
export function openQuoteTicket(raw:string,browser:string):Ticket {
  const ticket=open(raw,browser);
  if(ticket.kind!=='quote'||!isLocale(ticket.locale))throw new PublicBookingError('EXPIRED_QUOTE');
  const q=ticket.quote;
  q.totalCents=BigInt(q.totalCents);q.accommodationSubtotalCents=BigInt(q.accommodationSubtotalCents);
  q.previewSplit.initialCents=BigInt(q.previewSplit.initialCents);q.previewSplit.balanceCents=BigInt(q.previewSplit.balanceCents);
  q.evaluatedAt=new Date(q.evaluatedAt);
  q.deadlines={...q.deadlines,arrival:new Date(q.deadlines.arrival),warning:new Date(q.deadlines.warning),balance:new Date(q.deadlines.balance),grace:new Date(q.deadlines.grace)};
  q.lines=q.lines.map(l=>({...l,unitCents:BigInt(l.unitCents),amountCents:BigInt(l.amountCents)}));
  return ticket;
}
export function openReceipt(raw:string,browser:string):Receipt {
  const receipt=open(raw,browser);if(receipt.kind!=='receipt')throw new PublicBookingError('EXPIRED_QUOTE');return receipt;
}
