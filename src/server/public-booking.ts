import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { checkAvailability, validStay } from './availability';
import { quoteStay } from './quote';
import { acceptBooking } from './booking-acceptance';
import { publicCatalog } from './public-catalog';
import { browserBinding, openQuoteTicket, sealBookingToken, PublicBookingError, type Receipt } from './public-booking-token';
import type { Locale } from '../i18n/routing';
export const stayInput=z.object({unitId:z.uuid(),arrivalDate:z.string().length(10),departureDate:z.string().length(10),guestCount:z.number().int().positive().safe()}).strict();
export function validatePublicStay(input:unknown) {
  const stay=stayInput.parse(input);
  if(!validStay(stay))throw new PublicBookingError('INVALID_INPUT');
  return stay;
}
/** Read-only catalog/availability/pricing; only shared rate counters mutate at the HTTP boundary. */
export async function previewPublicStay(pool:Pool,input:unknown,browser:string,locale:Locale) {
  const stay=validatePublicStay(input);
  const unit=(await publicCatalog(pool)).find(u=>u.id===stay.unitId);
  if(!unit)throw new PublicBookingError('UNAVAILABLE');
  const availability=await checkAvailability(pool,stay);
  if(!availability.available)throw new PublicBookingError(availability.reason==='INVALID_INPUT'?'INVALID_INPUT':'UNAVAILABLE');
  const quote=await quoteStay(pool,stay);
  const expires=Date.now()+15*60_000;
  const ticket=sealBookingToken({kind:'quote',browser:browserBinding(browser),expires,operationKey:randomUUID(),guestId:randomUUID(),locale,quote});
  return {ticket,unitKey:unit.unit_key,capacity:unit.capacity,arrivalDate:quote.arrivalDate,departureDate:quote.departureDate,
    guestCount:quote.guestCount,nights:quote.lines.length,lines:quote.lines.map(l=>({night:l.localNight,cents:l.amountCents.toString()})),
    totalCents:quote.totalCents.toString(),initialCents:quote.previewSplit.initialCents.toString(),balanceCents:quote.previewSplit.balanceCents.toString(),
    basis:quote.previewSplit.basis,balanceDue:quote.deadlines.balance.toISOString(),evaluatedAt:quote.evaluatedAt.toISOString(),expiresAt:new Date(expires).toISOString()};
}
export type PublicQuote=Awaited<ReturnType<typeof previewPublicStay>>;
export async function acceptPublicStay(pool:Pool,token:string,browser:string) {
  const t=openQuoteTicket(token,browser);
  // The browser supplies no guest identity or personal data. This record is a synthetic marker, as in the existing sandbox fixtures.
  await pool.query('SELECT create_public_synthetic_guest($1,$2)',[t.guestId,t.locale]);
  const accepted=await acceptBooking(pool,{operationKey:t.operationKey,guestId:t.guestId,locale:t.locale,quote:t.quote,
    termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:t.quote.previewSplit.initialCents,syntheticPortfolioOnly:true});
  const receipt:Receipt={kind:'receipt',browser:browserBinding(browser),expires:Date.now()+24*60*60_000,bookingId:accepted.bookingId,guestId:t.guestId,attemptId:accepted.attemptId,accessGeneration:0};
  return {accepted,receipt,locale:t.locale};
}
export async function publicBookingStatus(pool:Pool,receipt:Receipt) {
  const result=await pool.query<{status:string;unit_key:string;arrival_date:string;departure_date:string;guest_count:number;total_cents:string;initial_cents:string;balance_cents:string;balance_due_at:Date}>(`SELECT b.status,u.unit_key,b.arrival_date::text,b.departure_date::text,b.guest_count,
    s.total_cents::text,s.initial_cents::text,s.balance_cents::text,b.balance_due_at FROM bookings b
    JOIN price_snapshots s ON s.booking_id=b.id JOIN accommodation_units u ON u.id=b.unit_id
    JOIN payment_attempts a ON a.booking_id=b.id AND a.id=$3
    LEFT JOIN guest_access_boundaries boundary ON boundary.booking_id=b.id
    WHERE b.id=$1 AND b.guest_id=$2 AND COALESCE(boundary.generation,0)=$4`,[receipt.bookingId,receipt.guestId,receipt.attemptId,receipt.accessGeneration]);
  if(!result.rows[0])throw new PublicBookingError('EXPIRED_QUOTE');
  return result.rows[0];
}
