import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { CheckoutRequest, CheckoutSession, PaymentEvidence, StripeGateway } from './stripe-adapter';
import type { CheckoutDispatch } from './checkout-worker';

type BalanceContext = {
  bookingId:string; guestId:string; unitId:string; status:string; locale:string; obligationId:string;
  expectedCents:bigint; attemptId:string; attemptState:string; sessionId:string|null;
  checkoutUrl:string|null; sessionExpiresAt:Date|null; commandId:string; commandState:string;
  idempotencyKey:string; requestParams:CheckoutRequest|null; firstSubmittedAt:Date|null;
  leaseGeneration:bigint; leaseOwner:string|null; leaseExpiresAt:Date|null;
};
type ReconcileResult='PAID_IN_FULL'|'ALREADY_RECORDED'|'UNALLOCATABLE'|'OPEN'|'EXPIRED'|'FAILED'|'RECONCILING';
type ReconcileOptions={webhookEventId?:string;sessionLocator?:string;paymentIntentLocator?:string};

async function withBalanceLock<T>(pool:Pool,attemptId:string,work:(client:PoolClient,c:BalanceContext)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const owner=await client.query<{booking_id:string;guest_id:string;unit_id:string}>(`SELECT b.id booking_id,b.guest_id,b.unit_id
      FROM payment_attempts a JOIN bookings b ON b.id=a.booking_id JOIN payment_obligations o ON o.id=a.obligation_id
      WHERE a.id=$1 AND a.hold_id IS NULL AND o.kind='BALANCE'`,[attemptId]);
    if (!owner.rows[0]) throw new Error('Balance attempt not found');
    await client.query('SELECT lock_acceptance_context($1,$2)',[owner.rows[0].unit_id,owner.rows[0].guest_id]);
    await client.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[owner.rows[0].booking_id]);
    await client.query('SELECT id FROM payment_attempts WHERE id=$1 FOR UPDATE',[attemptId]);
    await client.query("SELECT id FROM provider_commands WHERE payment_attempt_id=$1 AND kind='SESSION_CREATE' FOR UPDATE",[attemptId]);
    const result=await client.query<{booking_id:string;guest_id:string;unit_id:string;status:string;locale:string;
      obligation_id:string;expected_cents:string;attempt_id:string;attempt_state:string;session_id:string|null;
      checkout_url:string|null;session_expires_at:Date|null;command_id:string;command_state:string;
      idempotency_key:string;request_params:CheckoutRequest|null;first_submitted_at:Date|null;
      lease_generation:string;lease_owner:string|null;lease_expires_at:Date|null}>(`SELECT b.id booking_id,b.guest_id,b.unit_id,b.status,s.locale,
      a.obligation_id,a.expected_cents::text,a.id attempt_id,a.state attempt_state,a.stripe_session_id session_id,
      a.checkout_url,a.session_expires_at,pc.id command_id,pc.state command_state,
      pc.stripe_idempotency_key idempotency_key,pc.request_params,pc.first_submitted_at,
      pc.lease_generation::text,pc.lease_owner,pc.lease_expires_at
      FROM payment_attempts a JOIN bookings b ON b.id=a.booking_id
      JOIN price_snapshots s ON s.booking_id=b.id JOIN provider_commands pc ON pc.payment_attempt_id=a.id AND pc.kind='SESSION_CREATE'
      WHERE a.id=$1`,[attemptId]);
    const r=result.rows[0];
    if (!r) throw new Error('Incomplete balance attempt');
    const value=await work(client,{bookingId:r.booking_id,guestId:r.guest_id,unitId:r.unit_id,status:r.status,
      locale:r.locale,obligationId:r.obligation_id,expectedCents:BigInt(r.expected_cents),attemptId:r.attempt_id,
      attemptState:r.attempt_state,sessionId:r.session_id,checkoutUrl:r.checkout_url,
      sessionExpiresAt:r.session_expires_at,commandId:r.command_id,commandState:r.command_state,
      idempotencyKey:r.idempotency_key,requestParams:r.request_params,firstSubmittedAt:r.first_submitted_at,
      leaseGeneration:BigInt(r.lease_generation),leaseOwner:r.lease_owner,leaseExpiresAt:r.lease_expires_at});
    await client.query('COMMIT'); return value;
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { client.release(); }
}

/** Trusted service entry point. Guest authorization belongs to the caller. */
export async function requestBalanceCheckout(pool:Pool,bookingId:string):Promise<{attemptId:string;commandId:string}|null> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    const owner=await client.query<{unit_id:string;guest_id:string}>(
      'SELECT unit_id,guest_id FROM bookings WHERE id=$1',[bookingId]);
    if (!owner.rows[0]) { await client.query('COMMIT'); return null; }
    await client.query('SELECT lock_acceptance_context($1,$2)',[owner.rows[0].unit_id,owner.rows[0].guest_id]);
    await client.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[bookingId]);
    const due=await client.query<{id:string;amount_cents:string;status:string;allocated:string}>(`SELECT o.id,o.amount_cents::text,b.status,
      COALESCE((SELECT sum(pa.amount_cents) FROM payment_allocations pa WHERE pa.obligation_id=o.id),0)::text allocated
      FROM bookings b JOIN payment_obligations o ON o.booking_id=b.id AND o.kind='BALANCE'
      JOIN price_snapshots s ON s.booking_id=b.id WHERE b.id=$1`,[bookingId]);
    const d=due.rows[0];
    // Accepted balances have zero or one full scheduled credit: 0021 enforces the
    // attempt amount; 0018 credit guards and allocation budgets enforce the rest.
    if (!d || d.status!=='CONFIRMED' || BigInt(d.amount_cents)===0n || BigInt(d.allocated)!==0n) {
      await client.query('COMMIT'); return null;
    }
    const existing=await client.query<{attempt_id:string;command_id:string}>(`SELECT a.id attempt_id,pc.id command_id
      FROM payment_attempts a JOIN provider_commands pc ON pc.payment_attempt_id=a.id AND pc.kind='SESSION_CREATE'
      WHERE a.obligation_id=$1 AND a.state IN ('CREATING','OPEN','RECONCILING') FOR UPDATE OF a,pc`,[d.id]);
    if (existing.rows[0]) { await client.query('COMMIT'); return {attemptId:existing.rows[0].attempt_id,commandId:existing.rows[0].command_id}; }
    const attemptId=randomUUID(),commandId=randomUUID();
    await client.query(`INSERT INTO payment_attempts(id,booking_id,obligation_id,state,expected_cents,currency,version)
      VALUES($1,$2,$3,'CREATING',$4,'EUR',1)`,[attemptId,bookingId,d.id,d.amount_cents]);
    await client.query(`INSERT INTO provider_commands(id,kind,payment_attempt_id,logical_key,stripe_idempotency_key,request_fingerprint,state)
      VALUES($1,'SESSION_CREATE',$2,$3,$4,$5,'PENDING')`,[commandId,attemptId,
        `balance-session:${attemptId}`,`balance-session:${attemptId}`,
        createHash('sha256').update(`${bookingId}:${d.id}:${d.amount_cents}`).digest()]);
    await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
      amount_cents,operation_key,occurred_at) VALUES($1,$2,'SERVICE','balance-payment','balance.checkout_requested',
      'payment_attempt',$3,$4,$5,clock_timestamp())`,[randomUUID(),bookingId,attemptId,d.amount_cents,`balance-session:${attemptId}`]);
    await client.query('COMMIT'); return {attemptId,commandId};
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { client.release(); }
}

function matching(s:CheckoutSession,c:BalanceContext,accountId:string):boolean {
  const m={bookingId:c.bookingId,attemptId:c.attemptId,commandId:c.commandId};
  return !s.livemode && s.accountId===accountId && s.id.startsWith('cs_test_') &&
    (!c.sessionId || c.sessionId===s.id) && s.mode==='payment' &&
    s.paymentMethodTypes.length===1 && s.paymentMethodTypes[0]==='card' &&
    s.amountTotal===Number(c.expectedCents) && s.currency==='eur' &&
    s.clientReferenceId===c.bookingId && !('holdId' in s.metadata) &&
    Number.isInteger(s.created) && Number.isInteger(s.expiresAt) &&
    s.expiresAt-s.created>=29*60 && s.expiresAt-s.created<=31*60 &&
    Object.entries(m).every(([k,v])=>s.metadata[k]===v);
}
function matchingPayment(p:PaymentEvidence,s:CheckoutSession,c:BalanceContext):boolean {
  return !p.livemode && p.id===s.paymentIntentId && p.status==='succeeded' &&
    p.currency==='eur' && p.amountReceived===Number(c.expectedCents) &&
    p.chargeId!==null && p.chargePaid && p.chargeCaptured && p.chargeAmount===Number(c.expectedCents) &&
    p.chargeCurrency==='eur' && !('holdId' in p.metadata) &&
    p.metadata.bookingId===c.bookingId && p.metadata.attemptId===c.attemptId && p.metadata.commandId===c.commandId;
}

export async function dispatchBalanceSessionCreate(pool:Pool,gateway:StripeGateway,attemptId:string,
  workerId:string,urls:{successUrl:string;cancelUrl:string}):Promise<CheckoutDispatch> {
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(workerId)) throw new Error('Invalid worker identity');
  const claim=await withBalanceLock(pool,attemptId,async(client,c) => {
    if (c.commandState==='RESOLVED' && c.attemptState==='OPEN' && c.sessionId && c.checkoutUrl &&
        c.sessionExpiresAt && c.sessionExpiresAt.getTime()>Date.now() && c.status==='CONFIRMED')
      return {status:'READY' as const,url:c.checkoutUrl,sessionId:c.sessionId};
    if (c.commandState==='QUARANTINED') return {status:'QUARANTINED' as const};
    if (c.status!=='CONFIRMED' || !['PENDING','SUBMITTED','UNKNOWN'].includes(c.commandState) ||
        (c.leaseExpiresAt && c.leaseExpiresAt.getTime()>Date.now())) return {status:'PENDING' as const};
    if (c.firstSubmittedAt && Date.now()-c.firstSubmittedAt.getTime()>=86_400_000 ||
        c.commandState!=='PENDING' && !c.firstSubmittedAt) {
      await client.query("UPDATE provider_commands SET state='QUARANTINED',last_error_code='IDEMPOTENCY_AGE_UNSAFE',lease_owner=NULL,lease_expires_at=NULL WHERE id=$1",[c.commandId]);
      return {status:'QUARANTINED' as const};
    }
    const fresh:CheckoutRequest={correlation:{bookingId:c.bookingId,attemptId:c.attemptId,commandId:c.commandId},
      paymentPurpose:'BALANCE',
      amountCents:Number(c.expectedCents),expiresAt:Math.floor(Date.now()/1000)+1830,
      successUrl:urls.successUrl,cancelUrl:urls.cancelUrl,idempotencyKey:c.idempotencyKey};
    if (!Number.isSafeInteger(fresh.amountCents) || fresh.amountCents<=0) throw new Error('Invalid balance amount');
    const request=c.requestParams??fresh;
    if (request.correlation.bookingId!==c.bookingId || request.correlation.attemptId!==c.attemptId ||
        request.correlation.commandId!==c.commandId || request.correlation.holdId ||
        request.amountCents!==fresh.amountCents || request.idempotencyKey!==c.idempotencyKey ||
        request.paymentPurpose!==undefined && request.paymentPurpose!=='BALANCE')
      throw new Error('Persisted balance request mismatch');
    const generation=c.leaseGeneration+1n;
    await client.query(`UPDATE provider_commands SET request_params=COALESCE(request_params,$2::jsonb),
      first_submitted_at=COALESCE(first_submitted_at,clock_timestamp()),state='SUBMITTED',lease_owner=$3,
      lease_expires_at=clock_timestamp()+interval '2 minutes',lease_generation=$4,
      attempt_count=attempt_count+1,last_attempt_at=clock_timestamp() WHERE id=$1`,
      [c.commandId,JSON.stringify(request),workerId,generation.toString()]);
    return {request,generation,commandId:c.commandId};
  });
  if (!('request' in claim) || !claim.request) return claim as CheckoutDispatch;
  let session:CheckoutSession;
  try { session=await gateway.createSession(claim.request); }
  catch {
    await withBalanceLock(pool,attemptId,async(client,c)=>{
      if (c.commandId!==claim.commandId || c.leaseGeneration!==claim.generation || c.leaseOwner!==workerId) return;
      await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1 AND state='CREATING'",[attemptId]);
      await client.query("UPDATE provider_commands SET state='UNKNOWN',lease_owner=NULL,lease_expires_at=NULL,last_error_code='CREATE_OUTCOME_UNKNOWN' WHERE id=$1",[c.commandId]);
    });
    return {status:'PENDING'};
  }
  return withBalanceLock(pool,attemptId,async(client,c):Promise<CheckoutDispatch>=>{
    if (c.commandId!==claim.commandId || c.leaseGeneration!==claim.generation || c.leaseOwner!==workerId ||
        c.status!=='CONFIRMED') return {status:'PENDING'};
    if (!matching(session,c,gateway.accountId)) {
      await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1 AND state='CREATING'",[attemptId]);
      await client.query("UPDATE provider_commands SET state='UNKNOWN',lease_owner=NULL,lease_expires_at=NULL,last_error_code='SESSION_EVIDENCE_MISMATCH' WHERE id=$1",[c.commandId]);
      return {status:'PENDING'};
    }
    const open=!!session.url && session.status==='open' && session.paymentStatus==='unpaid' && session.expiresAt*1000>Date.now();
    await client.query(`UPDATE payment_attempts SET state=$2,stripe_session_id=$3,checkout_url=$4,
      session_created_at=to_timestamp($5),session_expires_at=to_timestamp($6),version=version+1 WHERE id=$1`,
      [attemptId,open?'OPEN':'RECONCILING',session.id,session.url,session.created,session.expiresAt]);
    await client.query(`UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),
      lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2 WHERE id=$1`,
      [c.commandId,open?null:'SESSION_REQUIRES_RECONCILIATION']);
    return open?{status:'READY',url:session.url!,sessionId:session.id}:{status:'PENDING'};
  });
}

async function observe(client:PoolClient,c:BalanceContext,s:CheckoutSession,result:string,eventId?:string,
  providerSuccessAt?:number|null):Promise<string> {
  const id=randomUUID();
  await client.query(`INSERT INTO reconciliation_records(id,payment_attempt_id,webhook_event_id,checked_at,
    provider_object_id,provider_state,payment_status,amount_cents,currency,provider_success_at,evidence_kind,result)
    VALUES($1,$2,$3,clock_timestamp(),$4,$5,$6,$7,'EUR',CASE WHEN $9::bigint IS NULL THEN NULL ELSE to_timestamp($9) END,'STRIPE_CURRENT',$8)`,
    [id,c.attemptId,eventId??null,s.id,s.status,s.paymentStatus,c.expectedCents.toString(),result,providerSuccessAt??null]);
  return id;
}

async function quarantineEvidence(client:PoolClient,c:BalanceContext,reason:string):Promise<void> {
  if (['CREATING','OPEN'].includes(c.attemptState))
    await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1",[c.attemptId]);
  const auditId=randomUUID();
  await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
    reason_code,occurred_at) VALUES($1,$2,'SERVICE','balance-payment','balance.evidence_quarantined',
    'payment_attempt',$3,$4,clock_timestamp())`,[auditId,c.bookingId,c.attemptId,reason]);
  await client.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,
    locale,idempotency_key,due_at,state) VALUES($1,$2,$3,'PAYMENT_EVIDENCE_MISMATCH','OPERATIONS','en',
    $4,clock_timestamp(),'QUEUED') ON CONFLICT (idempotency_key) DO NOTHING`,
    [randomUUID(),c.bookingId,auditId,`balance-evidence-mismatch:${c.attemptId}`]);
}

export async function reconcileBalanceAttempt(pool:Pool,gateway:StripeGateway,attemptId:string,
  options:ReconcileOptions={}):Promise<ReconcileResult> {
  const row=await pool.query<{stripe_session_id:string|null}>(
    'SELECT stripe_session_id FROM payment_attempts WHERE id=$1 AND hold_id IS NULL',[attemptId]);
  if (!row.rows[0] || options.sessionLocator && row.rows[0].stripe_session_id &&
      options.sessionLocator!==row.rows[0].stripe_session_id) return 'RECONCILING';
  let sessionId=row.rows[0].stripe_session_id??options.sessionLocator;
  try { if (!sessionId && options.paymentIntentLocator)
    sessionId=(await gateway.findSessionForPaymentIntent(options.paymentIntentLocator))?.id; }
  catch { return 'RECONCILING'; }
  if (!sessionId) return 'RECONCILING';
  let s:CheckoutSession,p:PaymentEvidence|null=null;
  try {
    s=await gateway.retrieveSession(sessionId);
    if (options.paymentIntentLocator && s.paymentIntentId!==options.paymentIntentLocator) return 'RECONCILING';
    if (s.paymentIntentId) p=await gateway.retrievePaymentIntent(s.paymentIntentId);
    if (s.status==='open' && s.paymentStatus==='unpaid' && s.expiresAt*1000<=Date.now()) {
      await gateway.expireSession(s.id,`session-expire:${attemptId}`);
      s=await gateway.retrieveSession(sessionId);
      p=s.paymentIntentId?await gateway.retrievePaymentIntent(s.paymentIntentId):null;
    }
  } catch { return 'RECONCILING'; }
  return withBalanceLock(pool,attemptId,async(client,c):Promise<ReconcileResult>=>{
    if (!matching(s,c,gateway.accountId)) {
      await quarantineEvidence(client,c,'SESSION_IDENTITY_MISMATCH');
      return 'RECONCILING';
    }
    if (!c.sessionId) {
      if (!c.firstSubmittedAt || !c.requestParams) return 'RECONCILING';
      await client.query(`UPDATE payment_attempts SET stripe_session_id=$2,session_created_at=to_timestamp($3),
        session_expires_at=to_timestamp($4),state='RECONCILING',version=version+1 WHERE id=$1`,
        [attemptId,s.id,s.created,s.expiresAt]);
      await client.query("UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,last_error_code='SESSION_RECOVERED' WHERE id=$1",[c.commandId]);
    }
    if (p && (p.livemode || p.id!==s.paymentIntentId || p.currency!=='eur' ||
        p.status==='succeeded' && p.amountReceived!==Number(c.expectedCents) || p.metadata.bookingId!==c.bookingId ||
        p.metadata.attemptId!==attemptId || p.metadata.commandId!==c.commandId ||
        'holdId' in p.metadata || p.status==='succeeded' && p.chargeAmount!==null && p.chargeAmount!==Number(c.expectedCents) ||
        p.chargeCurrency!==null && p.chargeCurrency!=='eur')) {
      await quarantineEvidence(client,c,'PAYMENT_IDENTITY_OR_AMOUNT_MISMATCH');
      return 'RECONCILING';
    }
    if (s.paymentStatus==='paid' && p && matchingPayment(p,s,c)) {
      const prior=await client.query('SELECT id FROM payment_records WHERE stripe_payment_intent_id=$1',[p.id]);
      if (prior.rowCount) return 'ALREADY_RECORDED';
      const eligible=c.status==='CONFIRMED' && (await client.query<{allocated:string}>(`SELECT COALESCE(sum(pa.amount_cents),0)::text allocated
        FROM payment_allocations pa WHERE pa.obligation_id=$1`,[c.obligationId])).rows[0].allocated==='0';
      const successAt=Number.isSafeInteger(p.chargeCreated) && (p.chargeCreated??0)>0 ? p.chargeCreated : null;
      const rec=await observe(client,c,s,eligible?'VERIFIED_BALANCE':'UNALLOCATABLE',options.webhookEventId,successAt);
      const paymentId=randomUUID();
      if (eligible) {
        await client.query(`INSERT INTO payment_records(id,attempt_id,booking_id,obligation_id,stripe_payment_intent_id,
          stripe_charge_id,captured_cents,currency,provider_succeeded_at,verified_at,allocation_state,reconciliation_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,'EUR',CASE WHEN $9::bigint IS NULL THEN NULL ELSE to_timestamp($9) END,clock_timestamp(),'ALLOCATED',$8)`,
          [paymentId,attemptId,c.bookingId,c.obligationId,p.id,p.chargeId,c.expectedCents.toString(),rec,successAt]);
        await client.query('INSERT INTO payment_allocations(id,payment_record_id,obligation_id,amount_cents) VALUES($1,$2,$3,$4)',
          [randomUUID(),paymentId,c.obligationId,c.expectedCents.toString()]);
      } else {
        const incidentId=randomUUID();
        await client.query(`INSERT INTO provider_incidents(id,kind,stripe_payment_intent_id,stripe_session_id,
          source_webhook_event_id,observed_cents,currency,state,opened_at)
          VALUES($1,'LATE_BALANCE_CAPTURE',$2,$3,$4,$5,'EUR','OPEN',clock_timestamp())`,
          [incidentId,p.id,s.id,options.webhookEventId??null,c.expectedCents.toString()]);
        await client.query(`INSERT INTO payment_records(id,provider_incident_id,stripe_payment_intent_id,stripe_charge_id,
          captured_cents,currency,verified_at,allocation_state,reconciliation_id,provider_succeeded_at)
          VALUES($1,$2,$3,$4,$5,'EUR',clock_timestamp(),'UNALLOCATABLE',$6,
            CASE WHEN $7::bigint IS NULL THEN NULL ELSE to_timestamp($7) END)`,
          [paymentId,incidentId,p.id,p.chargeId,c.expectedCents.toString(),rec,successAt]);
        await client.query(`INSERT INTO refund_obligations(id,provider_incident_id,source_payment_record_id,reason,
          amount_cents,business_key,currency) VALUES($1,$2,$3,'UNALLOCATABLE_BALANCE_CAPTURE',$4,$5,'EUR')`,
          [randomUUID(),incidentId,paymentId,c.expectedCents.toString(),`unallocatable:${p.id}`]);
        const auditId=randomUUID();
        await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
          amount_cents,reason_code,occurred_at) VALUES($1,$2,'SERVICE','balance-payment','payment.unallocatable',
          'incident',$3,$4,'BOOKING_INELIGIBLE',clock_timestamp())`,
          [auditId,c.bookingId,incidentId,c.expectedCents.toString()]);
        await client.query(`INSERT INTO notification_outbox(id,provider_incident_id,source_audit_event_id,event_type,
          recipient_kind,locale,idempotency_key,due_at,state) VALUES($1,$2,$3,'UNALLOCATABLE_CAPTURE',
          'OPERATIONS','en',$4,clock_timestamp(),'QUEUED')`,[randomUUID(),incidentId,auditId,`unallocatable-ops:${p.id}`]);
      }
      if (c.attemptState==='CREATING')
        await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1",[attemptId]);
      await client.query("UPDATE payment_attempts SET state='SUCCEEDED',stripe_payment_intent_id=$2,last_reconciliation_id=$3,version=version+1 WHERE id=$1",
        [attemptId,p.id,rec]);
      if (eligible) {
        const auditId=randomUUID();
        await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
          amount_cents,reason_code,occurred_at) VALUES($1,$2,'SERVICE','balance-payment','booking.paid_full',
          'booking',$2,$3,'VERIFIED_BALANCE_CAPTURE',clock_timestamp())`,[auditId,c.bookingId,c.expectedCents.toString()]);
        await client.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,
          recipient_ref,locale,idempotency_key,due_at,state) VALUES($1,$2,$3,'PAID_IN_FULL','GUEST',$4,$5,$6,
          clock_timestamp(),'QUEUED') ON CONFLICT (idempotency_key) DO NOTHING`,
          [randomUUID(),c.bookingId,auditId,c.guestId,c.locale,`paid-full:${paymentId}`]);
      }
      return eligible?'PAID_IN_FULL':'UNALLOCATABLE';
    }
    if (s.status==='expired' && s.paymentStatus==='unpaid' &&
        (!p || ['canceled','requires_payment_method'].includes(p.status))) {
      const rec=await observe(client,c,s,'TERMINAL_UNPAID',options.webhookEventId);
      await client.query("UPDATE payment_attempts SET state='EXPIRED',last_reconciliation_id=$2,version=version+1 WHERE id=$1 AND state<>'EXPIRED'",[attemptId,rec]);
      return 'EXPIRED';
    }
    if (s.status==='complete' && s.paymentStatus==='unpaid' && p?.status==='canceled') {
      const rec=await observe(client,c,s,'TERMINAL_FAILED',options.webhookEventId);
      await client.query("UPDATE payment_attempts SET state='FAILED',last_reconciliation_id=$2,version=version+1 WHERE id=$1 AND state<>'FAILED'",[attemptId,rec]);
      return 'FAILED';
    }
    if (s.status==='open' && s.paymentStatus==='unpaid' && s.expiresAt*1000>Date.now() &&
        (!p || ['requires_payment_method','requires_confirmation'].includes(p.status)) &&
        c.status==='CONFIRMED' && s.url) {
      const rec=await observe(client,c,s,'OPEN_UNPAID',options.webhookEventId);
      if (c.attemptState==='CREATING' || c.attemptState==='RECONCILING')
        await client.query(`UPDATE payment_attempts SET state='OPEN',checkout_url=COALESCE(checkout_url,$2),
          last_reconciliation_id=$3,version=version+1 WHERE id=$1`,[attemptId,s.url,rec]);
      return 'OPEN';
    }
    await observe(client,c,s,'PAYMENT_OUTCOME_UNKNOWN',options.webhookEventId);
    if (['CREATING','OPEN'].includes(c.attemptState))
      await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1",[attemptId]);
    return 'RECONCILING';
  });
}

/** Trusted callable recovery, with no scheduling or cancellation side effects.
 * Unknown creations without a Session ID remain with command recovery/investigation;
 * this sweep never repeats a Session-create POST to discover them.
 */
export async function sweepBalanceAttempts(pool:Pool,gateway:StripeGateway,limit=10,
  onlyBookingId?:string):Promise<ReconcileResult[]> {
  if (!Number.isSafeInteger(limit) || limit<1 || limit>25) throw new RangeError('Invalid batch size');
  const candidates=await pool.query<{id:string}>(`SELECT a.id FROM payment_attempts a
    JOIN payment_obligations o ON o.id=a.obligation_id AND o.booking_id=a.booking_id AND o.kind='BALANCE'
    JOIN provider_commands pc ON pc.payment_attempt_id=a.id AND pc.kind='SESSION_CREATE'
    WHERE a.hold_id IS NULL AND a.stripe_session_id IS NOT NULL
      AND a.state IN ('CREATING','OPEN','RECONCILING')
      AND (pc.lease_expires_at IS NULL OR pc.lease_expires_at<=clock_timestamp())
      AND ($2::uuid IS NULL OR a.booking_id=$2)
    ORDER BY COALESCE((SELECT r.checked_at FROM reconciliation_records r
      WHERE r.payment_attempt_id=a.id ORDER BY r.checked_at DESC LIMIT 1),a.created_at),a.id
    LIMIT $1`,[limit,onlyBookingId??null]);
  const results:ReconcileResult[]=[];
  for (const candidate of candidates.rows)
    results.push(await reconcileBalanceAttempt(pool,gateway,candidate.id));
  return results;
}
