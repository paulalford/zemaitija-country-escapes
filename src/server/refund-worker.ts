import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PaymentEvidence } from './stripe-adapter';
import { authorize, rollbackWithAuthorizationAudit, type InternalAuthority } from './cancellation-authority';

export type RefundRequest={attemptId:string;commandId:string;obligationId:string;paymentRecordId:string;paymentIntentId:string;chargeId:string;amountCents:number;captureCents:number;idempotencyKey:string};
export type RefundEvidence={id:string;accountId:string;livemode:boolean;paymentIntentId:string|null;chargeId:string|null;amount:number;currency:string;status:string;metadata:Record<string,string>;requestId?:string;failureReason?:string|null};
export interface RefundGateway {
  readonly accountId:string;
  retrievePaymentIntent(id:string):Promise<PaymentEvidence>;
  createRefund(request:RefundRequest):Promise<RefundEvidence>;
  retrieveRefund(id:string):Promise<RefundEvidence>;
  /** Complete, paginated original-capture refund history, never a truncated search. */
  listRefunds(paymentIntentId:string):Promise<RefundEvidence[]>;
}
const refundFingerprint=(q:RefundRequest)=>createHash('sha256').update(JSON.stringify(q,Object.keys(q).sort())).digest();
type Obligation={id:string;booking_id:string|null;provider_incident_id:string|null;source_payment_record_id:string|null;amount_cents:string;refund_encumbered_cents:string};
type Attempt={id:string;state:string;requested_cents:string;payment_record_id:string;stripe_refund_id:string|null;command_id:string;command_state:string;request_params:RefundRequest;first_submitted_at:Date|null;lease_expires_at:Date|null;lease_generation:string;request_fingerprint:Buffer};
async function withRefundLock<T>(pool:Pool,obligationId:string,work:(client:PoolClient,o:Obligation)=>Promise<T>) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='15s'");
    const owner=(await client.query<Obligation>('SELECT * FROM refund_obligations WHERE id=$1',[obligationId])).rows[0];
    if(!owner)throw new Error('Refund obligation unavailable');
    if(owner.booking_id)await client.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[owner.booking_id]);
    // Lock every eligible capture before the refund reservation; all writers use this order.
    await client.query(`SELECT id FROM payment_records WHERE ($1::uuid IS NOT NULL AND booking_id=$1)
      OR ($2::uuid IS NOT NULL AND provider_incident_id=$2) ORDER BY id FOR UPDATE`,[owner.booking_id,owner.provider_incident_id]);
    const o=(await client.query<Obligation>('SELECT * FROM refund_obligations WHERE id=$1 FOR UPDATE',[obligationId])).rows[0];
    const result=await work(client,o);await client.query('COMMIT');return result;
  }catch(e){await rollbackWithAuthorizationAudit(client,e);throw e;}finally{client.release();}
}
async function refundAudit(client:PoolClient,o:Obligation,action:string,id:string,details:unknown,authority?:InternalAuthority) {
  const audit=randomUUID(),d=details as {amountCents?:string;request?:RefundRequest;priorState?:string;newState?:string;reason?:string};
  await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,admin_user_id,service_name,action,entity_type,entity_id,operation_key,occurred_at,details,amount_cents,prior_state,new_state,reason_code)
    VALUES($1,$2,$3,$4,'refund-worker',$5,'refund_attempt',$6,$7,clock_timestamp(),$8,$9,$10,$11,$12)`,
    [audit,o.booking_id,authority?.kind==='OPERATOR'?'ADMIN':'SERVICE',authority?.kind==='OPERATOR'?authority.adminId:null,action,id,
      `${action}:${id}`,{...details as object,...authority?{authorizationRef:authority.authorizationRef}:{}},d.amountCents??d.request?.amountCents??null,
      d.priorState??null,d.newState??(action==='refund.requested'?'REQUESTED':null),d.reason??null]);
  return audit;
}
async function refundNotices(client:PoolClient,o:Obligation,audit:string,event:string,key:string,operations:boolean) {
  const owner=(await client.query<{booking_id:string;guest_id:string;locale:string}>(`SELECT b.id booking_id,b.guest_id,s.locale
    FROM bookings b JOIN price_snapshots s ON s.booking_id=b.id WHERE b.id=$1 OR b.id IN (
      SELECT pa.booking_id FROM payment_attempts pa JOIN provider_incidents pi ON pi.stripe_payment_intent_id=pa.stripe_payment_intent_id WHERE pi.id=$2)
    ORDER BY b.id`,[o.booking_id,o.provider_incident_id])).rows;
  if(owner.length===1) {
    const b=owner[0];
    await client.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,recipient_ref,locale,idempotency_key,due_at,state)
      VALUES($1,$2,$3,$4,'GUEST',$5,$6,$7,clock_timestamp(),'QUEUED') ON CONFLICT(idempotency_key) DO NOTHING`,
      [randomUUID(),b.booking_id,audit,event==='REFUND_SUCCEEDED'?event:'GUEST_PAYMENT_UPDATE',b.guest_id,b.locale,`${key}:GUEST:${b.locale}`]);
  }else await refundAudit(client,o,'refund.guest_association_investigation',randomUUID(),{obligationId:o.id});
  if(operations||owner.length!==1)await client.query(`INSERT INTO notification_outbox(id,booking_id,provider_incident_id,source_audit_event_id,event_type,
    recipient_kind,locale,idempotency_key,due_at,state) VALUES($1,$2,$3,$4,'REFUND_INTERVENTION','OPERATIONS','en',$5,clock_timestamp(),'QUEUED')
    ON CONFLICT(idempotency_key) DO NOTHING`,[randomUUID(),o.booking_id,o.provider_incident_id,audit,`${key}:OPERATIONS`]);
}

/** Explicit finance command. Failed attempts require a fresh current-provider reconciliation first. */
export async function requestRefund(pool:Pool,obligationId:string,authority:InternalAuthority):Promise<string|null> {
  await authorize(pool,authority,'finance');
  return withRefundLock(pool,obligationId,async(client,o)=>{
    await authorize(client,authority,'finance');
    const inflight=(await client.query<{id:string}>("SELECT id FROM refund_attempts WHERE obligation_id=$1 AND state IN ('REQUESTED','PROCESSING')",[o.id])).rows[0];
    if(inflight)return inflight.id;
    const failed=(await client.query<{id:string;checked_at:Date}>(`SELECT a.id,r.checked_at FROM refund_attempts a
      JOIN reconciliation_records r ON r.id=a.reconciliation_id WHERE a.obligation_id=$1 AND a.state='FAILED' ORDER BY a.created_at DESC LIMIT 1`,[o.id])).rows[0];
    if(failed && Date.now()-failed.checked_at.getTime()>60_000)throw new Error('Reconcile failed refund before replacement');
    const remaining=BigInt(o.amount_cents)-BigInt(o.refund_encumbered_cents);if(remaining<=0n)return null;
    const captures=(await client.query<{id:string;stripe_payment_intent_id:string;stripe_charge_id:string|null;captured_cents:string;refund_encumbered_cents:string}>(`SELECT * FROM payment_records
      WHERE (booking_id=$1 OR provider_incident_id=$2) AND ($3::uuid IS NULL OR id=$3) ORDER BY id`,[o.booking_id,o.provider_incident_id,o.source_payment_record_id])).rows;
    const p=captures.find(p=>BigInt(p.captured_cents)>BigInt(p.refund_encumbered_cents)&&p.stripe_charge_id);
    if(!p)throw new Error('No remaining eligible capture');
    const available=BigInt(p.captured_cents)-BigInt(p.refund_encumbered_cents),amount=remaining<available?remaining:available;
    if(amount>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Stripe amount exceeds safe integer');
    const attemptId=randomUUID(),commandId=randomUUID();
    const request:RefundRequest={attemptId,commandId,obligationId:o.id,paymentRecordId:p.id,paymentIntentId:p.stripe_payment_intent_id,
      chargeId:p.stripe_charge_id!,amountCents:Number(amount),captureCents:Number(p.captured_cents),idempotencyKey:`refund:${attemptId}`};
    await client.query('UPDATE payment_records SET refund_encumbered_cents=refund_encumbered_cents+$2 WHERE id=$1',[p.id,amount.toString()]);
    await client.query('UPDATE refund_obligations SET refund_encumbered_cents=refund_encumbered_cents+$2 WHERE id=$1',[o.id,amount.toString()]);
    await client.query(`INSERT INTO refund_attempts(id,obligation_id,payment_record_id,state,requested_cents,version) VALUES($1,$2,$3,'REQUESTED',$4,1)`,[attemptId,o.id,p.id,amount.toString()]);
    await client.query(`INSERT INTO provider_commands(id,kind,refund_attempt_id,logical_key,stripe_idempotency_key,request_fingerprint,request_params,state)
      VALUES($1,'REFUND_CREATE',$2,$3,$3,$4,$5,'PENDING')`,[commandId,attemptId,request.idempotencyKey,refundFingerprint(request),request]);
    await refundAudit(client,o,'refund.requested',attemptId,{request,replacesAttemptId:failed?.id??null},authority);
    return attemptId;
  });
}
async function locate(pool:Pool,attemptId:string) {
  const a=(await pool.query<{obligation_id:string}>('SELECT obligation_id FROM refund_attempts WHERE id=$1',[attemptId])).rows[0];
  if(!a)throw new Error('Refund attempt unavailable');return a.obligation_id;
}
async function lockedAttempt(client:PoolClient,id:string) {
  await client.query('SELECT id FROM refund_attempts WHERE id=$1 FOR UPDATE',[id]);
  return (await client.query<Attempt>(`SELECT a.*,pc.id command_id,pc.state command_state,pc.request_params,pc.first_submitted_at,
    pc.lease_expires_at,pc.lease_generation::text,pc.request_fingerprint FROM refund_attempts a JOIN provider_commands pc ON pc.refund_attempt_id=a.id AND pc.kind='REFUND_CREATE'
    WHERE a.id=$1 FOR UPDATE OF pc`,[id])).rows[0];
}
function matches(r:RefundEvidence,a:Attempt,gateway:RefundGateway) {
  const q=a.request_params;
  return !r.livemode&&r.accountId===gateway.accountId&&r.id.startsWith('re_')&&r.paymentIntentId===q.paymentIntentId&&r.chargeId===q.chargeId&&
    r.currency==='eur'&&r.amount===q.amountCents&&Object.entries({attemptId:a.id,commandId:a.command_id,obligationId:q.obligationId,paymentRecordId:a.payment_record_id}).every(([k,v])=>r.metadata[k]===v);
}
async function intervene(client:PoolClient,o:Obligation,a:Attempt,reason:string) {
  if(a.state==='SUCCEEDED'||a.state==='FAILED'){
    const audit=await refundAudit(client,o,'refund.terminal_evidence_conflict',a.id,{reason,state:a.state});
    await refundNotices(client,o,audit,'GUEST_PAYMENT_UPDATE',`refund-terminal-conflict:${a.id}`,true);return;
  }
  await client.query("UPDATE refund_attempts SET state='PROCESSING',version=version+1 WHERE id=$1",[a.id]);
  await client.query(`UPDATE provider_commands SET state='QUARANTINED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2 WHERE id=$1`,[a.command_id,reason]);
  const audit=await refundAudit(client,o,'refund.quarantined',a.id,{reason,firstSubmittedAt:a.first_submitted_at});
  await refundNotices(client,o,audit,'GUEST_PAYMENT_UPDATE',`refund-intervention:${a.id}`,true);
}
/** Retrieves current provider state. Event payload status is never financial evidence. */
export async function reconcileRefund(pool:Pool,gateway:RefundGateway,attemptId:string,options:{refundId?:string;webhookEventId?:string}={}):Promise<string> {
  const obligation=await locate(pool,attemptId);
  const stored=(await pool.query<{stripe_refund_id:string|null;request_params:RefundRequest}>(`SELECT a.stripe_refund_id,pc.request_params FROM refund_attempts a
    JOIN provider_commands pc ON pc.refund_attempt_id=a.id WHERE a.id=$1`,[attemptId])).rows[0];
  let evidence:RefundEvidence|undefined;
  let readError:string|undefined;
  const id=stored.stripe_refund_id??options.refundId;
  try {
  if(id)evidence=await gateway.retrieveRefund(id);
  else {
    const history=await gateway.listRefunds(stored.request_params.paymentIntentId);
    const candidates=history.filter(r=>r.metadata.attemptId===attemptId);
    if(candidates.length===1)evidence=await gateway.retrieveRefund(candidates[0].id);
    if(candidates.length>1)readError='AMBIGUOUS_PROVIDER_REFUNDS';
  }
  }catch{readError='PROVIDER_REFUND_EVIDENCE_UNAVAILABLE';}
  return withRefundLock(pool,obligation,async(client,o)=>{
    const a=await lockedAttempt(client,attemptId);
    if(readError){await intervene(client,o,a,readError);return 'QUARANTINED';}
    if(!evidence)return 'UNKNOWN';
    if(!matches(evidence,a,gateway)) {await intervene(client,o,a,'REFUND_EVIDENCE_MISMATCH');return 'QUARANTINED';}
    const status=evidence.status,terminal=['succeeded','failed','canceled'].includes(status),result=status==='succeeded'?'REFUND_SUCCEEDED':terminal?'REFUND_FAILED':'REFUND_PROCESSING';
    const rec=randomUUID();
    await client.query(`INSERT INTO reconciliation_records(id,refund_attempt_id,webhook_event_id,checked_at,provider_object_id,provider_state,amount_cents,currency,evidence_kind,result)
      VALUES($1,$2,$3,clock_timestamp(),$4,$5,$6,'EUR','STRIPE_CURRENT',$7)`,[rec,a.id,options.webhookEventId??null,evidence.id,status,evidence.amount,result]);
    if(a.state==='SUCCEEDED'||a.state==='FAILED') {
      if((a.state==='SUCCEEDED')!==(status==='succeeded') || a.state==='FAILED'&&!['failed','canceled'].includes(status)){
        await intervene(client,o,a,'PROVIDER_TERMINAL_REFUND_CONFLICT');return 'QUARANTINED';
      }
      if(a.state==='FAILED')await client.query('UPDATE refund_attempts SET reconciliation_id=$2 WHERE id=$1',[a.id,rec]);
      return a.state;
    }
    const next=status==='succeeded'?'SUCCEEDED':terminal?'FAILED':'PROCESSING';
    await client.query('UPDATE refund_attempts SET state=$2,stripe_refund_id=$3,reconciliation_id=$4,version=version+1 WHERE id=$1',[a.id,next,evidence.id,rec]);
    if(terminal)await client.query(`UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2 WHERE id=$1`,[a.command_id,next==='FAILED'?'PROVIDER_REFUND_FAILED':null]);
    if(next==='SUCCEEDED') {
      await client.query(`INSERT INTO refund_records(id,refund_attempt_id,payment_record_id,booking_id,provider_incident_id,stripe_refund_id,refunded_cents,currency,verified_at,reconciliation_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,'EUR',clock_timestamp(),$8)`,[randomUUID(),a.id,a.payment_record_id,o.booking_id,o.provider_incident_id,evidence.id,a.requested_cents,rec]);
      const audit=await refundAudit(client,o,'refund.succeeded',a.id,{refundId:evidence.id,amountCents:a.requested_cents,priorState:a.state,newState:next});
      await refundNotices(client,o,audit,'REFUND_SUCCEEDED',`refund:${evidence.id}`,false);
    }else if(next==='FAILED') {
      await client.query('UPDATE payment_records SET refund_encumbered_cents=refund_encumbered_cents-$2 WHERE id=$1',[a.payment_record_id,a.requested_cents]);
      await client.query('UPDATE refund_obligations SET refund_encumbered_cents=refund_encumbered_cents-$2 WHERE id=$1',[o.id,a.requested_cents]);
      const audit=await refundAudit(client,o,'refund.failed',a.id,{refundId:evidence.id,amountCents:a.requested_cents,priorState:a.state,newState:next,providerFailureReason:evidence.failureReason??status});
      await refundNotices(client,o,audit,'GUEST_PAYMENT_UPDATE',`refund-failed:${a.id}`,true);
    }else {
      await client.query(`UPDATE provider_commands SET state='UNKNOWN',lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND state<>'QUARANTINED'`,[a.command_id]);
      const audit=await refundAudit(client,o,'refund.processing',a.id,{refundId:evidence.id,providerState:status,priorState:a.state,newState:'PROCESSING'});
      if(status==='requires_action'||a.first_submitted_at&&Date.now()-a.first_submitted_at.getTime()>=86_400_000)
        await refundNotices(client,o,audit,'GUEST_PAYMENT_UPDATE',`refund-processing-review:${a.id}`,true);
    }
    return next;
  });
}

/** Durable lease, immutable exact request, provider calls outside transactions, 24h hard boundary. */
export async function dispatchRefund(pool:Pool,gateway:RefundGateway,attemptId:string,options:{testNow?:Date}={}):Promise<string> {
  if(options.testNow&&(process.env.NODE_ENV!=='test'||!Number.isFinite(options.testNow.getTime())))throw new Error('Invalid test clock');
  const clock=()=>options.testNow?.getTime()??Date.now();
  const obligation=await locate(pool,attemptId);
  const prior=await reconcileRefund(pool,gateway,attemptId);
  if(prior!=='UNKNOWN')return prior;
  const claim=await withRefundLock(pool,obligation,async(client,o)=>{
    const a=await lockedAttempt(client,attemptId),now=clock();
    if(!refundFingerprint(a.request_params).equals(a.request_fingerprint)){
      await intervene(client,o,a,'REFUND_REQUEST_FINGERPRINT_MISMATCH');return 'QUARANTINED';
    }
    if(a.state==='SUCCEEDED'||a.state==='FAILED')return a.state;
    if(a.command_state==='QUARANTINED')return 'QUARANTINED';
    if(a.lease_expires_at&&a.lease_expires_at.getTime()>now)return 'BUSY';
    if((a.first_submitted_at&&now-a.first_submitted_at.getTime()>=86_400_000)||(a.command_state!=='PENDING'&&!a.first_submitted_at)) {
      await intervene(client,o,a,'IDEMPOTENCY_WINDOW_EXHAUSTED');return 'QUARANTINED';
    }
    await client.query(`UPDATE provider_commands SET state='SUBMITTED',first_submitted_at=COALESCE(first_submitted_at,clock_timestamp()),
      lease_owner=$2,lease_expires_at=clock_timestamp()+interval '2 minutes',lease_generation=lease_generation+1,
      attempt_count=attempt_count+1,last_attempt_at=clock_timestamp() WHERE id=$1`,[a.command_id,randomUUID()]);
    await client.query("UPDATE refund_attempts SET state='PROCESSING',version=version+1 WHERE id=$1",[a.id]);
    return {request:a.request_params,generation:BigInt(a.lease_generation)+1n};
  });
  if(typeof claim==='string')return claim;
  let response:RefundEvidence|undefined;
  try {
    const p=await gateway.retrievePaymentIntent(claim.request.paymentIntentId);
    if(p.livemode||p.id!==claim.request.paymentIntentId||p.status!=='succeeded'||!p.chargePaid||!p.chargeCaptured||
      p.amountReceived!==claim.request.captureCents||p.chargeAmount!==claim.request.captureCents||p.chargeId!==claim.request.chargeId||p.currency!=='eur'||p.chargeCurrency!=='eur')throw new Error('Capture mismatch');
    const history=await gateway.listRefunds(p.id);
    const known=await pool.query<{stripe_refund_id:string|null}>(`SELECT stripe_refund_id FROM refund_attempts WHERE payment_record_id=$1`,[claim.request.paymentRecordId]);
    if(history.some(r=>!known.rows.some(k=>k.stripe_refund_id===r.id)&&r.metadata.attemptId!==attemptId)) {
      return withRefundLock(pool,obligation,async(client,o)=>{await intervene(client,o,await lockedAttempt(client,attemptId),'UNTRACKED_PROVIDER_REFUND');return 'QUARANTINED';});
    }
    // Recheck elapsed key age immediately before the POST after potentially slow provider reads.
    const fence=await pool.query<{first_submitted_at:Date;lease_generation:string;state:string}>(`SELECT first_submitted_at,lease_generation::text,state FROM provider_commands WHERE id=$1`,[claim.request.commandId]);
    const f=fence.rows[0];
    if(!f||f.state!=='SUBMITTED'||BigInt(f.lease_generation)!==claim.generation||!f.first_submitted_at||clock()-f.first_submitted_at.getTime()>=86_400_000)throw new Error('Submission fence expired');
    response=await gateway.createRefund(claim.request);
  }catch {
    return withRefundLock(pool,obligation,async(client,o)=>{
      const a=await lockedAttempt(client,attemptId);
      if(BigInt(a.lease_generation)!==claim.generation||['SUCCEEDED','FAILED'].includes(a.state))return a.state;
      await client.query(`UPDATE provider_commands SET state='UNKNOWN',lease_owner=NULL,lease_expires_at=NULL,last_error_code='REFUND_OUTCOME_UNKNOWN' WHERE id=$1 AND state<>'QUARANTINED'`,[a.command_id]);
      const audit=await refundAudit(client,o,'refund.outcome_unknown',a.id,{amountCents:a.requested_cents});
      await refundNotices(client,o,audit,'GUEST_PAYMENT_UPDATE',`refund-unknown:${a.id}`,true);
      return 'PROCESSING';
    });
  }
  const attached=await withRefundLock(pool,obligation,async(client,o)=>{
    const a=await lockedAttempt(client,attemptId);
    if(!matches(response!,a,gateway)){await intervene(client,o,a,'REFUND_RESPONSE_MISMATCH');return false;}
    if(a.stripe_refund_id&&a.stripe_refund_id!==response!.id){await intervene(client,o,a,'REFUND_IDENTITY_CONFLICT');return false;}
    await client.query('UPDATE refund_attempts SET stripe_refund_id=$2 WHERE id=$1',[a.id,response!.id]);
    if(response!.requestId)await client.query('UPDATE provider_commands SET provider_request_id=COALESCE(provider_request_id,$2) WHERE id=$1',[a.command_id,response!.requestId]);
    return true;
  });
  if(!attached)return 'QUARANTINED';
  // GET current state even if POST returned success. Persistence failures leave the same reserved operation for recovery.
  return reconcileRefund(pool,gateway,attemptId,{refundId:response.id});
}
