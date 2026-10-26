import 'server-only';
import type { Pool } from 'pg';
import { z } from 'zod';
import { AccessDenied, recordAccessDenial, requireSession, requireFinance, requireUnit, accessAudit, deny, digest, uuid } from './access';

export async function adminBookings(pool:Pool,raw:string) {
  const s=await requireSession(pool,raw,'admin');
  const rows=(await pool.query<{id:string;unit_key:string;arrival_date:string;departure_date:string;status:string;guest_count:number;total_cents:string}>(`SELECT b.id,u.unit_key,b.arrival_date::text,b.departure_date::text,b.status,b.guest_count,p.total_cents::text
    FROM bookings b JOIN accommodation_units u ON u.id=b.unit_id JOIN price_snapshots p ON p.booking_id=b.id
    WHERE $1 IN ('finance','administrator') OR ($1='operations' AND EXISTS(SELECT 1 FROM admin_unit_access a WHERE a.admin_user_id=$2 AND a.unit_id=b.unit_id))
    ORDER BY b.arrival_date DESC,b.id LIMIT 100`,[s.role,s.admin_user_id])).rows;
  await accessAudit(pool,'admin.bookings_viewed',s);
  return rows;
}
export async function adminBooking(pool:Pool,raw:string,id:string) {
  uuid.parse(id);const s=await requireSession(pool,raw,'admin');
  const b=(await pool.query<{unit_id:string;id:string;status:string;arrival_date:string;departure_date:string}>(
    'SELECT id,unit_id,status,arrival_date::text,departure_date::text FROM bookings WHERE id=$1',[id])).rows[0];
  if(!b)return deny(pool);
  if(s.role==='operations')await requireUnit(pool,s,b.unit_id);
  else if(s.role!=='finance'&&s.role!=='administrator')return deny(pool,s);
  const obligations=(await pool.query<{id:string;kind:string;amount_cents:string;paid_cents:string}>(`SELECT o.id,o.kind,o.amount_cents::text,
    COALESCE(sum(a.amount_cents),0)::text paid_cents FROM payment_obligations o LEFT JOIN payment_allocations a ON a.obligation_id=o.id
    WHERE o.booking_id=$1 GROUP BY o.id ORDER BY o.kind`,[id])).rows;
  const assessments=(await pool.query<{state:string;cap_cents:string;current_revision_no:number|null}>(
    'SELECT state,cap_cents::text,current_revision_no FROM cancellation_assessments WHERE booking_id=$1',[id])).rows;
  const finance=['finance','administrator'].includes(s.role??'');
  const revisions=finance?(await pool.query(`SELECT r.revision_no,r.charge_cents::text,r.supportable_loss_cents::text,r.avoided_costs_cents::text,r.recovered_revenue_cents::text,r.evidence_ref,r.rationale,r.approved_at,r.evidence
    FROM assessment_revisions r JOIN cancellation_assessments a ON a.id=r.assessment_id WHERE a.booking_id=$1 ORDER BY r.revision_no`,[id])).rows:[];
  const refunds=finance?(await pool.query<{id:string;amount_cents:string;reason:string;state:string|null}>(`SELECT o.id,o.amount_cents::text,o.reason,
    (SELECT state FROM refund_attempts WHERE obligation_id=o.id ORDER BY created_at DESC LIMIT 1) state FROM refund_obligations o WHERE o.booking_id=$1 ORDER BY o.created_at`,[id])).rows:[];
  await accessAudit(pool,'admin.booking_viewed',s,id,{finance});
  return {booking:b,obligations,assessments,revisions,refunds,finance};
}
export async function adminIncidents(pool:Pool,raw:string) {
  const s=await requireSession(pool,raw,'admin');
  const incidents=['finance','administrator'].includes(s.role??'')?(await pool.query(`SELECT id,kind,state,opened_at,observed_cents::text FROM provider_incidents
    WHERE state<>'RESOLVED' ORDER BY opened_at DESC LIMIT 100`)).rows:[];
  const notices=(await pool.query<{id:string;event_type:string;state:string;due_at:Date;booking_id:string|null}>(`SELECT n.id,n.event_type,n.state,n.due_at,n.booking_id
    FROM notification_outbox n LEFT JOIN bookings b ON b.id=n.booking_id WHERE n.state IN ('FAILED','RETRY_WAIT') AND
      ($1 IN ('finance','administrator') OR ($1='operations' AND EXISTS(SELECT 1 FROM admin_unit_access a WHERE a.unit_id=b.unit_id AND a.admin_user_id=$2)))
    ORDER BY n.due_at LIMIT 100`,[s.role,s.admin_user_id])).rows;
  await accessAudit(pool,'admin.incidents_viewed',s);
  return {incidents,notices};
}
export async function adminIdentities(pool:Pool,raw:string) {
  const s=await requireSession(pool,raw,'admin');if(s.role!=='administrator')return deny(pool,s);
  await accessAudit(pool,'admin.identities_viewed',s);
  return (await pool.query<{id:string;external_subject:string;role:string;enabled:boolean}>(
    'SELECT id,external_subject,role,enabled FROM admin_users ORDER BY created_at DESC LIMIT 100')).rows;
}
export const identityInput=z.object({id:uuid.nullable(),subject:z.string().min(3).max(500),role:z.enum(['operations','finance','administrator']),
  enabled:z.boolean(),unitIds:z.array(uuid).max(30),operationKey:z.string().regex(/^[a-zA-Z0-9:_-]{8,150}$/),reason:z.string().min(3).max(500)}).strict();
export async function manageIdentity(pool:Pool,raw:string,input:z.infer<typeof identityInput>) {
  const v=identityInput.parse(input),s=await requireSession(pool,raw,'admin');await requireFinance(pool,s);
  if(s.role!=='administrator')return deny(pool,s);
  try {
    return (await pool.query<{id:string}>('SELECT manage_admin_identity($1,$2,$3,$4,$5,$6,$7,$8) id',
      [digest(raw),v.id,v.subject,v.role,v.enabled,v.unitIds.sort(),v.operationKey,v.reason])).rows[0].id;
  }catch(e){
    if(e&&typeof e==='object'&&'code' in e&&e.code==='42501')return deny(pool,s);
    throw e;
  }
}

export async function manageGuestAccess(pool:Pool,raw:string,bookingId:string,operation:'issue'|'revoke',operationKey:string) {
  uuid.parse(bookingId);z.string().uuid().parse(operationKey);
  const c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");
    const s=await requireSession(c,raw,'admin');
    const b=(await c.query<{unit_id:string;guest_id:string;preferred_locale:string}>(`SELECT b.unit_id,b.guest_id,g.preferred_locale FROM bookings b JOIN guests g ON g.id=b.guest_id
      WHERE b.id=$1 AND g.retention_state='SYNTHETIC'`,[bookingId])).rows[0];
    if(!b){await c.query('ROLLBACK');return await deny(c);}
    await requireUnit(c,s,b.unit_id);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`management:${operationKey}`]);
    const fingerprint=`guest-access:${operation}:${bookingId}`;
    const prior=(await c.query<{admin_user_id:string;fingerprint:string}>('SELECT admin_user_id,fingerprint FROM management_commands WHERE operation_key=$1',[operationKey])).rows[0];
    if(prior){if(prior.admin_user_id!==s.admin_user_id||prior.fingerprint!==fingerprint)throw new Error('Operation conflict');await c.query('COMMIT');return;}
    await c.query('SELECT lock_guest_access($1)',[bookingId]);
    const audit=await accessAudit(c,`guest.access_${operation==='issue'?'queued':'revoked'}`,s,bookingId,{operationKey});
    if(operation==='revoke')await c.query('SELECT revoke_guest_access($1)',[bookingId]);
    else await c.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,recipient_ref,locale,idempotency_key,due_at,state)
      VALUES(gen_random_uuid(),$1,$2,'GUEST_ACCESS_LINK','GUEST',$3,$4,$5,clock_timestamp(),'QUEUED')`,[bookingId,audit,b.guest_id,b.preferred_locale,`guest-access:${operationKey}`]);
    await c.query('INSERT INTO management_commands(operation_key,admin_user_id,fingerprint,result) VALUES($1,$2,$3,$4)',[operationKey,s.admin_user_id,fingerprint,{bookingId}]);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');if(e instanceof AccessDenied)await recordAccessDenial(c,e);throw e;}finally{c.release();}
}
