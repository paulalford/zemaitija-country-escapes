import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ACCEPTANCE_SCENARIOS, planAcceptanceFixtures } from '../src/server/stripe-acceptance-fixtures';
import { inspectAcceptanceStatus, type AcceptanceStatusSnapshot, type AcceptanceReadOnlyStatusAdapter } from '../src/server/stripe-acceptance-status';
import { scenarioRun } from './helpers/stripe-acceptance-scenario-fixture';
import { quoteDeadlines, splitPayment } from '../src/server/quote-math';

vi.mock('pg',()=>{throw Error('Database forbidden');});
vi.mock('stripe',()=>{throw Error('Stripe forbidden');});
vi.mock('../src/db/client',()=>{throw Error('Shared pool forbidden');});
vi.mock('../scripts/lib/stripe-automation-docker',()=>{throw Error('Docker forbidden');});
vi.mock('../src/server/booking-acceptance',()=>{throw Error('Acceptance execution forbidden');});
vi.mock('../src/server/checkout-worker',()=>{throw Error('Dispatch forbidden');});
vi.mock('../src/server/payment-reconciliation',()=>{throw Error('Reconciliation forbidden');});
vi.mock('../src/server/stripe-automation-runner',()=>{throw Error('Runner forbidden');});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2035-01-01T00:01:00.000Z'));
  vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Network forbidden');}));});
afterEach(()=>{expect(globalThis.fetch).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
function planner(run=scenarioRun()) {
  const limits={maxFixtures:5,maxTotalCents:500000,maxInitialCents:150000,previousNamespaces:[] as string[],previousGuestIds:[] as string[]};
  const request={scenarios:[...ACCEPTANCE_SCENARIOS],baseArrivalDate:'2035-02-10',nightlyCents:10000};
  const verify=vi.fn(async(binding:{runId:string;manifestDigest:string;requestDigest:string})=>({status:'SOURCE_PLAN_VERIFIED',
    runId:binding.runId,manifestDigest:binding.manifestDigest,requestDigest:binding.requestDigest,notBefore:run.notBefore,
    expiresAt:run.expiresAt,inventoryComplete:true,...limits}));
  const deps={now:Date.now,authority:{verify}};
  return {run,request,limits,deps,verify,plan:()=>planAcceptanceFixtures(run,request,deps)};
}
async function planned(f=planner()) {
  const result=await f.plan();if(result.status!=='PLANNED')throw Error('Synthetic fixture plan rejected');return result.plan;
}
const id=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function statusFixture(name:typeof ACCEPTANCE_SCENARIOS[number]='SIGNED_WEBHOOK') {
  const f=planner(),plan=await planned(f),fixture=plan.fixtures.find(x=>x.name===name)!;
  const binding={bookingId:id(1),holdId:id(2),attemptId:id(3),commandId:id(4),snapshotId:id(5),obligationId:id(6),claimId:id(7)};
  const snapshot:AcceptanceStatusSnapshot={runId:f.run.runId,manifestDigest:plan.manifestDigest,planDigest:plan.planDigest,
    fixtureId:fixture.fixtureId,namespace:fixture.namespace,database:f.run.target.database,role:'zec_acceptance_status_reader',
    readOnly:true,isolation:'REPEATABLE READ',complete:true,settled:true,observedAt:new Date().toISOString(),transactionId:'123',
    binding,guestId:fixture.guest.id,unitId:fixture.stay.unitId,operationKey:fixture.operationKey,currency:'EUR',
    booking:{id:binding.bookingId,guestId:fixture.guest.id,unitId:fixture.stay.unitId,state:'AWAITING_INITIAL_PAYMENT'},
    hold:{id:binding.holdId,bookingId:binding.bookingId,attemptId:binding.attemptId,state:'CREATING'},
    obligation:{id:binding.obligationId,bookingId:binding.bookingId,kind:'INITIAL',amountCents:fixture.expected.initialCents},
    price:{id:binding.snapshotId,bookingId:binding.bookingId,totalCents:fixture.expected.totalCents,
      initialCents:fixture.expected.initialCents,balanceCents:fixture.expected.balanceCents},
    attempt:{id:binding.attemptId,bookingId:binding.bookingId,obligationId:binding.obligationId,holdId:binding.holdId,state:'CREATING',
      expectedCents:fixture.expected.initialCents,sessionId:null,checkoutUrl:null,sessionCreatedAt:null,sessionExpiresAt:null,
      recoveryEnabled:true,recoveryNextAt:'2035-01-01T00:02:00.000Z',recoveryLeaseUntil:null,recoveryFailures:0},
    command:{id:binding.commandId,attemptId:binding.attemptId,kind:'SESSION_CREATE',state:'PENDING',logicalKey:fixture.expected.logicalKey,
      idempotencyKey:`session-create:${binding.attemptId}`,requestPersisted:false,firstSubmittedAt:null,leaseOwner:null,leaseUntil:null,
      leaseGeneration:'0',attemptCount:0},
    claim:{id:binding.claimId,unitId:fixture.stay.unitId,holdId:binding.holdId,bookingId:null,originHoldId:null,releasedAt:null,activeClaimCount:1},
    payments:[],allocations:[],provider:{observation:'NONE',source:'NONE',accountId:f.run.stripe.accountId,livemode:false,paymentIntentId:null,
      chargeId:null,sessionId:null,amountCents:0,reconciliationId:null,verifiedAt:null,webhookEventId:null,recoveryInvocationId:null},confirmations:[],notices:[],
    events:{verifiedPaymentEvents:0,duplicateDeliveries:0,outOfOrderObserved:false,conflictingDigests:0},
    investigationCount:0,unresolvedRefundLiabilities:0,delayedCommandObserved:false};
  const grant={status:'READ_ONLY_VERIFIED',runId:f.run.runId,manifestDigest:plan.manifestDigest,planDigest:plan.planDigest,
    fixtureId:fixture.fixtureId,operation:'verify-read-only',targetVerified:true,reservationVerified:true,
    notBefore:f.run.notBefore,expiresAt:f.run.expiresAt};
  const authority={verify:vi.fn(async()=>({...grant}))};
  const read=vi.fn<AcceptanceReadOnlyStatusAdapter['read']>(async()=>snapshot),query:AcceptanceReadOnlyStatusAdapter={kind:'acceptance-status-read-only-v1',read};
  const deps={now:Date.now,authority,query};
  function ready() {
    snapshot.command.state='RESOLVED';snapshot.command.requestPersisted=true;snapshot.command.firstSubmittedAt='2035-01-01T00:00:10.000Z';
    snapshot.command.attemptCount=1;snapshot.command.leaseGeneration='9007199254740998';snapshot.attempt.state='OPEN';snapshot.hold.state='ACTIVE';
    snapshot.attempt.sessionId='cs_test_synthetic';snapshot.attempt.checkoutUrl='https://checkout.stripe.com/c/pay/synthetic';
    snapshot.attempt.sessionCreatedAt='2035-01-01T00:00:20.000Z';snapshot.attempt.sessionExpiresAt='2035-01-01T00:30:20.000Z';
  }
  function confirmed() {
    ready();snapshot.booking.state='CONFIRMED';snapshot.hold.state='CONSUMED';snapshot.attempt.state='SUCCEEDED';
    snapshot.claim.holdId=null;snapshot.claim.bookingId=binding.bookingId;snapshot.claim.originHoldId=binding.holdId;
    snapshot.payments.push({id:id(8),attemptId:binding.attemptId,bookingId:binding.bookingId,obligationId:binding.obligationId,
      amountCents:fixture.expected.initialCents,paymentIntentId:'pi_synthetic',chargeId:'ch_synthetic',reconciliationId:id(9),allocationState:'ALLOCATED'});
    snapshot.allocations.push({id:id(10),paymentId:id(8),obligationId:binding.obligationId,amountCents:fixture.expected.initialCents});
    Object.assign(snapshot.provider,{observation:'VERIFIED_CAPTURE',source:'SIGNED_WEBHOOK_AND_RECONCILIATION',paymentIntentId:'pi_synthetic',
      chargeId:'ch_synthetic',sessionId:'cs_test_synthetic',amountCents:fixture.expected.initialCents,reconciliationId:id(9),
      verifiedAt:snapshot.observedAt,webhookEventId:id(13)});
    snapshot.confirmations.push({id:id(11),bookingId:binding.bookingId,action:'booking.confirmed'});
    snapshot.notices.push({id:id(12),bookingId:binding.bookingId,auditId:id(11),event:'BOOKING_CONFIRMED',key:`booking-confirmed:${binding.bookingId}`});
    snapshot.events.verifiedPaymentEvents=1;
  }
  return {f,plan,fixture,snapshot,grant,deps,read,ready,confirmed,
    inspect:()=>inspectAcceptanceStatus(f.run,plan,fixture.fixtureId,deps)};
}

describe('pure fixture plans',()=>{
  it('produces stable frozen plans with symbolic runtime bindings and existing domain math',async()=>{
    const f=planner(),a=await planned(f),b=await planned(f);
    expect(a).toEqual(b);expect(a.writesEnabled).toBe(false);expect(Object.isFrozen(a.fixtures[0].expected)).toBe(true);
    expect(a.fixtures.map(x=>x.name)).toEqual(ACCEPTANCE_SCENARIOS);expect(a.totals).toMatchObject({fixtures:5,totalCents:50000,initialCents:15000});
    expect(new Set(a.fixtures.map(x=>x.guest.id)).size).toBe(5);
    for(const item of a.fixtures) {
      expect(item.expected.relationships).toContain('command.attempt=attempt');expect(item.slots.booking).toContain(a.namespace);
      expect(item.expected.initialCents).toBe(Number(splitPayment(10000n,new Date(f.run.notBefore),quoteDeadlines(item.stay.arrivalDate).balance).initialCents));
      expect(item.proposedWrites).toMatchObject({domainBookingInserts:10,holdAttemptLinkUpdates:1});
    }
  });
  it('separates namespaces and guest identities across runs',async()=>{
    const a=await planned(),b=await planned(planner(scenarioRun('10000000-0000-4000-8000-000000000002')));
    expect(a.namespace).not.toBe(b.namespace);expect(a.fixtures.some(x=>b.fixtures.some(y=>x.guest.id===y.guest.id||x.fixtureId===y.fixtureId))).toBe(false);
  });
  it.each(['zemaitija_dev','zemaitija_stripe_automation_dev'])('rejects protected target %s',async database=>{
    const f=planner(),clone=structuredClone(f.run);Object.assign(clone.target,{database});
    expect((await planAcceptanceFixtures(clone,f.request,f.deps)).status).toBe('REJECTED');expect(f.verify).not.toHaveBeenCalled();
  });
  it.each([{nightlyCents:100001},{nightlyCents:1},{nightlyCents:-1},{nightlyCents:1.5},{scenarios:[]},{scenarios:['UNKNOWN']},
    {scenarios:['SIGNED_WEBHOOK','SIGNED_WEBHOOK']},{baseArrivalDate:'2035-02-30'},{namespace:'foreign'},{currency:'USD'},{mode:'live'}])
  ('rejects malformed or excessive request %#',async change=>{
    const f=planner();expect((await planAcceptanceFixtures(f.run,{...f.request,...change},f.deps)).status).toBe('REJECTED');
  });
  it.each(['maxFixtures','maxTotalCents','maxInitialCents'] as const)('enforces reviewed %s',async key=>{
    const f=planner();f.limits[key]=1;expect(await f.plan()).toEqual({status:'REJECTED',diagnostic:'BUDGET_EXCEEDED'});
  });
  it('enforces manifest invocation/item/provider quotas and complete history',async()=>{
    const f=planner(scenarioRun(undefined,1));expect((await f.plan()).status).toBe('REJECTED');
    const g=planner();g.verify.mockImplementation(async()=>({status:'PENDING_EXTERNAL_ATTESTATION'} as never));
    expect((await g.plan()).status).toBe('REJECTED');
  });
  it('rejects reused namespaces and guests',async()=>{
    const f=planner();f.limits.previousNamespaces.push(f.run.fixtures.namespace);expect((await f.plan()).status).toBe('REJECTED');
    const g=planner();g.limits.previousGuestIds.push(g.run.fixtures.guestId);expect((await g.plan()).status).toBe('REJECTED');
  });
  it('rejects expired planning authority without printing raw failures',async()=>{
    const f=planner();vi.setSystemTime('2035-01-01T00:31:00Z');expect((await f.plan()).status).toBe('REJECTED');
    f.verify.mockRejectedValue(Error('private credential'));expect(JSON.stringify(await f.plan())).not.toContain('private credential');
  });
});

describe('read-only status contracts',()=>{
  it('invokes only the fixed read adapter with a frozen run/fixture binding',async()=>{
    const f=await statusFixture(),r=await f.inspect();expect(r).toMatchObject({status:'OBSERVED',progress:'COMMAND_PENDING'});
    expect(f.read).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({runId:f.f.run.runId,planDigest:f.plan.planDigest,fixtureId:f.fixture.fixtureId}));
    expect(Object.isFrozen(f.read.mock.calls[0][0])).toBe(true);
    expect(r.booking.confirmationVerified).toBe(false);expect(r.payment.captureVerified).toBe(false);
  });
  it.each(['runId','manifestDigest','planDigest','namespace','database','guestId','unitId','operationKey'] as const)
  ('rejects foreign %s',async key=>{
    const f=await statusFixture();Object.assign(f.snapshot,{[key]:key.endsWith('Digest')?'a'.repeat(64):key==='runId'||key.endsWith('Id')?id(90):'foreign'});
    expect((await f.inspect()).status).toBe('REJECTED');
  });
  it('rejects mismatched relationships and duplicate financial effects',async()=>{
    const f=await statusFixture();f.snapshot.command.attemptId=id(99);expect((await f.inspect()).progress).toBe('UNKNOWN');
    const g=await statusFixture();g.confirmed();g.snapshot.allocations.push({...g.snapshot.allocations[0],id:id(99)});
    expect((await g.inspect()).progress).toBe('UNKNOWN');
  });
  it.each(['complete','settled','readOnly'] as const)('rejects incomplete/uncertain adapter evidence %s',async key=>{
    const f=await statusFixture();Object.assign(f.snapshot,{[key]:false});expect((await f.inspect()).progress).toBe('UNKNOWN');
  });
  it('reports unavailable, stale and ambiguous queries as unknown',async()=>{
    const f=await statusFixture();f.read.mockRejectedValue(Error('private URL'));expect((await f.inspect()).progress).toBe('UNKNOWN');
    const g=await statusFixture();g.snapshot.observedAt='2035-01-01T00:00:29.000Z';expect((await g.inspect()).progress).toBe('UNKNOWN');
    const h=await statusFixture();h.read.mockResolvedValue(undefined as never);expect((await h.inspect()).progress).toBe('UNKNOWN');
  });
  it('rejects absent, write-capable or pool-like adapters before invoking them',async()=>{
    const f=await statusFixture();
    for(const query of [undefined,{...f.deps.query,write:vi.fn()},{...f.deps.query,connect:vi.fn()}]) {
      const r=await inspectAcceptanceStatus(f.f.run,f.plan,f.fixture.fixtureId,{...f.deps,query} as typeof f.deps);
      expect(r.diagnostic).toBe('QUERY_ADAPTER_UNAVAILABLE');
    }
    expect(f.read).not.toHaveBeenCalled();
  });
  it('requires independent read-only authority and an issued plan',async()=>{
    const f=await statusFixture();f.deps.authority.verify.mockResolvedValueOnce({status:'PENDING_EXTERNAL_ATTESTATION'} as never);
    expect((await f.inspect()).status).toBe('REJECTED');expect(f.read).not.toHaveBeenCalled();
    expect((await inspectAcceptanceStatus(f.f.run,structuredClone(f.plan),f.fixture.fixtureId,f.deps)).status).toBe('REJECTED');
  });
  it('reports leased commands and preserves full fencing generations',async()=>{
    const f=await statusFixture();Object.assign(f.snapshot.command,{leaseOwner:'synthetic_worker',leaseUntil:'2035-01-01T00:02:00.000Z',leaseGeneration:'9007199254740998'});
    expect((await f.inspect()).progress).toBe('COMMAND_PROCESSING');
  });
  it('reports only persisted safe Checkout URLs, independently from confirmation',async()=>{
    const f=await statusFixture();f.ready();const r=await f.inspect();
    expect(r.progress).toBe('CHECKOUT_READY');expect(r.checkout?.url).toBe(f.snapshot.attempt.checkoutUrl);
    expect(r.booking.confirmationVerified).toBe(false);f.snapshot.attempt.checkoutUrl='https://untrusted.invalid/checkout';
    expect((await f.inspect()).progress).toBe('UNKNOWN');
  });
  it('distinguishes pending payment, recovery, investigation and timeout without writes',async()=>{
    const f=await statusFixture();f.ready();f.snapshot.provider.observation='PROCESSING';expect((await f.inspect()).progress).toBe('PAYMENT_PENDING');
    f.snapshot.provider.observation='NONE';f.snapshot.attempt.state='RECONCILING';expect((await f.inspect()).progress).toBe('RECOVERY_PENDING');
    f.snapshot.command.state='QUARANTINED';expect((await f.inspect()).progress).toBe('INVESTIGATION_REQUIRED');
    const g=await statusFixture();g.ready();g.snapshot.attempt.sessionExpiresAt='2035-01-01T00:00:50.000Z';
    const r=await g.inspect();expect(r.progress).toBe('TIMED_OUT');expect(r.inventoryHold.state).toBe('ACTIVE');expect(r.payment.captureVerified).toBe(false);
  });
  it('requires the complete capture/allocation/hold/claim/audit/notice chain',async()=>{
    const f=await statusFixture();f.confirmed();const r=await f.inspect();
    expect(r).toMatchObject({progress:'PAYMENT_CONFIRMED',payment:{captureVerified:true},booking:{confirmationVerified:true},scenarioEvidenceComplete:true});
    expect(r.provenance?.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    for(const field of ['payments','allocations','confirmations','notices'] as const) {
      const g=await statusFixture();g.confirmed();g.snapshot[field]=[];expect((await g.inspect()).progress).toBe('UNKNOWN');
    }
    const g=await statusFixture();g.confirmed();g.snapshot.claim.id=id(98);expect((await g.inspect()).progress).toBe('UNKNOWN');
  });
  it('requires scenario-specific duplicate/out-of-order and recovery evidence',async()=>{
    const f=await statusFixture('DUPLICATE_DELIVERY');f.confirmed();expect((await f.inspect()).scenarioEvidenceComplete).toBe(false);
    f.snapshot.events.duplicateDeliveries=2;f.snapshot.events.outOfOrderObserved=true;expect((await f.inspect()).scenarioEvidenceComplete).toBe(true);
    const g=await statusFixture('MISSING_WEBHOOK');g.confirmed();expect((await g.inspect()).scenarioEvidenceComplete).toBe(false);
    g.snapshot.provider.source='RECOVERY_RECONCILIATION';g.snapshot.events.verifiedPaymentEvents=0;
    expect((await g.inspect()).progress).toBe('UNKNOWN');g.snapshot.provider.recoveryInvocationId=id(14);
    expect((await g.inspect()).scenarioEvidenceComplete).toBe(true);
  });
  it('keeps delayed commands and investigation distinguishable',async()=>{
    const f=await statusFixture('DELAYED_COMMAND');f.confirmed();expect((await f.inspect()).scenarioEvidenceComplete).toBe(false);
    f.snapshot.delayedCommandObserved=true;expect((await f.inspect()).scenarioEvidenceComplete).toBe(true);
    const g=await statusFixture('INVESTIGATION');g.snapshot.investigationCount=1;g.snapshot.command.state='QUARANTINED';
    expect(await g.inspect()).toMatchObject({progress:'INVESTIGATION_REQUIRED',scenarioEvidenceComplete:true,booking:{confirmationVerified:false}});
  });
  it('does not pass acceptance with unresolved liability or an unsafe original submission',async()=>{
    const f=await statusFixture();f.confirmed();f.snapshot.unresolvedRefundLiabilities=1;
    expect(await f.inspect()).toMatchObject({progress:'INVESTIGATION_REQUIRED',scenarioEvidenceComplete:false});
    const g=await statusFixture();g.ready();g.snapshot.command.state='UNKNOWN';g.snapshot.command.firstSubmittedAt='2034-12-30T00:00:00.000Z';
    expect((await g.inspect()).progress).toBe('INVESTIGATION_REQUIRED');
  });
  it('rejects foreign claim ownership even when investigation is already required',async()=>{
    const f=await statusFixture();f.snapshot.investigationCount=1;f.snapshot.claim.holdId=id(99);
    expect((await f.inspect()).progress).toBe('UNKNOWN');
  });
  it('requires terminal evidence rather than elapsed time',async()=>{
    const f=await statusFixture();f.snapshot.booking.state='EXPIRED';f.snapshot.attempt.state='EXPIRED';f.snapshot.hold.state='RELEASED';
    f.snapshot.claim.releasedAt='2035-01-01T00:00:30.000Z';f.snapshot.claim.activeClaimCount=0;f.snapshot.command.state='RESOLVED';
    expect((await f.inspect()).progress).toBe('UNKNOWN');f.snapshot.provider.observation='NEVER_SUBMITTED';
    expect((await f.inspect()).progress).toBe('TERMINAL');
  });
  it('imports no execution engines or clients and does not alter inactive barriers',()=>{
    for(const path of ['src/server/stripe-acceptance-fixtures.ts','src/server/stripe-acceptance-status.ts']) {
      const text=readFileSync(path,'utf8');
      for(const forbidden of ["from 'pg'","from 'stripe'","from './checkout-worker'","from './payment-reconciliation'","from '../db/client'"])
        expect(text).not.toContain(forbidden);
    }
    expect(readFileSync('src/server/stripe-automation.ts','utf8')).toContain("status: 'INACTIVE', processingEnabled: false");
    expect(readFileSync('src/app/api/internal/stripe-automation/route.ts','utf8')).not.toContain('stripe-acceptance-status');
  });
});
