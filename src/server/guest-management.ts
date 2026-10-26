import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AccessDenied, recordAccessDenial, requireSession, issueGuestToken, rateLimit, accessAudit, accessConfig, deny } from './access';
import { paymentPosition } from './payment-position';

/** Explicit projection: no guest contact, provider secrets, internal evidence or audit payload. */
export async function guestBooking(pool:Pool,raw:string,bookingId?:string) {
  const s=await requireSession(pool,raw,'guest','booking:view',bookingId);
  const row=(await pool.query<{id:string;unit_key:string;arrival_date:string;departure_date:string;guest_count:number;status:string;
    accepted_at:Date;warning_at:Date;grace_ends_at:Date;balance_due_at:Date;scheduled_arrival_at:Date;total_cents:string;initial_cents:string;balance_cents:string;locale:'lt'|'en'|'de';terms_version:string;policy_version:string}>(`SELECT b.id,u.unit_key,b.arrival_date::text,b.departure_date::text,b.guest_count,b.status,
    b.accepted_at,b.warning_at,b.grace_ends_at,b.balance_due_at,b.scheduled_arrival_at,p.total_cents::text,p.initial_cents::text,p.balance_cents::text,p.terms_version,p.policy_version,p.locale
    FROM bookings b JOIN price_snapshots p ON p.booking_id=b.id JOIN accommodation_units u ON u.id=b.unit_id
    WHERE b.id=$1 AND b.guest_id=$2`,[s.booking_id,s.guest_id])).rows[0];
  if(!row)return deny(pool,s);
  const lines=(await pool.query<{quantity:number;amount_cents:string;local_night:string}>(`SELECT l.quantity,l.amount_cents::text,l.details->>'localNight' local_night
    FROM price_snapshot_lines l JOIN price_snapshots p ON p.id=l.snapshot_id WHERE p.booking_id=$1 ORDER BY l.line_no`,[row.id])).rows;
  const obligations=(await pool.query<{kind:string;amount_cents:string;paid_cents:string}>(`SELECT o.kind,o.amount_cents::text,
    COALESCE(sum(a.amount_cents),0)::text paid_cents FROM payment_obligations o LEFT JOIN payment_allocations a ON a.obligation_id=o.id
    WHERE o.booking_id=$1 GROUP BY o.id ORDER BY o.kind DESC`,[row.id])).rows;
  const assessment=(await pool.query<{state:string;cap_cents:string;charge_cents:string|null;revision_no:number|null}>(`SELECT a.state,a.cap_cents::text,r.charge_cents::text,r.revision_no
    FROM cancellation_assessments a LEFT JOIN assessment_revisions r ON r.assessment_id=a.id AND r.revision_no=a.current_revision_no WHERE a.booking_id=$1`,[row.id])).rows[0]??null;
  const refunds=(await pool.query<{state:string;requested_cents:string}>(`SELECT a.state,a.requested_cents::text FROM refund_attempts a
    JOIN refund_obligations o ON o.id=a.obligation_id WHERE o.booking_id=$1 ORDER BY a.created_at`,[row.id])).rows;
  await accessAudit(pool,'guest.booking_viewed',s,row.id);
  return {booking:row,lines,obligations,assessment,refunds,position:await paymentPosition(pool,row.id),scopes:s.scopes};
}
export async function queueGuestAccess(pool:Pool,bookingId:string,source:'trusted-notification'|'guest-renewal',authorizationRef:string,guestCredential?:string) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='5s'");
    await c.query('SELECT lock_guest_access($1)',[bookingId]);
    // A renewal authorized before a concurrent revocation cannot queue in the new generation.
    if(source==='guest-renewal')await requireSession(c,guestCredential,'guest','booking:renew',bookingId);
    const b=(await c.query<{guest_id:string;preferred_locale:string}>(`SELECT b.guest_id,g.preferred_locale FROM bookings b JOIN guests g ON g.id=b.guest_id
      WHERE b.id=$1 AND g.retention_state='SYNTHETIC'`,[bookingId])).rows[0];
    if(!b)throw new Error('Synthetic recipient required');
    const audit=await accessAudit(c,'guest.access_requested',undefined,undefined,{source,authorizationRef});
    await c.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,recipient_ref,locale,idempotency_key,due_at,state)
      VALUES($1,$2,$3,'GUEST_ACCESS_LINK','GUEST',$4,$5,$6,clock_timestamp(),'QUEUED') ON CONFLICT(idempotency_key) DO NOTHING`,
      [randomUUID(),bookingId,audit,b.guest_id,b.preferred_locale,`guest-access:${bookingId}:${authorizationRef}`]);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');if(e instanceof AccessDenied)await recordAccessDenial(c,e);throw e;}finally{c.release();}
}
export class GuestAccessRevoked extends Error {}
/** Trusted sandbox worker only. The generation check and token insert share the
 * revocation lock. Tokens exist in memory solely while composing/sending. */
export async function accessLinkForNotice(pool:Pool,notificationId:string,attemptId:string) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='5s'");
    const n=(await c.query<{booking_id:string;guest_access_generation:number|null;event_type:string}>(`SELECT n.booking_id,n.guest_access_generation,n.event_type FROM notification_outbox n JOIN bookings b ON b.id=n.booking_id
      JOIN guests g ON g.id=b.guest_id WHERE n.id=$1 AND n.state='SENDING' AND n.lease_until>clock_timestamp()
      AND n.recipient_kind='GUEST' AND n.recipient_ref=b.guest_id AND g.retention_state='SYNTHETIC'
      AND (SELECT a.id FROM notification_delivery_attempts a WHERE a.notification_id=n.id AND a.result='STARTED'
        ORDER BY a.attempt_no DESC LIMIT 1)=$2 FOR UPDATE OF n`,[notificationId,attemptId])).rows[0];
    if(!n)throw new Error('Authorized delivery lease required');
    const {generation}=(await c.query<{generation:number}>('SELECT lock_guest_access($1) generation',[n.booking_id])).rows[0];
    // Waiting for revocation must not allow an expired delivery attempt to mint a credential.
    if(!(await c.query('SELECT id FROM notification_outbox WHERE id=$1 AND lease_until>clock_timestamp()',[notificationId])).rowCount)
      throw new Error('Authorized delivery lease required');
    if(n.guest_access_generation!==generation){
      if(n.event_type==='GUEST_ACCESS_LINK')throw new GuestAccessRevoked();
      await accessAudit(c,'guest.link_suppressed',undefined,notificationId,{reason:'GUEST_ACCESS_REVOKED'});
      await c.query('COMMIT');
      return null;
    }
    const token=await issueGuestToken(c,n.booking_id);
    await accessAudit(c,'guest.link_issued',undefined,token.id,{notificationRef:notificationId});
    await c.query('COMMIT');
    // Fragment never reaches access logs, request URLs or referrers. Client clears it before POST.
    return `${accessConfig().origin}/manage/access#${token.raw}`;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function renewGuestAccess(pool:Pool,raw:string,operationRef:string=randomUUID()) {
  const s=await requireSession(pool,raw,'guest','booking:renew');
  await rateLimit(pool,`guest-renew:${s.booking_id}`,3,3600);
  await queueGuestAccess(pool,s.booking_id!,'guest-renewal',operationRef,raw);
}
