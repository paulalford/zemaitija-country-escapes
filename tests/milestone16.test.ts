import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { localePath } from '../src/i18n/routing';
import { publicUnitKeys } from '../src/server/public-catalog';
import { previewPublicStay, validatePublicStay } from '../src/server/public-booking';
import { openQuoteTicket, openReceipt, sealBookingToken, browserBinding } from '../src/server/public-booking-token';
import { quoteDeadlines, splitPayment } from '../src/server/quote-math';
import type { QuotePreview } from '../src/server/quote';
import { publicBookingRequest, safeCheckoutUrl } from '../src/server/public-booking-http';
import { acceptBooking, AcceptanceError } from '../src/server/booking-acceptance';
import { dispatchSessionCreate } from '../src/server/checkout-worker';
import { checkAvailability } from '../src/server/availability';
import { quoteStay, QuoteError } from '../src/server/quote';
import { rateLimit, RateLimited } from '../src/server/access';
vi.mock('../src/server/access',async original=>({...await original<typeof import('../src/server/access')>(),rateLimit:vi.fn()}));
vi.mock('../src/server/availability',async original=>({...await original<typeof import('../src/server/availability')>(),checkAvailability:vi.fn()}));
vi.mock('../src/server/quote',async original=>({...await original<typeof import('../src/server/quote')>(),quoteStay:vi.fn()}));
vi.mock('../src/server/booking-acceptance',async original=>({...await original<typeof import('../src/server/booking-acceptance')>(),acceptBooking:vi.fn()}));
vi.mock('../src/server/stripe-adapter',()=>({stripeGateway:vi.fn(()=>({accountId:'acct_test'}))}));
vi.mock('../src/server/checkout-worker',()=>({dispatchSessionCreate:vi.fn()}));
const browser='a'.repeat(43),unitId=randomUUID(),stay={unitId,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2};
const deadlines=quoteDeadlines(stay.arrivalDate),evaluatedAt=new Date('2026-10-26T12:00:00Z');
const q:QuotePreview={...stay,currency:'EUR',provisional:true,unitConfigVersion:1,scheduleId:randomUUID(),scheduleVersion:1,
  accommodationSubtotalCents:54000n,totalCents:54000n,previewSplit:splitPayment(54000n,evaluatedAt,deadlines.balance),deadlines,evaluatedAt,
  lines:['2027-07-02','2027-07-03','2027-07-04'].map((localNight,i)=>({kind:'NIGHT',quantity:1,localNight,dayClass:i<2?'WEEKEND':'WEEKDAY',rateId:randomUUID(),scheduleId:randomUUID(),unitCents:i<2?19000n:16000n,amountCents:i<2?19000n:16000n}))};
function token(){return sealBookingToken({kind:'quote',browser:browserBinding(browser),expires:Date.now()+900000,operationKey:randomUUID(),guestId:randomUUID(),locale:'de',quote:q});}
const query=vi.fn();const pool={query} as unknown as Pool;
function request(input:unknown,origin='http://localhost:3000',cookie=`zce_booking_browser=${browser}`){return new Request('http://localhost:3000/api/booking/quote',{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify(input)});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('APP_ORIGIN','http://localhost:3000');vi.stubEnv('ACCESS_SECRET','ab'.repeat(32));query.mockResolvedValue({rows:[{id:unitId,unit_key:'forest-cottage',capacity:2,attempts:1,status:'AWAITING_INITIAL_PAYMENT'}],rowCount:1});vi.mocked(checkAvailability).mockResolvedValue({available:true,reason:'AVAILABLE'});vi.mocked(quoteStay).mockResolvedValue(structuredClone(q));vi.mocked(dispatchSessionCreate).mockResolvedValue({status:'READY',url:'https://checkout.stripe.com/c/pay/cs_test_demo',sessionId:'cs_test_demo'});vi.mocked(acceptBooking).mockResolvedValue({bookingId:randomUUID(),holdId:randomUUID(),attemptId:randomUUID(),commandId:randomUUID(),snapshotId:randomUUID(),acceptedAt:new Date(),initialCents:16200n,balanceCents:37800n,replayed:false});});
afterEach(()=>vi.unstubAllEnvs());
describe('Public route and input boundary',()=>{
 it.each(['lt','en','de'] as const)('preserves valid stay context for %s',locale=>{expect(localePath(locale,`/booking?unit=${unitId}&arrival=2027-07-02&departure=2027-07-05&guests=2&ticket=secret&email=x`)).toBe(`/${locale}/booking?unit=${unitId}&arrival=2027-07-02&departure=2027-07-05&guests=2`);for(const key of publicUnitKeys)expect(localePath(locale,`/accommodations/${key}`)).toBe(`/${locale}/accommodations/${key}`);});
 it.each(['/accommodations/unknown','/booking/anything','//evil.test','/booking#token'])('rejects unknown or credential-bearing path %s',path=>expect(()=>localePath('en',path)).toThrow());
 it.each([{...stay,guestCount:0},{...stay,guestCount:1.5},{...stay,arrivalDate:'2027-02-30'},{...stay,departureDate:stay.arrivalDate},{...stay,unitId:'forest-cottage'},{...stay,acceptedAt:'2026-01-01'}])('rejects invalid browser stay %j',input=>expect(()=>validatePublicStay(input)).toThrow());
 it('rejects noncatalog UUID without querying availability',async()=>{query.mockResolvedValueOnce({rows:[]});await expect(previewPublicStay(pool,stay,browser,'lt')).rejects.toMatchObject({code:'UNAVAILABLE'});expect(checkAvailability).not.toHaveBeenCalled();});
 it('never substitutes a price for missing tariff coverage',async()=>{vi.mocked(quoteStay).mockRejectedValueOnce(new QuoteError('RATE_COVERAGE'));const result=await publicBookingRequest(pool,request({locale:'en',stay}),'quote');expect(result.status).toBe(400);expect(await result.json()).toEqual({code:'NO_PRICE'});expect(acceptBooking).not.toHaveBeenCalled();});
});
describe('Trusted quote tickets and narrow receipts',()=>{
 it('restores exact bigint prices and server instants',()=>{const opened=openQuoteTicket(token(),browser);expect(opened.quote).toEqual(q);expect(opened.locale).toBe('de');});
 it('cannot move tickets to another browser',()=>expect(()=>openQuoteTicket(token(),'b'.repeat(43))).toThrow());
 it('rejects modified ciphertext and wrong-purpose tokens',()=>{const t=token();expect(()=>openQuoteTicket(t.slice(0,50)+(t[50]==='a'?'b':'a')+t.slice(51),browser)).toThrow();expect(()=>openReceipt(t,browser)).toThrow();});
 it('expires tickets and rejects a rotated key',()=>{const t=token();vi.spyOn(Date,'now').mockReturnValueOnce(Date.now()+1_000_000);expect(()=>openQuoteTicket(t,browser)).toThrow();vi.stubEnv('ACCESS_SECRET','cd'.repeat(32));expect(()=>openQuoteTicket(t,browser)).toThrow();});
 it('returns advisory, serializable server results without acquiring inventory',async()=>{const result=await publicBookingRequest(pool,request({locale:'de',stay}),'quote');const body=await result.json();expect(body).toMatchObject({totalCents:'54000',initialCents:'16200',balanceCents:'37800',nights:3,capacity:2});expect(result.headers.get('set-cookie')).toContain('HttpOnly');expect(result.headers.get('cache-control')).toContain('no-store');expect(acceptBooking).not.toHaveBeenCalled();expect(dispatchSessionCreate).not.toHaveBeenCalled();});
});
describe('Public mutation security and recovery',()=>{
 const acceptInput=()=>({ticket:token(),acceptedTerms:true,acknowledgedPayment:true,syntheticOnly:true});
 it('fails closed when required server configuration is missing',async()=>{vi.stubEnv('ACCESS_SECRET','');const result=await publicBookingRequest(pool,request({locale:'en',stay}),'quote');expect(result.status).toBe(503);expect(quoteStay).not.toHaveBeenCalled();});
 it('rejects cross-origin requests before acceptance',async()=>{const result=await publicBookingRequest(pool,request(acceptInput(),'https://evil.test'),'accept');expect(result.status).toBe(400);expect(acceptBooking).not.toHaveBeenCalled();});
 it('enforces shared rate limiting',async()=>{vi.mocked(rateLimit).mockRejectedValueOnce(new RateLimited());expect((await publicBookingRequest(pool,request(acceptInput()),'accept')).status).toBe(429);expect(acceptBooking).not.toHaveBeenCalled();});
 it.each(['acceptedTerms','acknowledgedPayment','syntheticOnly'])('requires explicit %s',async key=>{const input={...acceptInput(),[key]:false};expect((await publicBookingRequest(pool,request(input),'accept')).status).toBe(400);expect(acceptBooking).not.toHaveBeenCalled();});
 it('rejects browser prices and arbitrary guest identifiers',async()=>{const input={...acceptInput(),guestId:randomUUID(),totalCents:'1'};expect((await publicBookingRequest(pool,request(input),'accept')).status).toBe(400);expect(acceptBooking).not.toHaveBeenCalled();});
 it('reuses the exact trusted acceptance operation and acknowledged cents on retry',async()=>{const input=acceptInput();await publicBookingRequest(pool,request(input),'accept');await publicBookingRequest(pool,request(input),'accept');const first=vi.mocked(acceptBooking).mock.calls[0][1],second=vi.mocked(acceptBooking).mock.calls[1][1];expect(first).toEqual(second);expect(first.acknowledgedInitialCents).toBe(16200n);expect(first.locale).toBe('de');expect(first.quote).toEqual(q);expect(dispatchSessionCreate).toHaveBeenCalledTimes(2);});
 it.each(['TERMS_CHANGED','STALE_QUOTE','INVENTORY_CONFLICT'] as const)('does not dispatch payment after %s',async code=>{vi.mocked(acceptBooking).mockRejectedValueOnce(new AcceptanceError(code));const result=await publicBookingRequest(pool,request(acceptInput()),'accept');expect(result.status).toBe(409);expect(dispatchSessionCreate).not.toHaveBeenCalled();});
 it('preserves an accepted receipt when provider dispatch is uncertain',async()=>{vi.mocked(dispatchSessionCreate).mockRejectedValueOnce(new Error('network unavailable'));const result=await publicBookingRequest(pool,request(acceptInput()),'accept');expect(await result.json()).toEqual({destination:'/de/booking/return'});expect(result.headers.get('set-cookie')).toContain('zce_booking_receipt=');});
 it('does not accept an arbitrary booking id as resume authority',async()=>{expect((await publicBookingRequest(pool,request({locale:'en',bookingId:randomUUID()}),'resume')).status).toBe(400);expect(dispatchSessionCreate).not.toHaveBeenCalled();});
 it('bounds request bodies',async()=>{expect((await publicBookingRequest(pool,request({text:'x'.repeat(240001)}),'quote')).status).toBe(400);expect(quoteStay).not.toHaveBeenCalled();});
 it.each(['http://checkout.stripe.com/x','https://checkout.stripe.com.evil.test/x','https://evil.test/x','https://user@checkout.stripe.com/x'])('rejects unsafe checkout URL %s',url=>expect(()=>safeCheckoutUrl(url)).toThrow());
});
