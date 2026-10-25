import 'server-only';
import type { Pool } from 'pg';

export type PaymentPosition='INITIAL_DUE'|'BALANCE_DUE'|'OVERDUE'|'PAID_IN_FULL'|'PAYMENT_INCIDENT'|'ASSESSMENT_PENDING'|'REFUND_DUE'|'REFUNDED_PARTIAL'|'REFUNDED_FULL'|'CANCELLATION_SETTLED';

/** A ledger projection; booking status and inventory ownership remain independent. */
export async function paymentPosition(pool:Pool,bookingId:string,at=new Date()):Promise<{
  position:PaymentPosition;paidCents:bigint;outstandingCents:bigint;refundedCents:bigint;refundDueCents:bigint;additionalChargeReviewCents:bigint;balanceDueAt:Date;graceEndsAt:Date}|null> {
  if (!Number.isFinite(at.getTime())) throw new RangeError('Invalid instant');
  const result=await pool.query<{status:string;total_cents:string;initial_cents:string;balance_cents:string;
    paid_cents:string;initial_paid:string;balance_paid:string;incident_count:string;
    balance_due_at:Date;grace_ends_at:Date}>(`SELECT b.status,s.total_cents::text,s.initial_cents::text,s.balance_cents::text,
    COALESCE(sum(pa.amount_cents),0)::text paid_cents,
    COALESCE(sum(pa.amount_cents) FILTER (WHERE o.kind='INITIAL'),0)::text initial_paid,
    COALESCE(sum(pa.amount_cents) FILTER (WHERE o.kind='BALANCE'),0)::text balance_paid,
    (SELECT count(*)::text FROM provider_incidents i JOIN payment_attempts a
      ON a.stripe_payment_intent_id=i.stripe_payment_intent_id WHERE a.booking_id=b.id AND i.state='OPEN') incident_count,
    b.balance_due_at,b.grace_ends_at
    FROM bookings b JOIN price_snapshots s ON s.booking_id=b.id
    JOIN payment_obligations o ON o.booking_id=b.id
    LEFT JOIN payment_allocations pa ON pa.obligation_id=o.id
    WHERE b.id=$1 GROUP BY b.id,s.id`,[bookingId]);
  const r=result.rows[0]; if (!r) return null;
  const paid=BigInt(r.paid_cents),total=BigInt(r.total_cents);
  let position:PaymentPosition;
  const cancellation=(await pool.query<{state:string;charge:string;owed:string;refunded:string}>(`SELECT ca.state,
    COALESCE(ar.charge_cents,0)::text charge,
    COALESCE((SELECT sum(amount_cents) FROM refund_obligations WHERE booking_id=$1),0)::text owed,
    COALESCE((SELECT sum(refunded_cents) FROM refund_records WHERE booking_id=$1),0)::text refunded
    FROM cancellation_assessments ca LEFT JOIN assessment_revisions ar ON ar.assessment_id=ca.id AND ar.revision_no=ca.current_revision_no
    WHERE ca.booking_id=$1`,[bookingId])).rows[0];
  const refunded=BigInt(cancellation?.refunded??'0'),refundDue=BigInt(cancellation?.owed??'0')-refunded;
  if(r.status.startsWith('CANCELLED_')&&cancellation) {
    if(BigInt(r.incident_count)>0n)position='PAYMENT_INCIDENT';
    else if(['PENDING','REVISION_PENDING'].includes(cancellation.state))position='ASSESSMENT_PENDING';
    else if(refundDue>0n)position=refunded>0n?'REFUNDED_PARTIAL':'REFUND_DUE';
    else if(refunded>0n)position=refunded===paid?'REFUNDED_FULL':'REFUNDED_PARTIAL';
    else position='CANCELLATION_SETTLED';
    const charge=BigInt(cancellation.charge);
    return {position,paidCents:paid,outstandingCents:0n,refundedCents:refunded,refundDueCents:refundDue,
      additionalChargeReviewCents:charge>paid?charge-paid:0n,balanceDueAt:r.balance_due_at,graceEndsAt:r.grace_ends_at};
  }
  if (BigInt(r.incident_count)>0n) position='PAYMENT_INCIDENT';
  else if (paid===total) position='PAID_IN_FULL';
  else if (BigInt(r.initial_paid)<BigInt(r.initial_cents)) position='INITIAL_DUE';
  else position=at.getTime()>r.balance_due_at.getTime()?'OVERDUE':'BALANCE_DUE';
  return {position,paidCents:paid,outstandingCents:total-paid,refundedCents:refunded,refundDueCents:refundDue,additionalChargeReviewCents:0n,balanceDueAt:r.balance_due_at,graceEndsAt:r.grace_ends_at};
}
