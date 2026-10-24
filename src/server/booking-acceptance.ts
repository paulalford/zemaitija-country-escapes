import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { validStay } from './availability';
import { quoteInTransaction, QuoteError, type QuotePreview } from './quote';
import { splitPayment } from './quote-math';

export type AcceptanceRequest = {
  operationKey: string;
  guestId: string;
  locale: 'lt' | 'en' | 'de';
  quote: QuotePreview;
  termsVersion: 'SYNTHETIC_TEST_TERMS_V1';
  acceptedTerms: true;
  acknowledgedInitialCents: bigint;
  syntheticPortfolioOnly: true;
};
export type AcceptanceResult = { bookingId: string; holdId: string; attemptId: string; commandId: string; snapshotId: string; acceptedAt: Date; initialCents: bigint; balanceCents: bigint; replayed: boolean };
export class AcceptanceError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'STALE_QUOTE' | 'TERMS_CHANGED' | 'IDEMPOTENCY_CONFLICT' | 'INVENTORY_CONFLICT' | 'GUEST_UNTRUSTED', message = code) { super(message); }
}
type Options = { /** Only honored under Vitest's NODE_ENV=test; never use for production acceptance. */ testAcceptanceInstant?: Date; failAfter?: 'CLAIM' };
const policyVersion = 'PROVISIONAL_D17_TEST_ONLY';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonical = (request: AcceptanceRequest) => JSON.stringify({
  guestId: request.guestId, locale: request.locale, unitId: request.quote.unitId,
  arrivalDate: request.quote.arrivalDate, departureDate: request.quote.departureDate, guestCount: request.quote.guestCount,
  scheduleId: request.quote.scheduleId, scheduleVersion: request.quote.scheduleVersion, unitConfigVersion: request.quote.unitConfigVersion,
  totalCents: request.quote.totalCents.toString(),
  lines: request.quote.lines.map(l => [l.localNight,l.dayClass,l.rateId,l.scheduleId,l.unitCents.toString(),l.amountCents.toString()]),
  termsVersion: request.termsVersion, acceptedTerms: request.acceptedTerms,
  acknowledgedInitialCents: request.acknowledgedInitialCents.toString(), syntheticPortfolioOnly: request.syntheticPortfolioOnly,
});
const digest = (value: string) => createHash('sha256').update(value).digest();
const sameQuote = (a: QuotePreview, b: QuotePreview) => a.unitConfigVersion === b.unitConfigVersion && a.scheduleId === b.scheduleId && a.scheduleVersion === b.scheduleVersion && a.totalCents === b.totalCents && a.accommodationSubtotalCents === b.accommodationSubtotalCents && a.currency === 'EUR' && a.lines.length === b.lines.length && a.lines.every((line, i) => {
  const other = b.lines[i];
  return line.kind === 'NIGHT' && line.quantity === 1 && line.localNight === other.localNight && line.dayClass === other.dayClass && line.rateId === other.rateId && line.scheduleId === other.scheduleId && line.unitCents === other.unitCents && line.amountCents === other.amountCents;
});

async function prior(client: PoolClient, key: string, fingerprint: Buffer): Promise<AcceptanceResult | null> {
  const found = await client.query<{ booking_id: string; snapshot_id: string; hold_id: string; attempt_id: string; command_id: string; accepted_at: Date; initial_cents: string; balance_cents: string; request_fingerprint: Buffer }>(
    `SELECT b.id booking_id,s.id snapshot_id,h.id hold_id,a.id attempt_id,c.id command_id,b.accepted_at,s.initial_cents::text,s.balance_cents::text,c.request_fingerprint
     FROM price_snapshots s JOIN bookings b ON b.id=s.booking_id JOIN inventory_holds h ON h.booking_id=b.id
     JOIN payment_attempts a ON a.id=h.payment_attempt_id JOIN provider_commands c ON c.payment_attempt_id=a.id AND c.kind='SESSION_CREATE'
     WHERE s.quote_operation_key=$1`, [key]);
  const row = found.rows[0];
  if (!row) return null;
  if (!row.request_fingerprint.equals(fingerprint)) throw new AcceptanceError('IDEMPOTENCY_CONFLICT');
  return { bookingId: row.booking_id, snapshotId: row.snapshot_id, holdId: row.hold_id, attemptId: row.attempt_id, commandId: row.command_id, acceptedAt: row.accepted_at, initialCents: BigInt(row.initial_cents), balanceCents: BigInt(row.balance_cents), replayed: true };
}

/** Internal synthetic-only acceptance. Caller must supply a trusted server preview and synthetic guest. */
export async function acceptBooking(pool: Pool, request: AcceptanceRequest, options: Options = {}): Promise<AcceptanceResult> {
  if ((options.testAcceptanceInstant || options.failAfter) && process.env.NODE_ENV !== 'test') throw new AcceptanceError('INVALID_INPUT');
  const q = request.quote;
  if (!request.syntheticPortfolioOnly || request.acceptedTerms !== true || request.termsVersion !== 'SYNTHETIC_TEST_TERMS_V1' ||
      !['lt','en','de'].includes(request.locale) || !uuid.test(request.guestId) || !validStay(q) ||
      !/^[A-Za-z0-9:_-]{16,160}$/.test(request.operationKey) || q.provisional !== true ||
      typeof request.acknowledgedInitialCents !== 'bigint' || request.acknowledgedInitialCents < 0n) throw new AcceptanceError('INVALID_INPUT');
  const fingerprint = digest(canonical(request));
  for (let retry = 0; retry < 3; retry++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      // Unit is the first domain row lock. Advisory serialization is only for this operation key.
      const unit = await client.query<{locked:boolean}>('SELECT lock_acceptance_context($1,$2) locked', [q.unitId,request.guestId]);
      if (!unit.rows[0]?.locked) throw new AcceptanceError('STALE_QUOTE');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [request.operationKey]);
      const replay = await prior(client, request.operationKey, fingerprint);
      if (replay) { await client.query('COMMIT'); return replay; }
      const guest = await client.query<{ preferred_locale: string; retention_state: string }>('SELECT preferred_locale,retention_state FROM guests WHERE id=$1', [request.guestId]);
      if (guest.rows[0]?.retention_state !== 'SYNTHETIC' || guest.rows[0]?.preferred_locale !== request.locale) throw new AcceptanceError('GUEST_UNTRUSTED');
      // The lock capability holds the active schedule against concurrent retirement.
      let current: QuotePreview;
      try { current = await quoteInTransaction(client, { unitId:q.unitId, arrivalDate:q.arrivalDate, departureDate:q.departureDate, guestCount:q.guestCount }, new Date()); }
      catch (error) { if (error instanceof QuoteError) throw new AcceptanceError('STALE_QUOTE'); throw error; }
      if (!sameQuote(q,current) || current.totalCents <= 0n) throw new AcceptanceError('STALE_QUOTE');
      const instant = options.testAcceptanceInstant
        ? options.testAcceptanceInstant
        : (await client.query<{ instant: Date }>('SELECT clock_timestamp() AS instant')).rows[0].instant;
      if (!Number.isFinite(instant.getTime())) throw new AcceptanceError('INVALID_INPUT');
      const split = splitPayment(current.totalCents, instant, current.deadlines.balance);
      if (split.initialCents !== request.acknowledgedInitialCents) throw new AcceptanceError('TERMS_CHANGED');
      const [bookingId,snapshotId,initialId,balanceId,holdId,claimId,attemptId,commandId,auditId] = Array.from({length:9}, () => randomUUID());
      const d = current.deadlines;
      await client.query(`INSERT INTO bookings(id,guest_id,unit_id,arrival_date,departure_date,guest_count,status,version,accepted_at,check_in_local_time,property_zone,scheduled_arrival_at,warning_at,balance_due_at,grace_ends_at)
        VALUES($1,$2,$3,$4,$5,$6,'AWAITING_INITIAL_PAYMENT',1,$7,'15:00','Europe/Vilnius',$8,$9,$10,$11)`, [bookingId,request.guestId,q.unitId,q.arrivalDate,q.departureDate,q.guestCount,instant,d.arrival,d.warning,d.balance,d.grace]);
      await client.query(`INSERT INTO price_snapshots(id,booking_id,rate_schedule_version_id,accepted_at,terms_version,policy_version,locale,currency,total_cents,initial_cents,balance_cents,split_basis,quote_operation_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,'EUR',$8,$9,$10,$11,$12)`, [snapshotId,bookingId,q.scheduleId,instant,request.termsVersion,policyVersion,request.locale,current.totalCents.toString(),split.initialCents.toString(),split.balanceCents.toString(),split.basis,request.operationKey]);
      for (const [index,line] of current.lines.entries()) await client.query(`INSERT INTO price_snapshot_lines(id,snapshot_id,line_no,kind,description_key,quantity,unit_cents,amount_cents,details)
        VALUES($1,$2,$3,'NIGHT','accommodation.night',1,$4,$5,$6)`, [randomUUID(),snapshotId,index+1,line.unitCents.toString(),line.amountCents.toString(),{localNight:line.localNight,dayClass:line.dayClass,rateId:line.rateId,scheduleId:line.scheduleId}]);
      await client.query(`INSERT INTO payment_obligations(id,booking_id,kind,amount_cents,due_at,currency) VALUES
        ($1,$2,'INITIAL',$3,$4,'EUR'),($5,$2,'BALANCE',$6,$7,'EUR')`, [initialId,bookingId,split.initialCents.toString(),instant,balanceId,split.balanceCents.toString(),d.balance]);
      await client.query("INSERT INTO inventory_holds(id,booking_id,state,started_at,version) VALUES($1,$2,'CREATING',$3,1)", [holdId,bookingId,instant]);
      await client.query("INSERT INTO inventory_claims(id,unit_id,arrival_date,departure_date,hold_id,version) VALUES($1,$2,$3,$4,$5,1)", [claimId,q.unitId,q.arrivalDate,q.departureDate,holdId]);
      if (options.failAfter === 'CLAIM') throw new Error('test transaction interruption');
      await client.query("INSERT INTO payment_attempts(id,booking_id,obligation_id,hold_id,state,expected_cents,currency,version) VALUES($1,$2,$3,$4,'CREATING',$5,'EUR',1)", [attemptId,bookingId,initialId,holdId,split.initialCents.toString()]);
      await client.query('UPDATE inventory_holds SET payment_attempt_id=$1 WHERE id=$2', [attemptId,holdId]);
      await client.query(`INSERT INTO provider_commands(id,kind,payment_attempt_id,logical_key,stripe_idempotency_key,request_fingerprint,state)
        VALUES($1,'SESSION_CREATE',$2,$3,$4,$5,'PENDING')`, [commandId,attemptId,`session-create:${request.operationKey}`,`session-create:${attemptId}`,fingerprint]);
      await client.query(`INSERT INTO audit_events(id,booking_id,unit_id,actor_kind,guest_id,action,entity_type,entity_id,new_state,amount_cents,operation_key,reason_code,occurred_at,details)
        VALUES($1,$2,$3,'SERVICE',$4,'quote.accepted','booking',$2,'AWAITING_INITIAL_PAYMENT',$5,$6,'SYNTHETIC_PORTFOLIO',$7,$8)`, [auditId,bookingId,q.unitId,request.guestId,current.totalCents.toString(),request.operationKey,instant,{locale:request.locale,policyVersion,termsVersion:request.termsVersion,holdId,attemptId}]);
      await client.query('COMMIT');
      return { bookingId,holdId,attemptId,commandId,snapshotId,acceptedAt:instant,initialCents:split.initialCents,balanceCents:split.balanceCents,replayed:false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      const code = (error as {code?: string}).code;
      if (code === '40P01' && retry < 2) continue;
      if (code === '23P01') throw new AcceptanceError('INVENTORY_CONFLICT');
      throw error;
    } finally { client.release(); }
  }
  throw new Error('Deadlock retry exhausted');
}
