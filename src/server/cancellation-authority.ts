import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/** Assertions from a trusted internal authentication adapter, never request JSON.
 * Milestone 14 must verify credentials before constructing this context. */
export type InternalAuthority = {
  service: string; authorizationRef: string; expiresAt: Date;
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
    const a=await client.query<{role:string}>('SELECT role FROM admin_users WHERE id=$1 AND enabled AND disabled_at IS NULL',[authority.adminId]);
    valid=!!a.rows[0] && (permission==='provider'?['operations','finance','administrator']:['finance','administrator']).includes(a.rows[0].role);
  } else valid=false;
  if (!valid) {
    const error=new AuthorizationDeniedError();
    await recordAuthorizationDenial(client,error);
    throw error;
  }
}
