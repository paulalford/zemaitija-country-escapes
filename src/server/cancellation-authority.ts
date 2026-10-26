import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/** Assertions from a trusted internal authentication adapter, never request JSON.
 * Milestone 14 must verify credentials before constructing this context. */
export type InternalAuthority = {
  service: string; authorizationRef: string; expiresAt: Date; sessionId?:string;
} & ({ kind:'GUEST'; guestId:string; bookingId:string; scope:'booking:cancel' } |
     { kind:'OPERATOR'; adminId:string });
export class AuthorizationDeniedError extends Error {
  readonly auditId=randomUUID();
  readonly occurredAt=new Date();
  constructor() { super('Cancellation/finance authority denied'); }
}
async function recordAuthorizationDenial(client:Pool|PoolClient,error:AuthorizationDeniedError) {
  await client.query(`INSERT INTO audit_events(id,actor_kind,service_name,action,entity_type,reason_code,occurred_at)
    VALUES($1,'SERVICE','cancellation-authority','authorization.denied','authorization','INVALID_SCOPE_OR_AUTHORITY',$2)
    ON CONFLICT(id) DO NOTHING`,[error.auditId,error.occurredAt]);
}
/** Reuse the checked-out connection only after rollback succeeds, so no denied domain work can commit.
 * The same event ID makes the post-rollback write idempotent without another pool connection. */
export async function rollbackWithAuthorizationAudit(client:PoolClient,error:unknown) {
  await client.query('ROLLBACK');
  if(error instanceof AuthorizationDeniedError)await recordAuthorizationDenial(client,error);
}
export async function authorize(client:Pool|PoolClient,authority:InternalAuthority,permission:'cancel'|'provider'|'finance',bookingId?:string) {
  let valid=authority && /^[a-z0-9:_-]{3,100}$/i.test(authority.service) &&
    /^[a-z0-9:_-]{3,200}$/i.test(authority.authorizationRef) && authority.expiresAt instanceof Date &&
    authority.expiresAt.getTime()>Date.now() && authority.expiresAt.getTime()<=Date.now()+15*60_000;
  if (valid && authority.kind==='GUEST') {
    valid=permission==='cancel' && authority.scope==='booking:cancel' && authority.bookingId===bookingId &&
      !!(await client.query('SELECT id FROM bookings WHERE id=$1 AND guest_id=$2',[bookingId,authority.guestId])).rowCount;
  } else if (valid && authority.kind==='OPERATOR') {
    if(authority.sessionId)await client.query('SELECT lock_admin_identity($1)',[authority.adminId]);
    const a=await client.query<{role:string}>('SELECT role FROM admin_users WHERE id=$1 AND enabled AND disabled_at IS NULL',[authority.adminId]);
    valid=!!a.rows[0] && (permission==='provider'?['operations','finance','administrator']:['finance','administrator']).includes(a.rows[0].role);
  } else valid=false;
  // HTTP adapters bind assertions to a live database session. Legacy internal workers
  // retain their existing trusted-service contract; no route accepts these objects.
  if(valid && authority.sessionId) {
    const live=await client.query(`SELECT s.id FROM access_sessions s
      LEFT JOIN guest_access_tokens t ON t.id=s.guest_token_id LEFT JOIN bookings b ON b.id=t.booking_id
      LEFT JOIN admin_users a ON a.id=s.admin_user_id WHERE s.id=$1 AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() AND s.last_used_at>clock_timestamp()-interval '30 minutes'
      AND ((s.admin_user_id=$2 AND a.enabled AND a.disabled_at IS NULL AND a.auth_version=s.admin_version
        AND ($5<>'finance' OR s.authenticated_at>clock_timestamp()-interval '10 minutes')
        AND ($5<>'provider' OR a.role<>'operations' OR EXISTS(SELECT 1 FROM admin_unit_access ua
          JOIN bookings target ON target.unit_id=ua.unit_id WHERE target.id=$4 AND ua.admin_user_id=a.id)))
      OR (b.guest_id=$3 AND t.booking_id=$4 AND t.revoked_at IS NULL AND 'booking:cancel'=ANY(s.scopes)
        AND EXISTS(SELECT 1 FROM access_actions x WHERE x.id::text=$6 AND x.session_id=s.id AND x.booking_id=$4
          AND x.operation='booking:cancel' AND x.consumed_at IS NOT NULL AND x.expires_at>clock_timestamp())))`,
      [authority.sessionId,authority.kind==='OPERATOR'?authority.adminId:null,authority.kind==='GUEST'?authority.guestId:null,
        bookingId??null,permission,authority.authorizationRef]);
    valid=!!live.rowCount;
  }
  if (!valid) {
    const error=new AuthorizationDeniedError();
    await recordAuthorizationDenial(client,error);
    throw error;
  }
}
