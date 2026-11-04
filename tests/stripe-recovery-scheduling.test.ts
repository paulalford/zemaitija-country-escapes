import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { StripeGateway } from '../src/server/stripe-adapter';
import { recoverPaymentAttempts, recoveryPolicy } from '../src/server/payment-recovery';

vi.mock('pg',()=>{throw Error('Database forbidden');});
vi.mock('stripe',()=>{throw Error('Provider module forbidden');});
type Row={id:string;lane:'INITIAL'|'BALANCE';enabled:boolean;due:number|null;owner:string|null;
  until:number;generation:bigint;failures:number;state:string;session:string|null;intent?:string};
function row(id:string,lane:Row['lane']='INITIAL'):Row {
  return {id,lane,enabled:true,due:0,owner:null,until:0,generation:9007199254740997n,
    failures:0,state:'OPEN',session:'cs_test_synthetic'};
}
/** Fake capability implementation for deterministic application scheduling tests.
 * PostgreSQL locks, triggers and effective privileges remain unverified. */
function store(rows:Row[]) {
  let now=1000;
  const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
    if(sql.includes('claim_payment_recovery')) {
      const selected=rows.filter(r=>r.lane===args[0]&&r.enabled&&r.due!==null&&r.due<=now&&r.until<=now)
        .sort((a,b)=>a.due!-b.due!||a.id.localeCompare(b.id))[0];
      if(!selected)return {rows:[]};
      selected.owner=args[1] as string;selected.until=now+120000;selected.generation++;
      return {rows:[{attempt_id:selected.id,generation:String(selected.generation),failure_count:selected.failures}]};
    }
    const item=rows.find(r=>r.id===args[0]);
    if(sql.startsWith('SELECT state'))return {rows:item?[{state:item.state,stripe_session_id:item.session,stripe_payment_intent_id:item.intent??null}]:[]};
    if(sql.includes('finish_payment_recovery')) {
      const valid=item&&item.owner===args[1]&&item.generation===BigInt(args[2] as string)&&item.until>now&&
        (args[3]!=='COMPLETE'||item.state==='SUCCEEDED');
      if(valid){item.due=args[4]===null?null:now+Number(args[4])*1000;item.until=0;item.owner=null;
        item.failures=args[3]==='RETRY'?Math.min(2147483647,item.failures+1):0;}
      return {rows:[{finished:!!valid}]};
    }
    throw Error(`Unexpected fake query: ${sql}`);
  });
  return {pool:{query} as unknown as Pool,query,rows,now:()=>now,advance:(t:number)=>{now+=t;}};
}
const gateway={accountId:'acct_synthetic',retrieveSession:vi.fn(async()=>{throw Error('retrieval failed');})} as unknown as StripeGateway;
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

describe('durable fair application scheduling with fake PostgreSQL capabilities',()=>{
  it.each(['INITIAL','BALANCE'] as const)('%s advances failing work so newer due work proceeds',async lane=>{
    const fake=store([row('old',lane),row('new',lane)]);fake.rows[1].due=1;
    const seen:string[]=[];
    const reconcile=async(_pool:Pool,g:StripeGateway,id:string)=>{
      seen.push(id);await g.retrieveSession('cs_test_synthetic');return 'OPEN';
    };
    const first=await recoverPaymentAttempts(fake.pool,gateway,lane,reconcile,1,{random:()=>0});
    expect(first.items[0].observation).toBe('PROVIDER_ERROR');expect(first.retried).toBe(1);
    await recoverPaymentAttempts(fake.pool,gateway,lane,reconcile,1,{random:()=>0});
    expect(seen).toEqual(['old','new']);expect(fake.rows.every(r=>r.due!>fake.now())).toBe(true);
  });
  it('excludes unenrolled history, future work, live leases and the other lane',async()=>{
    const fake=store([Object.assign(row('history'),{enabled:false}),Object.assign(row('future'),{due:5000}),
      Object.assign(row('leased'),{until:5000}),row('balance','BALANCE'),row('due')]);
    const reconcile=vi.fn(async()=> 'OPEN');
    const result=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',reconcile,5,{random:()=>0});
    expect(result.items.map(i=>i.attemptId)).toEqual(['due']);expect(reconcile).toHaveBeenCalledOnce();
    expect(fake.rows[0].generation).toBe(9007199254740997n);
  });
  it('claims competing workers independently without rounding bigint generations',async()=>{
    const fake=store([row('a'),row('b')]),hold=deferred<string>(),started=deferred<void>();
    const first=recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=>{started.resolve();return hold.promise;},1,
      {workerId:'worker_a',random:()=>0});
    await started.promise;
    const second=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=> 'OPEN',1,{workerId:'worker_b',random:()=>0});
    expect(second.items[0].attemptId).toBe('b');hold.resolve('OPEN');await first;
    expect(fake.rows.map(r=>r.generation)).toEqual([9007199254740998n,9007199254740998n]);
  });
  it('reclaims expired leases and refuses a stale worker completion',async()=>{
    const fake=store([row('a')]),hold=deferred<string>(),started=deferred<void>();
    const first=recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=>{started.resolve();return hold.promise;},1,
      {workerId:'worker_a',random:()=>0});
    await started.promise;fake.advance(120001);
    const second=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=> 'OPEN',1,{workerId:'worker_b',random:()=>0});
    const next=fake.rows[0].due;expect(second.processed).toBe(1);
    hold.resolve('OPEN');const stale=await first;
    expect(stale.items[0].scheduleCommitted).toBe(false);expect(stale.processed).toBe(0);
    expect(stale.deferred).toBe(1);expect(fake.rows[0].due).toBe(next);
    expect(fake.rows[0].generation).toBe(9007199254740999n);
  });
  it('maintains slower terminal surveillance and repeated uncertainty investigation',async()=>{
    const fake=store([row('a')]);
    for(let n=0;n<5;n++) {
      const result=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=> 'RECONCILING',1,{random:()=>0});
      expect(result.retried).toBe(1);expect(result.investigationRequired).toBe(n===4?1:0);
      fake.advance(fake.rows[0].due!-fake.now());
    }
    expect(fake.rows[0].failures).toBe(5);
    const terminal=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=> 'RELEASED',1,{random:()=>0});
    expect(terminal.items[0].observation).toBe('TERMINAL_UNPAID');
    expect(fake.rows[0].due!-fake.now()).toBe(21600000);expect(fake.rows[0].failures).toBe(0);
  });
  it('cleans up committed success after a crash without touching the provider',async()=>{
    const fake=store([Object.assign(row('paid'),{state:'SUCCEEDED'})]);
    const reconcile=vi.fn(async()=> 'CONFIRMED');
    const result=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',reconcile,1,{random:()=>0});
    expect(result.processed).toBe(1);expect(reconcile).not.toHaveBeenCalled();expect(fake.rows[0].due).toBeNull();
  });
  it('keeps an unknown creation scheduled and never invokes a create operation',async()=>{
    const fake=store([Object.assign(row('unknown'),{session:null,state:'CREATING'})]);
    const reconcile=vi.fn(async()=> 'OPEN');
    const result=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',reconcile,1,{random:()=>0});
    expect(result.items[0].observation).toBe('NO_LOCATOR');expect(result.retried).toBe(1);
    expect(reconcile).not.toHaveBeenCalled();expect(fake.rows[0].due).toBe(31000);
  });
  it('passes a known Intent locator to authoritative reconciliation instead of treating it as missing',async()=>{
    const fake=store([Object.assign(row('recover-session'),{session:null,intent:'pi_synthetic'})]);
    const reconcile=vi.fn(async(_pool:Pool,_gateway:StripeGateway,_id:string,options?:{paymentIntentLocator?:string})=>{
      void [_pool,_gateway,_id];expect(options?.paymentIntentLocator).toBe('pi_synthetic');return 'OPEN';
    });
    const result=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',reconcile,1,{random:()=>0});
    expect(result.items[0].observation).toBe('OPEN');expect(result.processed).toBe(1);
    expect(reconcile).toHaveBeenCalledOnce();
  });
  it('does not retire an uncommitted success or report completion after a schedule error',async()=>{
    const fake=store([row('a')]);
    const result=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=> 'ALREADY_RECORDED',1,{random:()=>0});
    expect(result.items[0].observation).toBe('UNCERTAIN');expect(result.retried).toBe(1);
    fake.advance(30000);
    const realQuery=fake.query.getMockImplementation()!;
    fake.query.mockImplementation(async(sql,args)=>{
      if(sql.includes('finish_payment_recovery'))throw Error('commit unknown');return realQuery(sql,args);
    });
    const failure=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=> 'OPEN',1,{random:()=>0});
    expect(failure.processed).toBe(0);expect(failure.failed).toBe(1);expect(failure.deferred).toBe(1);
  });
  it('does not claim when admission is exhausted and validates caller limits',async()=>{
    const fake=store([row('a')]);
    const result=await recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=> 'OPEN',1,{admit:()=>false});
    expect(result.deferred).toBe(1);expect(fake.query).not.toHaveBeenCalled();
    await expect(recoverPaymentAttempts(fake.pool,gateway,'INITIAL',async()=> 'OPEN',26)).rejects.toThrow();
  });
});
describe('bounded backoff policy',()=>{
  it.each(['PROVIDER_ERROR','UNCERTAIN','NO_LOCATOR'] as const)('backs off %s with controlled jitter',observation=>{
    expect([0,1,2,3].map(n=>recoveryPolicy(observation,n,()=>0).delay)).toEqual([30,60,120,240]);
    expect(recoveryPolicy(observation,0,()=>0.999).delay).toBe(37);
    expect(recoveryPolicy(observation,4,()=>0.999999)).toMatchObject({outcome:'RETRY',delay:25200,investigationRequired:true});
    expect(recoveryPolicy(observation,2147483647,()=>0).delay).toBe(21600);
  });
  it('polls known open/terminal objects separately and completes only success',()=>{
    expect(recoveryPolicy('OPEN',8,()=>0).delay).toBe(60);
    expect(recoveryPolicy('TERMINAL_UNPAID',0,()=>0).delay).toBe(21600);
    expect(recoveryPolicy('SUCCESS',0,()=>0)).toMatchObject({outcome:'COMPLETE',delay:null});
    expect(()=>recoveryPolicy('UNCERTAIN',-1)).toThrow();
    expect(()=>recoveryPolicy('UNCERTAIN',0,()=>1)).toThrow();
  });
});
