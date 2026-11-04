import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { StripeGateway, VerifiedEvent } from './stripe-adapter';
import { reconcileInitialAttempt } from './payment-reconciliation';
import { reconcileBalanceAttempt } from './balance-payment';
import { reconcileRefund, type RefundGateway } from './refund-worker';
import { batchLimit, observeProvider, recoveryPolicy, workCounts, type RecoveryOptions, type WorkCounts } from './payment-recovery';

const relevant=new Set(['checkout.session.completed','checkout.session.expired',
  'payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled','refund.created','refund.updated','refund.failed','charge.refunded']);
const asynchronous=new Set(['checkout.session.async_payment_succeeded','checkout.session.async_payment_failed']);
export class WebhookInputError extends Error {}

/** Only signature-verified metadata and a digest are retained. */
export async function ingestStripeWebhook(pool:Pool,gateway:StripeGateway,raw:Buffer,signature:string):Promise<{duplicate:boolean;eventId:string}> {
  if (!signature || raw.length===0 || raw.length>1024*1024) throw new WebhookInputError('Invalid webhook size or signature header');
  let event:VerifiedEvent;
  try { event=gateway.verifyEvent(raw,signature); }
  catch { throw new WebhookInputError('Invalid Stripe signature or environment'); }
  if (event.livemode || event.accountId!==gateway.accountId || !event.id.startsWith('evt_'))
    throw new WebhookInputError('Wrong Stripe environment');
  const state=asynchronous.has(event.type)?'QUARANTINED':relevant.has(event.type)?'PENDING':'IGNORED';
  const digest=createHash('sha256').update(raw).digest();
  const result=await pool.query<{id:string;inserted:boolean}>(`INSERT INTO stripe_webhook_events
    (id,stripe_event_id,event_type,object_type,object_id,provider_created_at,received_at,
     payload_digest,processing_state,delivery_count)
    VALUES($1,$2,$3,$4,$5,to_timestamp($6),clock_timestamp(),$7,$8,1)
    ON CONFLICT (stripe_event_id) DO UPDATE SET delivery_count=stripe_webhook_events.delivery_count+1
    RETURNING id,(xmax=0) inserted`,
    [randomUUID(),event.id,event.type,event.objectType,event.objectId,event.created,digest,state]);
  return {duplicate:!result.rows[0].inserted,eventId:result.rows[0].id};
}

/** Trusted internal invocation; webhook HTTP never performs provider reconciliation. */
export async function processWebhookInbox(pool:Pool,gateway:StripeGateway & Partial<RefundGateway>,limit=10,onlyEventId?:string):Promise<number> {
  if (!Number.isSafeInteger(limit) || limit<1 || limit>25) throw new RangeError('Invalid batch size');
  const workerId=randomUUID();
  await pool.query(`UPDATE stripe_webhook_events SET processing_state='INVESTIGATE',
    lease_owner=NULL,lease_until=NULL,last_error_code='LEASE_RETRY_LIMIT',last_error_at=clock_timestamp()
    WHERE processing_state='PROCESSING' AND lease_until<clock_timestamp() AND processing_attempts>=5`);
  let processed=0;
  for (let item=0;item<limit;item++) {
    const claimed=await pool.query<{id:string;object_type:string;object_id:string;processing_attempts:number}>(
      `WITH due AS (
        SELECT id FROM stripe_webhook_events
        WHERE ((processing_state='PENDING') OR
          (processing_state='RETRY' AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp())) OR
          (processing_state='PROCESSING' AND lease_until<clock_timestamp()))
          AND processing_attempts<5 AND ($2::uuid IS NULL OR id=$2)
        ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE stripe_webhook_events e SET processing_state='PROCESSING',
        lease_owner=$1,lease_until=clock_timestamp()+interval '2 minutes',
        next_attempt_at=NULL,processing_attempts=e.processing_attempts+1
      FROM due WHERE e.id=due.id
      RETURNING e.id,e.object_type,e.object_id,e.processing_attempts`,[workerId,onlyEventId??null]);
    const event=claimed.rows[0];
    if (!event) break;
    let outcome:'PROCESSED'|'RETRY'='RETRY',errorCode='PROCESSING_ERROR';
    try {
      if(event.object_type==='refund'||event.object_type==='charge') {
        if(!gateway.retrieveRefund||!gateway.listRefunds||!gateway.createRefund)throw new Error('Refund gateway missing');
        const refunds=event.object_type==='refund'?[await gateway.retrieveRefund(event.object_id)]:
          await (async()=>{
            const payment=(await pool.query<{stripe_payment_intent_id:string}>('SELECT stripe_payment_intent_id FROM payment_records WHERE stripe_charge_id=$1',[event.object_id])).rows[0];
            if(!payment)throw new Error('Original charge unknown');
            return gateway.listRefunds!(payment.stripe_payment_intent_id);
          })();
        if(!refunds.length)throw new Error('Refund evidence missing');
        for(const r of refunds) {
          const match=(await pool.query<{id:string}>(`SELECT id FROM refund_attempts WHERE stripe_refund_id=$1 OR id::text=$2`,[r.id,r.metadata.attemptId??''])).rows;
          if(match.length!==1)throw new Error('Refund attempt not uniquely located');
          const state=await reconcileRefund(pool,gateway as RefundGateway,match[0].id,{refundId:r.id,webhookEventId:event.id});
          if(!['SUCCEEDED','FAILED','PROCESSING'].includes(state))throw new Error('Refund reconciliation uncertain');
        }
        outcome='PROCESSED';
      }
      let attemptId:string|null=null;
      if (event.object_type==='checkout.session') {
        const found=await pool.query<{id:string}>('SELECT id FROM payment_attempts WHERE stripe_session_id=$1',[event.object_id]);
        attemptId=found.rows[0]?.id??null;
        if (!attemptId) {
          const session=await gateway.retrieveSession(event.object_id);
          if (!session.livemode && session.accountId===gateway.accountId && session.metadata.attemptId) {
            const match=await pool.query<{id:string}>('SELECT id FROM payment_attempts WHERE id=$1',[session.metadata.attemptId]);
            attemptId=match.rows[0]?.id??null;
          }
        }
      } else if (event.object_type==='payment_intent') {
        const found=await pool.query<{id:string}>('SELECT id FROM payment_attempts WHERE stripe_payment_intent_id=$1',[event.object_id]);
        attemptId=found.rows[0]?.id??null;
        if (!attemptId) {
          const intent=await gateway.retrievePaymentIntent(event.object_id);
          if (!intent.livemode && intent.metadata.attemptId) {
            const match=await pool.query<{id:string}>('SELECT id FROM payment_attempts WHERE id=$1',[intent.metadata.attemptId]);
            attemptId=match.rows[0]?.id??null;
          }
        }
      }
      if (attemptId) {
        const attempt=await pool.query<{hold_id:string|null}>('SELECT hold_id FROM payment_attempts WHERE id=$1',[attemptId]);
        const reconcile=attempt.rows[0]?.hold_id?reconcileInitialAttempt:reconcileBalanceAttempt;
        const result=await reconcile(pool,gateway,attemptId,{webhookEventId:event.id,
          sessionLocator:event.object_type==='checkout.session'?event.object_id:undefined,
          paymentIntentLocator:event.object_type==='payment_intent'?event.object_id:undefined});
        if (result!=='RECONCILING') outcome='PROCESSED';
        else errorCode='RECONCILIATION_UNCERTAIN';
      } else if(outcome!=='PROCESSED') errorCode='ATTEMPT_NOT_LOCATED';
    } catch {
      errorCode='PROVIDER_OR_DATABASE_ERROR';
    }
    const terminal=outcome==='RETRY' && event.processing_attempts>=5;
    const delay=Math.min(30*2**(event.processing_attempts-1),3600);
    const finished=await pool.query(`UPDATE stripe_webhook_events SET
      processing_state=$3,processed_at=CASE WHEN $3='PROCESSED' THEN clock_timestamp() ELSE processed_at END,
      next_attempt_at=CASE WHEN $3='RETRY' THEN clock_timestamp()+($4*interval '1 second') ELSE NULL END,
      lease_owner=NULL,lease_until=NULL,
      last_error_code=CASE WHEN $3='PROCESSED' THEN NULL ELSE $5 END,
      last_error_at=CASE WHEN $3='PROCESSED' THEN last_error_at ELSE clock_timestamp() END
      WHERE id=$1 AND lease_owner=$2 AND processing_state='PROCESSING'`,
      [event.id,workerId,outcome==='PROCESSED'?'PROCESSED':terminal?'INVESTIGATE':'RETRY',delay,errorCode]);
    if (outcome==='PROCESSED' && finished.rowCount===1) processed++;
  }
  return processed;
}

export const PAYMENT_SESSION_EVENTS = ['checkout.session.completed', 'checkout.session.expired'] as const;
export const PAYMENT_INTENT_EVENTS = ['payment_intent.succeeded', 'payment_intent.payment_failed',
  'payment_intent.canceled'] as const;
// This exact pair predicate is used before either claiming or housekeeping.
const paymentEventPredicate = `((event_type=ANY($1::text[]) AND object_type='checkout.session') OR
  (event_type=ANY($2::text[]) AND object_type='payment_intent'))`;
type PaymentInboxEvent = { id:string; object_type:string; object_id:string; processing_attempts:number };
async function reconcilePaymentInboxEvent(pool:Pool,gateway:StripeGateway,event:PaymentInboxEvent) {
  const column=event.object_type==='checkout.session'?'stripe_session_id':'stripe_payment_intent_id';
  let attemptId=(await pool.query<{id:string}>(`SELECT id FROM payment_attempts WHERE ${column}=$1`,[event.object_id])).rows[0]?.id;
  if (!attemptId) {
    const object=event.object_type==='checkout.session'
      ? await gateway.retrieveSession(event.object_id) : await gateway.retrievePaymentIntent(event.object_id);
    if (!object.livemode && (!('accountId' in object) || object.accountId===gateway.accountId) &&
        /^[0-9a-f-]{36}$/i.test(object.metadata.attemptId??'')) {
      attemptId=(await pool.query<{id:string}>('SELECT id FROM payment_attempts WHERE id=$1',
        [object.metadata.attemptId])).rows[0]?.id;
    }
  }
  if (!attemptId) return 'RECONCILING';
  const attempt=(await pool.query<{hold_id:string|null}>('SELECT hold_id FROM payment_attempts WHERE id=$1',[attemptId])).rows[0];
  if (!attempt) return 'RECONCILING';
  return (attempt.hold_id?reconcileInitialAttempt:reconcileBalanceAttempt)(pool,gateway,attemptId,{
    webhookEventId:event.id,sessionLocator:event.object_type==='checkout.session'?event.object_id:undefined,
    paymentIntentLocator:event.object_type==='payment_intent'?event.object_id:undefined,
  });
}

/** Stage 2B payment-only lane. The legacy explicit refund processor above is never
 * invoked here. Ingestion and all excluded events retain their original history. */
export async function processPaymentWebhookInbox(pool:Pool,gateway:StripeGateway,limit=2,
  options:RecoveryOptions & {onlyEventId?:string}={}):Promise<WorkCounts & {housekept:number}> {
  batchLimit(limit);
  const summary={...workCounts(),housekept:0};
  const parameters=[PAYMENT_SESSION_EVENTS,PAYMENT_INTENT_EVENTS,options.onlyEventId??null];
  const housekeeping=await pool.query(`WITH stale AS MATERIALIZED (
    SELECT id FROM stripe_webhook_events WHERE ${paymentEventPredicate}
      AND ($3::uuid IS NULL OR id=$3) AND processing_state='PROCESSING'
      AND lease_until<=clock_timestamp() AND processing_attempts>=5
    ORDER BY lease_until,id LIMIT 2 FOR UPDATE SKIP LOCKED
  ) UPDATE stripe_webhook_events e SET processing_state='INVESTIGATE',lease_owner=NULL,
    lease_until=NULL,last_error_code='LEASE_RETRY_LIMIT',last_error_at=clock_timestamp()
    FROM stale WHERE e.id=stale.id`,parameters);
  summary.housekept=housekeeping.rowCount??0;
  summary.investigationRequired+=summary.housekept;
  for(let index=0;index<limit;index++) {
    if(options.admit && !options.admit()) {summary.deferred++;break;}
    const owner=randomUUID(); // New for each claim, including a reclaimed delivery.
    let event:PaymentInboxEvent|undefined;
    try {event=(await pool.query<PaymentInboxEvent>(`WITH due AS (
      SELECT id FROM stripe_webhook_events WHERE ${paymentEventPredicate}
        AND ($3::uuid IS NULL OR id=$3) AND processing_attempts<5 AND (
          (processing_state IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp()))
          OR (processing_state='PROCESSING' AND lease_until<=clock_timestamp()))
      ORDER BY COALESCE(next_attempt_at,received_at),id LIMIT 1 FOR UPDATE SKIP LOCKED
    ) UPDATE stripe_webhook_events e SET processing_state='PROCESSING',lease_owner=$4,
      lease_until=clock_timestamp()+interval '2 minutes',processing_attempts=e.processing_attempts+1,
      next_attempt_at=NULL FROM due WHERE e.id=due.id
      RETURNING e.id,e.object_type,e.object_id,e.processing_attempts`,[...parameters,owner])).rows[0];}
    catch {summary.failed++;summary.deferred++;break;}
    if(!event)break;
    summary.attempted++;
    let result='RECONCILING',error=false;
    try {result=await reconcilePaymentInboxEvent(pool,observeProvider(gateway,()=>{error=true;}),event);} catch {error=true;}
    const success=result!=='RECONCILING';
    const terminal=!success && event.processing_attempts>=5;
    const state=success?'PROCESSED':terminal?'INVESTIGATE':'RETRY';
    const delay=recoveryPolicy('UNCERTAIN',event.processing_attempts-1,options.random).delay;
    try {
      const finished=await pool.query(`WITH owned AS MATERIALIZED (
        SELECT id FROM stripe_webhook_events WHERE id=$1 AND lease_owner=$2
          AND processing_attempts=$3 AND processing_state='PROCESSING' FOR UPDATE
      ) UPDATE stripe_webhook_events e SET processing_state=$4,
        processed_at=CASE WHEN $4='PROCESSED' THEN clock_timestamp() ELSE processed_at END,
        next_attempt_at=CASE WHEN $4='RETRY' THEN clock_timestamp()+($5*interval '1 second') ELSE NULL END,
        lease_owner=NULL,lease_until=NULL,last_error_code=CASE WHEN $4='PROCESSED' THEN NULL ELSE $6 END,
        last_error_at=CASE WHEN $4='PROCESSED' THEN last_error_at ELSE clock_timestamp() END
        FROM owned WHERE e.id=owned.id AND e.lease_until>clock_timestamp()`,
      [event.id,owner,event.processing_attempts,state,delay,error?'PROVIDER_OR_DATABASE_ERROR':'RECONCILIATION_UNCERTAIN']);
      if(finished.rowCount!==1) {summary.deferred++;continue;}
      if(success)summary.processed++;else if(terminal)summary.deferred++;else summary.retried++;
      if(terminal || result==='UNALLOCATABLE')summary.investigationRequired++;
      if(error)summary.failed++;
    } catch {summary.failed++;summary.deferred++;}
  }
  return summary;
}
