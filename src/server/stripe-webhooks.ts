import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { StripeGateway, VerifiedEvent } from './stripe-adapter';
import { reconcileInitialAttempt } from './payment-reconciliation';

const relevant=new Set(['checkout.session.completed','checkout.session.expired',
  'payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled']);
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
export async function processWebhookInbox(pool:Pool,gateway:StripeGateway,limit=10,onlyEventId?:string):Promise<number> {
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
        const result=await reconcileInitialAttempt(pool,gateway,attemptId,{webhookEventId:event.id,
          sessionLocator:event.object_type==='checkout.session'?event.object_id:undefined,
          paymentIntentLocator:event.object_type==='payment_intent'?event.object_id:undefined});
        if (result!=='RECONCILING') outcome='PROCESSED';
        else errorCode='RECONCILIATION_UNCERTAIN';
      } else errorCode='ATTEMPT_NOT_LOCATED';
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
