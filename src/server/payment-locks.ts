import 'server-only';
import type { Pool, PoolClient } from 'pg';

export type InitialContext = {
  bookingId: string; guestId: string; unitId: string; status: string; locale: string;
  splitBasis: 'ADVANCE' | 'FULL';
  holdId: string; holdState: string; claimId: string; claimHoldId: string | null;
  claimBookingId: string | null; claimReleasedAt: Date | null;
  attemptId: string; attemptState: string; expectedCents: bigint; obligationId: string;
  sessionId: string | null; checkoutUrl: string | null; sessionExpiresAt: Date | null;
  paymentIntentId: string | null;
  commandId: string; commandState: string; idempotencyKey: string;
  requestFingerprint: Buffer; requestParams: unknown; firstSubmittedAt: Date | null;
  leaseGeneration: bigint; leaseOwner: string | null; leaseExpiresAt: Date | null;
};

export async function withInitialLock<T>(pool: Pool, attemptId: string,
  work: (client: PoolClient, context: InitialContext) => Promise<T>): Promise<T> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const owner=await client.query<{booking_id:string;guest_id:string;unit_id:string;hold_id:string}>(
      `SELECT b.id booking_id,b.guest_id,b.unit_id,h.id hold_id FROM payment_attempts a
       JOIN bookings b ON b.id=a.booking_id JOIN inventory_holds h ON h.id=a.hold_id
       WHERE a.id=$1`,[attemptId]);
    if (!owner.rows[0]) throw new Error('Initial attempt not found');
    const {booking_id,guest_id,unit_id,hold_id}=owner.rows[0];
    await client.query('SELECT lock_acceptance_context($1,$2)',[unit_id,guest_id]);
    await client.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[booking_id]);
    await client.query('SELECT id FROM inventory_holds WHERE id=$1 FOR UPDATE',[hold_id]);
    await client.query('SELECT id FROM inventory_claims WHERE hold_id=$1 OR origin_hold_id=$1 FOR UPDATE',[hold_id]);
    // Accepted obligations are inserted with the booking and cannot be edited by the runtime role.
    // The booking lock serializes initial-attempt transitions; allocation writers retain their own parent locks.
    await client.query('SELECT id FROM payment_attempts WHERE id=$1 FOR UPDATE',[attemptId]);
    await client.query("SELECT id FROM provider_commands WHERE payment_attempt_id=$1 AND kind='SESSION_CREATE' FOR UPDATE",[attemptId]);
    const result=await client.query<{
      booking_id:string;guest_id:string;unit_id:string;status:string;locale:string;split_basis:'ADVANCE'|'FULL';
      hold_id:string;hold_state:string;claim_id:string;claim_hold_id:string|null;claim_booking_id:string|null;claim_released_at:Date|null;
      attempt_id:string;attempt_state:string;expected_cents:string;obligation_id:string;
      session_id:string|null;checkout_url:string|null;session_expires_at:Date|null;payment_intent_id:string|null;
      command_id:string;command_state:string;idempotency_key:string;request_fingerprint:Buffer;request_params:unknown;
      first_submitted_at:Date|null;lease_generation:string;lease_owner:string|null;lease_expires_at:Date|null;
    }>(`SELECT b.id booking_id,b.guest_id,b.unit_id,b.status,s.locale,s.split_basis,h.id hold_id,h.state hold_state,
      c.id claim_id,c.hold_id claim_hold_id,c.booking_id claim_booking_id,c.released_at claim_released_at,
      a.id attempt_id,a.state attempt_state,a.expected_cents::text,a.obligation_id,
      a.stripe_session_id session_id,a.checkout_url,a.session_expires_at,a.stripe_payment_intent_id payment_intent_id,
      pc.id command_id,pc.state command_state,pc.stripe_idempotency_key idempotency_key,
      pc.request_fingerprint,pc.request_params,pc.first_submitted_at,pc.lease_generation::text,
      pc.lease_owner,pc.lease_expires_at
      FROM payment_attempts a JOIN bookings b ON b.id=a.booking_id
      JOIN price_snapshots s ON s.booking_id=b.id JOIN inventory_holds h ON h.id=a.hold_id
      JOIN inventory_claims c ON c.hold_id=h.id OR c.origin_hold_id=h.id
      JOIN provider_commands pc ON pc.payment_attempt_id=a.id AND pc.kind='SESSION_CREATE'
      WHERE a.id=$1`,[attemptId]);
    const r=result.rows[0];
    if (!r) throw new Error('Incomplete accepted initial attempt');
    const context:InitialContext={bookingId:r.booking_id,guestId:r.guest_id,unitId:r.unit_id,status:r.status,locale:r.locale,splitBasis:r.split_basis,
      holdId:r.hold_id,holdState:r.hold_state,claimId:r.claim_id,claimHoldId:r.claim_hold_id,
      claimBookingId:r.claim_booking_id,claimReleasedAt:r.claim_released_at,attemptId:r.attempt_id,
      attemptState:r.attempt_state,expectedCents:BigInt(r.expected_cents),obligationId:r.obligation_id,
      sessionId:r.session_id,checkoutUrl:r.checkout_url,sessionExpiresAt:r.session_expires_at,
      paymentIntentId:r.payment_intent_id,commandId:r.command_id,commandState:r.command_state,
      idempotencyKey:r.idempotency_key,requestFingerprint:r.request_fingerprint,requestParams:r.request_params,
      firstSubmittedAt:r.first_submitted_at,leaseGeneration:BigInt(r.lease_generation),
      leaseOwner:r.lease_owner,leaseExpiresAt:r.lease_expires_at};
    const value=await work(client,context);
    await client.query('COMMIT');
    return value;
  } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { client.release(); }
}
