import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { authorize, rollbackWithAuthorizationAudit, type InternalAuthority } from './cancellation-authority';
import { reconcileInitialAttempt } from './payment-reconciliation';
import { reconcileBalanceAttempt } from './balance-payment';
import type { StripeGateway } from './stripe-adapter';

export type CancellationResult='CANCELLED'|'ASSESSMENT_PENDING'|'ALREADY_CANCELLED'|'NOT_ELIGIBLE'|'UNCERTAIN';
export type BookingContext={id:string;unit_id:string;guest_id:string;status:string;locale:string;balance_due_at:Date;total_cents:string;arrival_date:string;departure_date:string};
export async function withCancellationLock<T>(pool:Pool,bookingId:string,work:(client:PoolClient,b:BookingContext)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const owner=(await client.query<{unit_id:string;guest_id:string}>('SELECT unit_id,guest_id FROM bookings WHERE id=$1',[bookingId])).rows[0];
    if(!owner)throw new Error('Booking unavailable');
    await client.query('SELECT lock_acceptance_context($1,$2)',[owner.unit_id,owner.guest_id]);
    const b=(await client.query<BookingContext>(`SELECT b.id,b.unit_id,b.guest_id,b.status,b.balance_due_at,
      b.arrival_date::text,b.departure_date::text,s.locale,s.total_cents::text
      FROM bookings b JOIN price_snapshots s ON s.booking_id=b.id WHERE b.id=$1 FOR UPDATE OF b`,[bookingId])).rows[0];
    if(!b)throw new Error('Accepted booking unavailable');
    const value=await work(client,b);
    await client.query('COMMIT');return value;
  }catch(e){await rollbackWithAuthorizationAudit(client,e);throw e;}finally{client.release();}
}
export async function cancellationAudit(client:PoolClient,b:BookingContext,authority:InternalAuthority,action:string,entity:string,entityId:string,details:unknown,amount?:bigint) {
  const id=randomUUID(),d=details as {priorState?:string;newState?:string;reasonCode?:string};
  await client.query(`INSERT INTO audit_events(id,booking_id,unit_id,actor_kind,admin_user_id,guest_id,service_name,
    action,entity_type,entity_id,amount_cents,operation_key,occurred_at,details,prior_state,new_state,reason_code)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp(),$13,$14,$15,$16)`,
    [id,b.id,b.unit_id,authority.kind==='GUEST'?'GUEST':'ADMIN',authority.kind==='OPERATOR'?authority.adminId:null,
      authority.kind==='GUEST'?authority.guestId:null,authority.service,action,entity,entityId,amount?.toString()??null,
      `${action}:${entityId}`,{authorizationRef:authority.authorizationRef,...details as object},d.priorState??null,d.newState??null,d.reasonCode??null]);
  return id;
}
export async function queueCancellationNotice(client:PoolClient,b:BookingContext,auditId:string,event:string,key:string,guestOnly=false) {
  for(const [kind,ref,locale] of [['GUEST',b.guest_id,b.locale],...guestOnly?[]:[['OPERATIONS',null,'en']]])
    await client.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,
      recipient_ref,locale,idempotency_key,due_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),'QUEUED')
      ON CONFLICT(idempotency_key) DO NOTHING`,[randomUUID(),b.id,auditId,event,kind,ref,locale,`${key}:${kind}:${locale}`]);
}

/** Trusted caller only; no HTTP route. The decisive instant is taken under the final booking lock. */
export async function cancelBooking(pool:Pool,gateway:StripeGateway,bookingId:string,authority:InternalAuthority,
  input:{kind:'GUEST'|'PROVIDER';reason:string;testNow?:Date}):Promise<CancellationResult> {
  await authorize(pool,authority,input.kind==='GUEST'?'cancel':'provider',bookingId);
  if(!input.reason.trim()||input.reason.length>500)throw new Error('Cancellation reason required');
  if(input.testNow && (process.env.NODE_ENV!=='test'||!Number.isFinite(input.testNow.getTime())))throw new Error('Invalid test clock');
  const before=(await pool.query<{status:string}>('SELECT status FROM bookings WHERE id=$1',[bookingId])).rows[0];
  const target=input.kind==='GUEST'?'CANCELLED_GUEST':'CANCELLED_PROVIDER';
  if(before?.status===target)return 'ALREADY_CANCELLED';
  if(before?.status!=='CONFIRMED')return 'NOT_ELIGIBLE';
  const started=new Date();
  const attempts=(await pool.query<{id:string;hold_id:string|null;stripe_session_id:string|null}>(
    'SELECT id,hold_id,stripe_session_id FROM payment_attempts WHERE booking_id=$1 ORDER BY id',[bookingId])).rows;
  for(const a of attempts) {
    if(!a.stripe_session_id)return 'UNCERTAIN';
    try {
      const s=await gateway.retrieveSession(a.stripe_session_id);
      if(s.status==='open'&&s.paymentStatus==='unpaid')await gateway.expireSession(s.id,`cancel-expire:${a.id}`);
      const result=await (a.hold_id?reconcileInitialAttempt:reconcileBalanceAttempt)(pool,gateway,a.id);
      if(!['CONFIRMED','ALREADY_RECORDED','PAID_IN_FULL','EXPIRED','FAILED'].includes(result))return 'UNCERTAIN';
    }catch{return 'UNCERTAIN';}
  }
  return withCancellationLock(pool,bookingId,async(client,b)=>{
    await authorize(client,authority,input.kind==='GUEST'?'cancel':'provider',bookingId);
    if(b.status===target)return 'ALREADY_CANCELLED';
    if(b.status!=='CONFIRMED')return 'NOT_ELIGIBLE';
    const claim=(await client.query<{id:string}>('SELECT id FROM inventory_claims WHERE booking_id=$1 AND released_at IS NULL FOR UPDATE',[bookingId])).rows[0];
    const final=(await client.query<{id:string;state:string;checked_at:Date|null;result:string|null}>(`SELECT a.id,a.state,r.checked_at,r.result
      FROM payment_attempts a LEFT JOIN reconciliation_records r ON r.id=a.last_reconciliation_id
      WHERE a.booking_id=$1 ORDER BY a.id FOR UPDATE OF a`,[bookingId])).rows;
    if(!claim||final.length!==attempts.length||final.some((a,i)=>a.id!==attempts[i].id||
      !['SUCCEEDED','EXPIRED','FAILED'].includes(a.state)||
      (a.state!=='SUCCEEDED'&&(!a.checked_at||a.checked_at<started||!['TERMINAL_UNPAID','TERMINAL_FAILED'].includes(a.result??'')))))return 'UNCERTAIN';
    if((await client.query(`SELECT 1 FROM provider_incidents i JOIN payment_attempts a ON
      a.stripe_payment_intent_id=i.stripe_payment_intent_id WHERE a.booking_id=$1 AND i.state<>'RESOLVED'`,[bookingId])).rowCount)return 'UNCERTAIN';
    const now=input.testNow??(await client.query<{now:Date}>('SELECT clock_timestamp() now')).rows[0].now;
    const late=input.kind==='GUEST'&&now>=b.balance_due_at,assessmentId=randomUUID();
    const reason=input.kind==='PROVIDER'?'PROVIDER':late?'GUEST_LATE':'GUEST_EARLY';
    await client.query(`UPDATE inventory_claims SET released_at=$2,release_reason='CANCELLATION_RECONCILED',version=version+1 WHERE id=$1`,[claim.id,now]);
    await client.query(`UPDATE bookings SET status=$2,cancelled_at=$3,cancellation_reason=$4,version=version+1 WHERE id=$1`,[bookingId,target,now,input.reason]);
    await client.query(`INSERT INTO cancellation_assessments(id,booking_id,state,cancelled_at,reason,cap_cents)
      VALUES($1,$2,$3,$4,$5,$6)`,[assessmentId,bookingId,late?'PENDING':'NOT_REQUIRED',now,reason,late?(BigInt(b.total_cents)*30n/100n).toString():'0']);
    if(!late)await client.query(`INSERT INTO refund_obligations(id,booking_id,source_payment_record_id,reason,amount_cents,business_key,currency)
      SELECT gen_random_uuid(),booking_id,id,$2,captured_cents,$3||id::text,'EUR' FROM payment_records WHERE booking_id=$1 AND allocation_state='ALLOCATED'`,
      [bookingId,reason,`cancel:${bookingId}:`]);
    const paid=(await client.query<{paid:string}>('SELECT COALESCE(sum(captured_cents),0)::text paid FROM payment_records WHERE booking_id=$1',[bookingId])).rows[0].paid;
    const audit=await cancellationAudit(client,b,authority,input.kind==='GUEST'?'booking.cancelled_guest':'booking.cancelled_provider','booking',bookingId,
      {priorState:'CONFIRMED',newState:target,decisiveInstant:now.toISOString(),cutoff:b.balance_due_at.toISOString(),zone:'Europe/Vilnius',reason:input.reason,
        assessmentState:late?'ASSESSMENT_PENDING':'NOT_REQUIRED',chargeCents:late?null:'0',verifiedCapturedCents:paid,refundDueCents:late?null:paid,reasonCode:reason,claimId:claim.id},late?undefined:0n);
    await queueCancellationNotice(client,b,audit,late?'CANCELLED_GUEST_LATE':target,`cancel:${audit}`);
    return late?'ASSESSMENT_PENDING':'CANCELLED';
  });
}
