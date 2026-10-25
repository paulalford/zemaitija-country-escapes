import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withInitialLock, type InitialContext } from './payment-locks';
import type { CheckoutSession, PaymentEvidence, StripeGateway } from './stripe-adapter';

export type ReconciliationResult = 'CONFIRMED'|'ALREADY_RECORDED'|'UNALLOCATABLE'|'OPEN'|'RELEASED'|'RECONCILING';
type Options={testFailAfter?:'PAYMENT_RECORD';webhookEventId?:string;
  sessionLocator?:string;paymentIntentLocator?:string};
function sessionIdentity(c:InitialContext,s:CheckoutSession,accountId:string):boolean {
  const m={bookingId:c.bookingId,holdId:c.holdId,attemptId:c.attemptId,commandId:c.commandId};
  return !s.livemode && s.accountId===accountId && s.id.startsWith('cs_test_') &&
    (!c.sessionId || c.sessionId===s.id) && s.mode==='payment' &&
    s.paymentMethodTypes.length===1 && s.paymentMethodTypes[0]==='card' &&
    s.currency==='eur' && s.amountTotal===Number(c.expectedCents) &&
    s.clientReferenceId===c.bookingId && Number.isInteger(s.created) &&
    Number.isInteger(s.expiresAt) && s.expiresAt-s.created>=29*60 &&
    s.expiresAt-s.created<=31*60 &&
    Object.entries(m).every(([key,value])=>s.metadata[key]===value);
}
function correlated(c:InitialContext,s:CheckoutSession,p:PaymentEvidence|null):boolean {
  const m={bookingId:c.bookingId,holdId:c.holdId,attemptId:c.attemptId,commandId:c.commandId};
  return !s.livemode && s.id===c.sessionId && s.mode==='payment' && s.currency==='eur' &&
    s.amountTotal===Number(c.expectedCents) && s.clientReferenceId===c.bookingId &&
    Object.entries(m).every(([key,value])=>s.metadata[key]===value) &&
    (!p || (!p.livemode && s.paymentIntentId===p.id && p.currency==='eur' &&
      p.amountReceived===Number(c.expectedCents) && Object.entries(m).every(([key,value])=>p.metadata[key]===value)));
}
async function validateAndBindSession(pool:Pool,attemptId:string,s:CheckoutSession,
  accountId:string,eventId?:string):Promise<boolean> {
  return withInitialLock(pool,attemptId,async (client,c) => {
    if (!sessionIdentity(c,s,accountId)) return false;
    if (c.sessionId) return true;
    if (!c.firstSubmittedAt || !c.requestParams || c.status!=='AWAITING_INITIAL_PAYMENT' ||
        c.claimHoldId!==c.holdId || c.claimReleasedAt) return false;
    const rec=await observation(client,c,s,null,'SESSION_ID_RECOVERED',eventId);
    await client.query(`UPDATE payment_attempts SET stripe_session_id=$2,
      session_created_at=to_timestamp($3),session_expires_at=to_timestamp($4),
      state='RECONCILING',last_reconciliation_id=$5,version=version+1 WHERE id=$1`,
      [attemptId,s.id,s.created,s.expiresAt,rec]);
    if (c.holdState==='CREATING' || c.holdState==='ACTIVE')
      await client.query("UPDATE inventory_holds SET state='RECONCILING',version=version+1 WHERE id=$1",[c.holdId]);
    if (c.commandState!=='RESOLVED')
      await client.query(`UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),
        lease_owner=NULL,lease_expires_at=NULL,last_error_code='SESSION_RECOVERED' WHERE id=$1`,[c.commandId]);
    await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
      reason_code,occurred_at) VALUES($1,$2,'SERVICE','payment-reconciliation','session.recovered',
      'payment_attempt',$3,'CURRENT_PROVIDER_SESSION',clock_timestamp())`,[randomUUID(),c.bookingId,attemptId]);
    return true;
  });
}
async function observation(client:PoolClient,c:InitialContext,s:CheckoutSession,p:PaymentEvidence|null,
  result:string,eventId?:string):Promise<string> {
  const id=randomUUID();
  await client.query(`INSERT INTO reconciliation_records(id,payment_attempt_id,webhook_event_id,checked_at,
    provider_object_id,provider_state,payment_status,amount_cents,currency,evidence_kind,result)
    VALUES($1,$2,$3,clock_timestamp(),$4,$5,$6,$7,'EUR','STRIPE_CURRENT',$8)`,
    [id,c.attemptId,eventId??null,s.id,s.status,s.paymentStatus,p?.amountReceived??s.amountTotal,result]);
  return id;
}
async function uncertain(pool:Pool,attemptId:string,s:CheckoutSession|null,p:PaymentEvidence|null,reason:string,
  eventId?:string):Promise<ReconciliationResult> {
  return withInitialLock<ReconciliationResult>(pool,attemptId,async (client,c) => {
    if (c.status!=='AWAITING_INITIAL_PAYMENT' || c.claimReleasedAt) return 'RECONCILING';
    if (s) await observation(client,c,s,p,reason,eventId);
    if (c.attemptState==='CREATING' || c.attemptState==='OPEN')
      await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1",[attemptId]);
    if (c.holdState==='CREATING' || c.holdState==='ACTIVE')
      await client.query("UPDATE inventory_holds SET state='RECONCILING',version=version+1 WHERE id=$1",[c.holdId]);
    if (c.commandState==='SUBMITTED')
      await client.query("UPDATE provider_commands SET state='UNKNOWN',lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2 WHERE id=$1",[c.commandId,reason]);
    return 'RECONCILING';
  });
}

/** Retrieves current provider objects before any financial or inventory transaction. */
export async function reconcileInitialAttempt(pool:Pool,gateway:StripeGateway,attemptId:string,
  options:Options={}):Promise<ReconciliationResult> {
  if (options.testFailAfter && process.env.NODE_ENV!=='test') throw new Error('Test failure injection unavailable');
  const current=await pool.query<{stripe_session_id:string|null}>(
    'SELECT stripe_session_id FROM payment_attempts WHERE id=$1',[attemptId]);
  if (options.sessionLocator && current.rows[0]?.stripe_session_id &&
      current.rows[0].stripe_session_id!==options.sessionLocator) return 'RECONCILING';
  let sessionId=current.rows[0]?.stripe_session_id ?? options.sessionLocator;
  if (!sessionId && options.paymentIntentLocator) {
    try { sessionId=(await gateway.findSessionForPaymentIntent(options.paymentIntentLocator))?.id; }
    catch { return uncertain(pool,attemptId,null,null,'SESSION_LOOKUP_UNKNOWN',options.webhookEventId); }
  }
  if (!sessionId) return 'RECONCILING';
  let session:CheckoutSession,payment:PaymentEvidence|null=null;
  try {
    session=await gateway.retrieveSession(sessionId);
  } catch { return uncertain(pool,attemptId,null,null,'PROVIDER_RETRIEVAL_UNKNOWN',options.webhookEventId); }
  if (options.paymentIntentLocator && session.paymentIntentId!==options.paymentIntentLocator)
    return uncertain(pool,attemptId,session,null,'PAYMENT_INTENT_SESSION_MISMATCH',options.webhookEventId);
  if (!await validateAndBindSession(pool,attemptId,session,gateway.accountId,options.webhookEventId))
    return uncertain(pool,attemptId,session,null,'PROVIDER_IDENTITY_MISMATCH',options.webhookEventId);
  try {
    if (session.paymentIntentId) payment=await gateway.retrievePaymentIntent(session.paymentIntentId);
    if (session.status==='open' && session.paymentStatus==='unpaid' &&
        session.expiresAt*1000<=Date.now()) {
      await gateway.expireSession(session.id,`session-expire:${attemptId}`);
      session=await gateway.retrieveSession(sessionId);
      payment=session.paymentIntentId ? await gateway.retrievePaymentIntent(session.paymentIntentId) : null;
    }
  } catch { return uncertain(pool,attemptId,null,null,'PROVIDER_RETRIEVAL_UNKNOWN',options.webhookEventId); }
  const context=await pool.query<{booking_id:string;hold_id:string;command_id:string;expected_cents:string}>(
    `SELECT a.booking_id,a.hold_id,pc.id command_id,a.expected_cents::text FROM payment_attempts a
     JOIN provider_commands pc ON pc.payment_attempt_id=a.id AND pc.kind='SESSION_CREATE' WHERE a.id=$1`,[attemptId]);
  const identity=context.rows[0];
  if (!identity) return 'RECONCILING';
  const check={bookingId:identity.booking_id,holdId:identity.hold_id,attemptId,commandId:identity.command_id};
  const basic=!session.livemode && session.accountId===gateway.accountId && session.id===sessionId &&
    session.mode==='payment' && session.amountTotal===Number(identity.expected_cents) &&
    session.currency==='eur' && session.clientReferenceId===check.bookingId &&
    Object.entries(check).every(([k,v])=>session.metadata[k]===v);
  if (!basic || payment && (!correlated({bookingId:check.bookingId,holdId:check.holdId,attemptId,
    commandId:check.commandId,expectedCents:BigInt(identity.expected_cents),sessionId} as InitialContext,session,payment))) {
    return uncertain(pool,attemptId,session,payment,'PROVIDER_IDENTITY_MISMATCH',options.webhookEventId);
  }
  const paid=session.paymentStatus==='paid' && payment?.status==='succeeded' &&
    payment.chargeId!==null && payment.chargePaid && payment.chargeCaptured &&
    payment.chargeAmount===session.amountTotal && payment.chargeCurrency==='eur';
  if (paid) return recordSuccess(pool,attemptId,session,payment!,options);
  if (session.status==='expired' && session.paymentStatus==='unpaid' &&
      (!payment || ['canceled','requires_payment_method'].includes(payment.status))) {
    return releaseTerminalUnpaid(pool,attemptId,session,payment,options.webhookEventId);
  }
  if (session.status==='open' && session.paymentStatus==='unpaid' && session.expiresAt*1000>Date.now() &&
      (!payment || ['requires_payment_method','requires_confirmation'].includes(payment.status))) {
    return recoverOpen(pool,attemptId,session,payment,options.webhookEventId);
  }
  return uncertain(pool,attemptId,session,payment,'PAYMENT_OUTCOME_UNKNOWN',options.webhookEventId);
}

async function recoverOpen(pool:Pool,attemptId:string,s:CheckoutSession,p:PaymentEvidence|null,eventId?:string):Promise<ReconciliationResult> {
  return withInitialLock(pool,attemptId,async (client,c) => {
    if (c.status!=='AWAITING_INITIAL_PAYMENT' || c.claimHoldId!==c.holdId || c.claimReleasedAt ||
        !correlated(c,s,p) || !s.url || s.expiresAt*1000<=Date.now()) return 'RECONCILING';
    const rec=await observation(client,c,s,p,'OPEN_UNPAID',eventId);
    if (c.attemptState==='RECONCILING' || c.attemptState==='CREATING')
      await client.query(`UPDATE payment_attempts SET state='OPEN',stripe_session_id=COALESCE(stripe_session_id,$2),
        checkout_url=COALESCE(checkout_url,$3),session_created_at=COALESCE(session_created_at,to_timestamp($4)),
        session_expires_at=COALESCE(session_expires_at,to_timestamp($5)),last_reconciliation_id=$6,version=version+1 WHERE id=$1`,
        [attemptId,s.id,s.url,s.created,s.expiresAt,rec]);
    if (c.holdState==='RECONCILING' || c.holdState==='CREATING')
      await client.query("UPDATE inventory_holds SET state='ACTIVE',version=version+1 WHERE id=$1",[c.holdId]);
    if (c.commandState!=='RESOLVED')
      await client.query("UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL WHERE id=$1",[c.commandId]);
    return 'OPEN';
  });
}

async function releaseTerminalUnpaid(pool:Pool,attemptId:string,s:CheckoutSession,p:PaymentEvidence|null,eventId?:string):Promise<ReconciliationResult> {
  return withInitialLock(pool,attemptId,async (client,c) => {
    if (c.status==='EXPIRED' || c.status==='CONFIRMED') return c.status==='EXPIRED'?'RELEASED':'ALREADY_RECORDED';
    if (c.claimHoldId!==c.holdId || c.claimReleasedAt || !correlated(c,s,p) ||
        s.status!=='expired' || s.paymentStatus!=='unpaid' ||
        p && !['canceled','requires_payment_method'].includes(p.status)) return 'RECONCILING';
    const rec=await observation(client,c,s,p,'TERMINAL_UNPAID',eventId);
    await client.query("UPDATE payment_attempts SET state='EXPIRED',last_reconciliation_id=$2,version=version+1 WHERE id=$1",[attemptId,rec]);
    await client.query("UPDATE inventory_claims SET released_at=clock_timestamp(),release_reason='PROVIDER_TERMINAL_UNPAID',version=version+1 WHERE id=$1",[c.claimId]);
    await client.query("UPDATE inventory_holds SET state='RELEASED',terminal_at=clock_timestamp(),version=version+1 WHERE id=$1",[c.holdId]);
    await client.query("UPDATE bookings SET status='EXPIRED',version=version+1 WHERE id=$1",[c.bookingId]);
    if (c.commandState!=='RESOLVED')
      await client.query("UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,last_error_code='TERMINAL_UNPAID' WHERE id=$1",[c.commandId]);
    await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,prior_state,new_state,reason_code,occurred_at)
      VALUES($1,$2,'SERVICE','payment-reconciliation','hold.released','hold',$3,$4,'RELEASED','PROVIDER_TERMINAL_UNPAID',clock_timestamp())`,
      [randomUUID(),c.bookingId,c.holdId,c.holdState]);
    return 'RELEASED';
  });
}

async function recordSuccess(pool:Pool,attemptId:string,s:CheckoutSession,p:PaymentEvidence,options:Options):Promise<ReconciliationResult> {
  return withInitialLock(pool,attemptId,async (client,c) => {
    if (!correlated(c,s,p) || !p.chargeId || !p.chargeCaptured || !p.chargePaid ||
        p.chargeAmount!==Number(c.expectedCents) || p.chargeCurrency!=='eur' ||
        s.paymentStatus!=='paid' || p.status!=='succeeded') return 'RECONCILING';
    const prior=await client.query<{id:string}>('SELECT id FROM payment_records WHERE stripe_payment_intent_id=$1',[p.id]);
    if (prior.rows[0]) return 'ALREADY_RECORDED';
    if (c.status==='AWAITING_INITIAL_PAYMENT' && c.claimHoldId===c.holdId && !c.claimReleasedAt) {
      const rec=await observation(client,c,s,p,'VERIFIED_INITIAL',options.webhookEventId);
      const paymentId=randomUUID(),auditId=randomUUID();
      await client.query(`INSERT INTO payment_records(id,attempt_id,booking_id,obligation_id,stripe_payment_intent_id,
        stripe_charge_id,captured_cents,currency,verified_at,allocation_state,reconciliation_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,'EUR',clock_timestamp(),'ALLOCATED',$8)`,
        [paymentId,attemptId,c.bookingId,c.obligationId,p.id,p.chargeId,c.expectedCents.toString(),rec]);
      if (options.testFailAfter==='PAYMENT_RECORD') throw new Error('test reconciliation interruption');
      await client.query('INSERT INTO payment_allocations(id,payment_record_id,obligation_id,amount_cents) VALUES($1,$2,$3,$4)',
        [randomUUID(),paymentId,c.obligationId,c.expectedCents.toString()]);
      if (c.attemptState==='CREATING')
        await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1",[attemptId]);
      await client.query("UPDATE payment_attempts SET state='SUCCEEDED',stripe_payment_intent_id=$2,last_reconciliation_id=$3,version=version+1 WHERE id=$1",[attemptId,p.id,rec]);
      await client.query('UPDATE inventory_claims SET hold_id=NULL,booking_id=$2,origin_hold_id=$3,version=version+1 WHERE id=$1',
        [c.claimId,c.bookingId,c.holdId]);
      await client.query("UPDATE inventory_holds SET state='CONSUMED',terminal_at=clock_timestamp(),version=version+1 WHERE id=$1",[c.holdId]);
      await client.query("UPDATE bookings SET status='CONFIRMED',version=version+1 WHERE id=$1",[c.bookingId]);
      await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
        prior_state,new_state,amount_cents,reason_code,occurred_at)
        VALUES($1,$2,'SERVICE','payment-reconciliation','booking.confirmed','booking',$2,
          'AWAITING_INITIAL_PAYMENT','CONFIRMED',$3,'VERIFIED_INITIAL_CAPTURE',clock_timestamp())`,
        [auditId,c.bookingId,c.expectedCents.toString()]);
      await client.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,
        recipient_ref,locale,idempotency_key,due_at,state)
        VALUES($1,$2,$3,'BOOKING_CONFIRMED','GUEST',$4,$5,$6,clock_timestamp(),'QUEUED')
        ON CONFLICT (idempotency_key) DO NOTHING`,
        [randomUUID(),c.bookingId,auditId,c.guestId,c.locale,`booking-confirmed:${c.bookingId}`]);
      const schedule=await client.query<{balance_cents:string}>('SELECT balance_cents::text FROM price_snapshots WHERE booking_id=$1',[c.bookingId]);
      if (schedule.rows[0]?.balance_cents==='0') {
        await client.query(`INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,
          recipient_ref,locale,idempotency_key,due_at,state)
          VALUES($1,$2,$3,'PAID_IN_FULL','GUEST',$4,$5,$6,clock_timestamp(),'QUEUED')
          ON CONFLICT (idempotency_key) DO NOTHING`,
          [randomUUID(),c.bookingId,auditId,c.guestId,c.locale,`paid-full:${paymentId}`]);
      }
      return 'CONFIRMED';
    }
    const incidentId=randomUUID(),paymentId=randomUUID(),auditId=randomUUID();
    await client.query(`INSERT INTO provider_incidents(id,kind,stripe_payment_intent_id,stripe_session_id,
      source_webhook_event_id,observed_cents,currency,state,opened_at)
      VALUES($1,'LATE_INITIAL_CAPTURE',$2,$3,$4,$5,'EUR','OPEN',clock_timestamp())`,
      [incidentId,p.id,s.id,options.webhookEventId??null,c.expectedCents.toString()]);
    const rec=randomUUID();
    await client.query(`INSERT INTO reconciliation_records(id,provider_incident_id,webhook_event_id,checked_at,
      provider_object_id,provider_state,payment_status,amount_cents,currency,evidence_kind,result)
      VALUES($1,$2,$3,clock_timestamp(),$4,$5,$6,$7,'EUR','STRIPE_CURRENT','UNALLOCATABLE')`,
      [rec,incidentId,options.webhookEventId??null,p.id,p.status,s.paymentStatus,c.expectedCents.toString()]);
    await client.query(`INSERT INTO payment_records(id,provider_incident_id,stripe_payment_intent_id,stripe_charge_id,
      captured_cents,currency,verified_at,allocation_state,reconciliation_id)
      VALUES($1,$2,$3,$4,$5,'EUR',clock_timestamp(),'UNALLOCATABLE',$6)`,
      [paymentId,incidentId,p.id,p.chargeId,c.expectedCents.toString(),rec]);
    await client.query(`INSERT INTO refund_obligations(id,provider_incident_id,source_payment_record_id,reason,
      amount_cents,business_key,currency) VALUES($1,$2,$3,'UNALLOCATABLE_INITIAL_CAPTURE',$4,$5,'EUR')`,
      [randomUUID(),incidentId,paymentId,c.expectedCents.toString(),`unallocatable:${p.id}`]);
    await client.query("UPDATE payment_attempts SET state='SUCCEEDED',stripe_payment_intent_id=$2,version=version+1 WHERE id=$1",[attemptId,p.id]);
    await client.query(`INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,
      amount_cents,reason_code,occurred_at)
      VALUES($1,$2,'SERVICE','payment-reconciliation','payment.unallocatable','incident',$3,$4,
        'ORIGINAL_CLAIM_UNAVAILABLE',clock_timestamp())`,
      [auditId,c.bookingId,incidentId,c.expectedCents.toString()]);
    await client.query(`INSERT INTO notification_outbox(id,provider_incident_id,source_audit_event_id,event_type,
      recipient_kind,locale,idempotency_key,due_at,state)
      VALUES($1,$2,$3,'UNALLOCATABLE_CAPTURE','OPERATIONS','en',$4,clock_timestamp(),'QUEUED')`,
      [randomUUID(),incidentId,auditId,`unallocatable-ops:${p.id}`]);
    return 'UNALLOCATABLE';
  });
}

export async function sweepInitialAttempts(pool:Pool,gateway:StripeGateway,limit=10):Promise<ReconciliationResult[]> {
  if (!Number.isSafeInteger(limit) || limit<1 || limit>25) throw new RangeError('Invalid batch size');
  const candidates=await pool.query<{id:string}>(`SELECT id FROM payment_attempts WHERE hold_id IS NOT NULL
    AND stripe_session_id IS NOT NULL AND state IN ('OPEN','RECONCILING','EXPIRED')
    ORDER BY created_at LIMIT $1`,[limit]);
  const results:ReconciliationResult[]=[];
  for (const candidate of candidates.rows) results.push(await reconcileInitialAttempt(pool,gateway,candidate.id));
  return results;
}
