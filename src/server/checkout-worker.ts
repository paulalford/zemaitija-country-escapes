import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { commandRetrySeconds, sessionSubmissionGate } from './checkout-command-scheduling';
import { batchLimit, workCounts, type RecoveryOptions, type WorkCounts } from './payment-recovery';
import { z } from 'zod';
import { withInitialLock } from './payment-locks';
import type { CheckoutRequest, CheckoutSession, StripeGateway } from './stripe-adapter';
import { dispatchBalanceSessionCreate } from './balance-payment';

const requestSchema=z.object({
  correlation:z.object({bookingId:z.uuid(),holdId:z.uuid(),attemptId:z.uuid(),commandId:z.uuid()}),
  amountCents:z.number().int().positive().safe(),expiresAt:z.number().int().positive(),
  successUrl:z.url(),cancelUrl:z.url(),idempotencyKey:z.string().min(1),
  paymentPurpose:z.enum(['INITIAL_ADVANCE','INITIAL_FULL']).optional(),
});
type Lease={request:CheckoutRequest;generation:bigint;attemptId:string;commandId:string};
export type CheckoutDispatch = {status:'READY';url:string;sessionId:string} | {status:'PENDING'|'QUARANTINED';retryScheduled?:boolean};

function validateSession(session: CheckoutSession, request: CheckoutRequest, accountId: string) {
  const c=request.correlation;
  if (session.livemode || session.accountId!==accountId || !session.id.startsWith('cs_test_') || session.mode!=='payment' ||
      session.paymentMethodTypes.length!==1 || session.paymentMethodTypes[0]!=='card' ||
      session.amountTotal!==request.amountCents || session.currency!=='eur' ||
      session.clientReferenceId!==c.bookingId ||
      session.metadata.bookingId!==c.bookingId || session.metadata.holdId!==c.holdId ||
      session.metadata.attemptId!==c.attemptId || session.metadata.commandId!==c.commandId ||
      !Number.isInteger(session.created) || !Number.isInteger(session.expiresAt) ||
      session.expiresAt-session.created<29*60 || session.expiresAt-session.created>31*60) {
    throw new Error('Checkout Session evidence mismatch');
  }
}

/** Trusted internal invocation only. The lease and exact request commit before Stripe is called. */
export async function dispatchSessionCreate(pool: Pool, gateway: StripeGateway, attemptId: string,
  workerId: string, urls: {successUrl:string;cancelUrl:string}): Promise<CheckoutDispatch> {
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(workerId)) throw new Error('Invalid worker identity');
  const claimed=await withInitialLock(pool,attemptId,async (client,c):Promise<Lease|CheckoutDispatch> => {
    if (c.commandState==='RESOLVED' && c.attemptState==='OPEN' && c.sessionId && c.checkoutUrl &&
        c.sessionExpiresAt && c.sessionExpiresAt.getTime()>c.commandNow.getTime()) {
      return {status:'READY',url:c.checkoutUrl,sessionId:c.sessionId};
    }
    if (c.commandState==='QUARANTINED') return {status:'QUARANTINED'};
    if (!['PENDING','UNKNOWN','SUBMITTED'].includes(c.commandState) || c.status!=='AWAITING_INITIAL_PAYMENT' ||
        c.claimHoldId!==c.holdId || c.claimReleasedAt ||
        (c.nextAttemptAt && c.nextAttemptAt.getTime()>c.commandNow.getTime()) ||
        (c.leaseExpiresAt && c.leaseExpiresAt.getTime()>c.commandNow.getTime())) return {status:'PENDING'};
    if (c.firstSubmittedAt && (c.commandNow.getTime()-c.firstSubmittedAt.getTime()>=24*60*60*1000 || !c.requestParams) ||
        c.commandState!=='PENDING' && !c.firstSubmittedAt) {
      await client.query("UPDATE provider_commands SET state='QUARANTINED',last_error_code='IDEMPOTENCY_AGE_UNSAFE',lease_owner=NULL,lease_expires_at=NULL WHERE id=$1",[c.commandId]);
      await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,reason_code,occurred_at)
        VALUES($1,$2,'SERVICE','checkout-worker','session.quarantined','command',$3,'IDEMPOTENCY_AGE_UNSAFE',clock_timestamp())`,[randomUUID(),c.bookingId,c.commandId]);
      return {status:'QUARANTINED'};
    }
    const fresh:CheckoutRequest={correlation:{bookingId:c.bookingId,holdId:c.holdId,attemptId:c.attemptId,commandId:c.commandId},
      paymentPurpose:c.splitBasis==='ADVANCE'?'INITIAL_ADVANCE':'INITIAL_FULL',
      amountCents:Number(c.expectedCents),expiresAt:Math.floor(c.commandNow.getTime()/1000)+1830,
      successUrl:urls.successUrl,cancelUrl:urls.cancelUrl,idempotencyKey:c.idempotencyKey};
    if (!Number.isSafeInteger(fresh.amountCents) || fresh.amountCents<=0) throw new Error('Stripe amount outside safe integer range');
    const request=requestSchema.parse(c.requestParams ?? fresh);
    if (request.correlation.bookingId!==c.bookingId || request.correlation.holdId!==c.holdId ||
        request.correlation.attemptId!==c.attemptId || request.correlation.commandId!==c.commandId ||
        request.amountCents!==fresh.amountCents || request.idempotencyKey!==c.idempotencyKey ||
        request.paymentPurpose!==undefined && request.paymentPurpose!==fresh.paymentPurpose) throw new Error('Persisted Checkout request mismatch');
    const generation=c.leaseGeneration+1n;
    await client.query(`UPDATE provider_commands SET request_params=COALESCE(request_params,$2::jsonb),
      first_submitted_at=COALESCE(first_submitted_at,clock_timestamp()),state='SUBMITTED',
      lease_owner=$3,lease_expires_at=clock_timestamp()+interval '2 minutes',lease_generation=$4,
      attempt_count=attempt_count+1,last_attempt_at=clock_timestamp(),next_attempt_at=NULL WHERE id=$1`,
      [c.commandId,JSON.stringify(request),workerId,generation.toString()]);
    return {request,generation,attemptId:c.attemptId,commandId:c.commandId};
  });
  if ('status' in claimed) return claimed;
  const submission=await sessionSubmissionGate(pool,claimed.commandId,workerId,claimed.generation);
  if (submission!=='SUBMIT') return {status:submission};
  let session:CheckoutSession;
  try {
    session=await gateway.createSession(claimed.request);
    validateSession(session,claimed.request,gateway.accountId);
  } catch {
    const retried=await withInitialLock(pool,attemptId,async (client,c) => {
      if (c.commandId!==claimed.commandId || c.leaseGeneration!==claimed.generation || c.leaseOwner!==workerId ||
          !c.leaseExpiresAt || c.leaseExpiresAt.getTime()<=c.commandNow.getTime()) return false;
      await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1 AND state='CREATING'",[attemptId]);
      await client.query("UPDATE inventory_holds SET state='RECONCILING',version=version+1 WHERE id=$1 AND state='CREATING'",[c.holdId]);
      await client.query("UPDATE provider_commands SET state='UNKNOWN',lease_owner=NULL,lease_expires_at=NULL,last_error_code='CREATE_OUTCOME_UNKNOWN',next_attempt_at=clock_timestamp()+($2*interval '1 second') WHERE id=$1",[c.commandId,commandRetrySeconds(c.commandAttempts)]);
      return true;
    });
    return {status:'PENDING',retryScheduled:retried};
  }
  return withInitialLock(pool,attemptId,async (client,c):Promise<CheckoutDispatch> => {
    if (c.commandId!==claimed.commandId || c.leaseGeneration!==claimed.generation || c.leaseOwner!==workerId || !c.leaseExpiresAt || c.leaseExpiresAt.getTime()<=c.commandNow.getTime() ||
        c.claimHoldId!==c.holdId || c.claimReleasedAt || c.status!=='AWAITING_INITIAL_PAYMENT') return {status:'PENDING'};
    if (!session.url || session.status!=='open' || session.paymentStatus!=='unpaid' ||
        session.expiresAt*1000<=c.commandNow.getTime()) {
      await client.query(`UPDATE payment_attempts SET state='RECONCILING',stripe_session_id=$2,
        session_created_at=to_timestamp($3),session_expires_at=to_timestamp($4),version=version+1 WHERE id=$1`,
        [attemptId,session.id,session.created,session.expiresAt]);
      await client.query("UPDATE inventory_holds SET state='RECONCILING',version=version+1 WHERE id=$1",[c.holdId]);
      await client.query("UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,last_error_code='SESSION_REQUIRES_RECONCILIATION' WHERE id=$1",[c.commandId]);
      return {status:'PENDING'};
    }
    await client.query(`UPDATE payment_attempts SET state='OPEN',stripe_session_id=$2,checkout_url=$3,
      session_created_at=to_timestamp($4),session_expires_at=to_timestamp($5),version=version+1 WHERE id=$1`,
      [attemptId,session.id,session.url,session.created,session.expiresAt]);
    await client.query("UPDATE inventory_holds SET state='ACTIVE',version=version+1 WHERE id=$1",[c.holdId]);
    await client.query("UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL WHERE id=$1",[c.commandId]);
    return {status:'READY',url:session.url,sessionId:session.id};
  });
}

/** Enrolled scheduled lane; each command is isolated and backoff is durable. */
export async function recoverSessionCommands(pool:Pool,gateway:StripeGateway,workerId:string,
  urls:{successUrl:string;cancelUrl:string},limit=10,options:RecoveryOptions={}):Promise<WorkCounts & {items:CheckoutDispatch[]}> {
  batchLimit(limit);
  const batch={...workCounts(),items:[] as CheckoutDispatch[]};
  const ids=await pool.query<{id:string;payment_attempt_id:string;hold_id:string|null}>(`SELECT pc.id,pc.payment_attempt_id,a.hold_id
    FROM provider_commands pc JOIN payment_attempts a ON a.id=pc.payment_attempt_id AND a.recovery_enabled
    WHERE pc.kind='SESSION_CREATE' AND pc.state IN ('PENDING','UNKNOWN','SUBMITTED')
      AND (pc.next_attempt_at IS NULL OR pc.next_attempt_at<=clock_timestamp())
      AND (pc.lease_expires_at IS NULL OR pc.lease_expires_at<=clock_timestamp())
    ORDER BY COALESCE(pc.next_attempt_at,pc.created_at),pc.id LIMIT $1`,[limit]);
  for (const row of ids.rows) {
    if (options.admit && !options.admit()) {batch.deferred++;break;}
    batch.attempted++;
    try {
      const result= row.hold_id
        ? await dispatchSessionCreate(pool,gateway,row.payment_attempt_id,workerId,urls)
        : await dispatchBalanceSessionCreate(pool,gateway,row.payment_attempt_id,workerId,urls);
      batch.items.push(result);
      if (result.status==='READY') batch.processed++;
      else if (result.status==='QUARANTINED') {batch.investigationRequired++;batch.deferred++;}
      else if(result.retryScheduled) batch.retried++;
      else batch.deferred++;
    } catch {
      batch.failed++;
      // An exception before claim must yield its place too. Never overwrite a live
      // lease (including our own ambiguous submission), request, key or chronology.
      try {
        const scheduled=await pool.query(`UPDATE provider_commands SET
          next_attempt_at=clock_timestamp()+interval '60 seconds',last_error_code='COMMAND_RECOVERY_ERROR'
          WHERE id=$1 AND kind='SESSION_CREATE' AND state IN ('PENDING','UNKNOWN','SUBMITTED')
            AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp())`,[row.id]);
        if (scheduled.rowCount===1) batch.retried++; else batch.deferred++;
      } catch {batch.deferred++;}
    }
  }
  return batch;
}
export async function dispatchDueSessionCommands(pool:Pool,gateway:StripeGateway,workerId:string,
  urls:{successUrl:string;cancelUrl:string},limit=10):Promise<CheckoutDispatch[]> {
  return (await recoverSessionCommands(pool,gateway,workerId,urls,limit)).items;
}
