import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { reconcileBalanceAttempt } from './balance-payment';
import type { StripeGateway } from './stripe-adapter';

export type CancellationOutcome='CANCELLED'|'NOT_ELIGIBLE'|'PAID'|'UNCERTAIN'|'POLICY_GATE'|'ALREADY_CANCELLED';
type Attempt={id:string;state:string;stripe_session_id:string|null;stripe_payment_intent_id:string|null};

/** Manual service command only. The proposed zero-charge policy requires explicit caller approval. */
export async function cancelUnpaidBooking(pool:Pool,gateway:StripeGateway,bookingId:string,
  options:{now?:Date;approveProposedZeroChargePolicy?:boolean}={}):Promise<CancellationOutcome> {
  const now=options.now??new Date();
  if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid instant');
  if (options.now && process.env.NODE_ENV!=='test') throw new Error('Clock override is test-only');
  const initial=await pool.query<{status:string;grace_ends_at:Date}>(`SELECT status,grace_ends_at FROM bookings WHERE id=$1`,[bookingId]);
  const b=initial.rows[0];
  if (!b) return 'NOT_ELIGIBLE';
  if (b.status==='CANCELLED_NONPAYMENT') return 'ALREADY_CANCELLED';
  if (b.status!=='CONFIRMED'||now<b.grace_ends_at) return 'NOT_ELIGIBLE';
  if (!options.approveProposedZeroChargePolicy) return 'POLICY_GATE';
  const reconciliationStartedAt=new Date();

  // Provider calls are outside the database transaction. Every known balance attempt
  // is checked, including terminal rows whose late webhooks may not yet have arrived.
  const attempts=(await pool.query<Attempt>(`SELECT a.id,a.state,a.stripe_session_id,a.stripe_payment_intent_id
    FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id
    WHERE a.booking_id=$1 AND o.kind='BALANCE' ORDER BY a.created_at,a.id`,[bookingId])).rows;
  for (const attempt of attempts) {
    if (!attempt.stripe_session_id) return 'UNCERTAIN';
    try {
      let s=await gateway.retrieveSession(attempt.stripe_session_id);
      if (s.status==='open' && s.paymentStatus==='unpaid') {
        await gateway.expireSession(s.id,`nonpay-expire:${attempt.id}`);
        s=await gateway.retrieveSession(s.id);
      }
      if (s.status==='open' || s.paymentStatus==='paid' && !s.paymentIntentId) return 'UNCERTAIN';
      const reconciled=await reconcileBalanceAttempt(pool,gateway,attempt.id);
      if (['PAID_IN_FULL','ALREADY_RECORDED'].includes(reconciled)) return 'PAID';
      if (!['EXPIRED','FAILED'].includes(reconciled)) return 'UNCERTAIN';
    } catch {return 'UNCERTAIN';}
  }

  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const owner=await client.query<{unit_id:string;guest_id:string;status:string;grace_ends_at:Date}>(
      'SELECT unit_id,guest_id,status,grace_ends_at FROM bookings WHERE id=$1',[bookingId]);
    if (!owner.rows[0]) {await client.query('COMMIT');return 'NOT_ELIGIBLE';}
    await client.query('SELECT lock_acceptance_context($1,$2)',[owner.rows[0].unit_id,owner.rows[0].guest_id]);
    const locked=await client.query<{status:string;grace_ends_at:Date;locale:'lt'|'en'|'de'}>(`SELECT b.status,b.grace_ends_at,s.locale
      FROM bookings b JOIN price_snapshots s ON s.booking_id=b.id WHERE b.id=$1 FOR UPDATE OF b`,[bookingId]);
    const current=locked.rows[0];
    if (current.status!=='CONFIRMED'||now<current.grace_ends_at) {
      await client.query('COMMIT');return current.status==='CANCELLED_NONPAYMENT'?'ALREADY_CANCELLED':'NOT_ELIGIBLE';
    }
    const claim=await client.query<{id:string}>(`SELECT id FROM inventory_claims
      WHERE booking_id=$1 AND released_at IS NULL FOR UPDATE`,[bookingId]);
    if (claim.rowCount!==1) {await client.query('COMMIT');return 'UNCERTAIN';}
    const obligations=await client.query<{id:string;amount_cents:string;allocated:string}>(`SELECT o.id,o.amount_cents::text,
      COALESCE((SELECT sum(pa.amount_cents) FROM payment_allocations pa WHERE pa.obligation_id=o.id),0)::text allocated
      FROM payment_obligations o WHERE o.booking_id=$1 AND o.kind='BALANCE'`,[bookingId]);
    const due=obligations.rows[0];
    if (!due||BigInt(due.amount_cents)<=0n) {await client.query('COMMIT');return 'NOT_ELIGIBLE';}
    if (BigInt(due.allocated)>0n) {await client.query('COMMIT');return 'PAID';}
    const finalAttempts=await client.query<{id:string;state:string;last_result:string|null;checked_at:Date|null}>(`SELECT a.id,a.state,r.result last_result,r.checked_at
      FROM payment_attempts a LEFT JOIN reconciliation_records r ON r.id=a.last_reconciliation_id
      WHERE a.obligation_id=$1 ORDER BY a.created_at,a.id FOR UPDATE OF a`,[due.id]);
    if (finalAttempts.rows.length!==attempts.length || finalAttempts.rows.some((a,i)=>a.id!==attempts[i].id ||
        !['EXPIRED','FAILED'].includes(a.state) || !['TERMINAL_UNPAID','TERMINAL_FAILED'].includes(a.last_result??'') ||
        !a.checked_at || a.checked_at<reconciliationStartedAt)) {
      await client.query('COMMIT');return 'UNCERTAIN';
    }
    const suspicious=await client.query<{count:string}>(`SELECT count(*)::text count FROM provider_incidents i
      JOIN payment_attempts a ON a.stripe_payment_intent_id=i.stripe_payment_intent_id
      WHERE a.booking_id=$1 AND i.state='OPEN'`,[bookingId]);
    if (BigInt(suspicious.rows[0].count)>0n) {await client.query('COMMIT');return 'UNCERTAIN';}
    const paid=await client.query<{id:string;captured_cents:string}>(`SELECT p.id,p.captured_cents::text
      FROM payment_records p WHERE p.booking_id=$1 AND p.allocation_state='ALLOCATED' ORDER BY p.id`,[bookingId]);
    const auditId=randomUUID();
    await client.query(`UPDATE inventory_claims SET released_at=$2,release_reason='NONPAYMENT_RECONCILED',version=version+1 WHERE id=$1`,[claim.rows[0].id,now]);
    await client.query(`UPDATE bookings SET status='CANCELLED_NONPAYMENT',cancelled_at=$2,
      cancellation_reason='BALANCE_UNPAID_RECONCILED',version=version+1 WHERE id=$1`,[bookingId,now]);
    await client.query(`INSERT INTO cancellation_assessments(id,booking_id,state,cancelled_at,reason,cap_cents)
      VALUES($1,$2,'NOT_REQUIRED',$3,'NONPAYMENT',0)`,[randomUUID(),bookingId,now]);
    for (const p of paid.rows) await client.query(`INSERT INTO refund_obligations(id,booking_id,source_payment_record_id,
      reason,amount_cents,business_key,currency) VALUES($1,$2,$3,'NONPAYMENT_ZERO_CHARGE',$4,$5,'EUR')
      ON CONFLICT(business_key) DO NOTHING`,[randomUUID(),bookingId,p.id,p.captured_cents,`nonpay:${bookingId}:${p.id}`]);
    await client.query(`INSERT INTO audit_events(id,booking_id,unit_id,actor_kind,service_name,action,
      entity_type,entity_id,prior_state,new_state,operation_key,reason_code,occurred_at,details)
      VALUES($1,$2,$3,'SERVICE','nonpayment-cancellation','booking.cancelled_nonpayment','booking',$2,
      'CONFIRMED','CANCELLED_NONPAYMENT',$4,'BALANCE_UNPAID_RECONCILED',$5,$6)`,
      [auditId,bookingId,owner.rows[0].unit_id,`nonpay-cancel:${bookingId}`,now,{claimId:claim.rows[0].id,refundObligations:paid.rows.length}]);
    for (const [kind,locale,ref] of [['GUEST',current.locale,owner.rows[0].guest_id],['OPERATIONS','en',null]] as const)
      await client.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,
        recipient_kind,recipient_ref,locale,idempotency_key,due_at,state)
        VALUES($1,$2,$3,'CANCELLED_NONPAYMENT',$4,$5,$6,$7,$8,'QUEUED')
        ON CONFLICT(idempotency_key) DO NOTHING`,[randomUUID(),bookingId,auditId,kind,ref,locale,`nonpay-cancel:${auditId}:${kind}`,now]);
    await client.query('COMMIT');return 'CANCELLED';
  } catch(e) {await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally {client.release();}
}

/** Deterministic bounded list for manual review; never cancels by itself. */
export async function previewNonpaymentCandidates(pool:Pool,now=new Date(),limit=25) {
  if (!Number.isFinite(now.getTime())||!Number.isInteger(limit)||limit<1||limit>100) throw new RangeError('Invalid preview');
  return (await pool.query<{id:string;grace_ends_at:Date}>(`SELECT b.id,b.grace_ends_at FROM bookings b
    JOIN payment_obligations o ON o.booking_id=b.id AND o.kind='BALANCE' AND o.amount_cents>0
    WHERE b.status='CONFIRMED' AND b.grace_ends_at<=$1 AND o.amount_cents>
      COALESCE((SELECT sum(pa.amount_cents) FROM payment_allocations pa WHERE pa.obligation_id=o.id),0)
    ORDER BY b.grace_ends_at,b.id LIMIT $2`,[now,limit])).rows;
}
