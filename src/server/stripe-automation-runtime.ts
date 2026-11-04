import 'server-only';
import { observePoolShutdown, type ShutdownObservation } from './automation-settlement';
import type { Pool, PoolClient, PoolConfig } from 'pg';
import { stripeAutomationConfig, type AutomationConfig } from './stripe-automation-config';

export class AutomationTimeout extends Error { constructor() { super('AUTOMATION_DEADLINE'); } }
export class AutomationScope {
  readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly parentAbort: () => void;
  private requests = 0;
  constructor(readonly deadline: number, readonly now: () => number = Date.now,
    private readonly parent?: AbortSignal, private readonly maxRequests = 12) {
    this.parentAbort = () => this.controller.abort(new AutomationTimeout());
    parent?.addEventListener('abort', this.parentAbort, { once:true });
    this.timer = setTimeout(this.parentAbort, Math.max(0, deadline-now()));
    if(parent?.aborted)this.parentAbort();
  }
  get signal() { return this.controller.signal; }
  remaining() { return Math.max(0,this.deadline-this.now()); }
  check() {
    if(this.signal.aborted || this.remaining()<=0) {
      this.controller.abort(new AutomationTimeout()); throw new AutomationTimeout();
    }
  }
  providerRequest() {
    this.check();
    if(++this.requests>this.maxRequests) throw new Error('PROVIDER_REQUEST_BUDGET');
  }
  close() {
    clearTimeout(this.timer);
    this.parent?.removeEventListener('abort',this.parentAbort);
    this.controller.abort(new AutomationTimeout());
  }
}

export type AutomationPoolFactory = (options: PoolConfig & {pipeline:false}) => Pool;
/** Explicit source-only constructor injection. Never reads env files or imports a pool.
 * Startup timeouts bound acquisition and server work, even when no query is active. */
export function automationPoolOptions(config:AutomationConfig,env:Readonly<Record<string,string|undefined>>) {
  const checked=stripeAutomationConfig(env,config.target);
  if(JSON.stringify(checked)!==JSON.stringify(config))throw new Error('DATABASE_IDENTITY');
  return {connectionString:env.DATABASE_URL!,max:1,pipeline:false as const,
    connectionTimeoutMillis:1000,statement_timeout:1000,lock_timeout:500,
    idle_in_transaction_session_timeout:1000,options:'-c transaction_timeout=10000'};
}
/** A dedicated, non-pipelined pool only. Destructive release interrupts active pg
 * queries and rolls back open transactions on disconnect. Never return a timed-out
 * connection to the pool. Await the actual query rejection; do not race past it. */
export function boundedAutomationPool(raw:Pool,currentScope:()=>AutomationScope,
  observeShutdown?:(state:ShutdownObservation)=>void) {
  const active=new Set<()=>void>();
  let closed=false;
  async function connect():Promise<PoolClient> {
    if(closed)throw new Error('DATABASE_CLOSED');
    const scope=currentScope();scope.check();
    // raw must use automationPoolOptions: acquisition (including queueing) has a 1s timeout.
    const client=await raw.connect();
    let released=false;
    const release=(destroy=false)=>{
      if(released)return;
      released=true;active.delete(destroyConnection);
      client.release(destroy || scope.signal.aborted || currentScope().signal.aborted);
    };
    const destroyConnection=()=>release(true);
    active.add(destroyConnection);
    if(closed || scope.signal.aborted || scope.remaining()<=0) {release(true);throw new AutomationTimeout();}
    const query=async(text:string,values?:unknown[])=>{
      if(released)throw new Error('DATABASE_CONNECTION_DISCARDED');
      const queryScope=currentScope();queryScope.check();
      const interrupt=()=>release(true);
      const timer=setTimeout(interrupt,Math.min(1000,queryScope.remaining()));
      queryScope.signal.addEventListener('abort',interrupt,{once:true});
      // Domain helpers retain their normal bounds outside automation. Inside the
      // worker they cannot relax the dedicated connection's shorter limits.
      const statement=text.replace(/SET LOCAL statement_timeout='15s'/g,"SET LOCAL statement_timeout='1000ms'")
        .replace(/SET LOCAL lock_timeout='5s'/g,"SET LOCAL lock_timeout='500ms'");
      try {
        const result=await client.query(statement,values);
        if(released)throw new AutomationTimeout();
        queryScope.check();return result;
      } finally {clearTimeout(timer);queryScope.signal.removeEventListener('abort',interrupt);}
    };
    return new Proxy(client,{get(target,key){
      if(key==='query')return query;
      if(key==='release')return release;
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
  }
  const query=async(text:string,values?:unknown[])=>{
    const client=await connect();
    try {return await client.query(text,values);} finally {client.release();}
  };
  const pool=new Proxy(raw,{get(target,key){
    if(key==='connect')return connect;
    if(key==='query')return query;
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  let closing:Promise<void>|undefined;
  return {pool,close(){
    if(closing)return closing;
    closed=true;
    closing=(async()=>{
      let releaseFailed=false;
      for(const destroy of [...active])try {destroy();}catch {releaseFailed=true;}
      await observePoolShutdown(()=>raw.end(),observeShutdown);
      if(releaseFailed)throw new Error('DATABASE_RELEASE_FAILED');
    })();
    return closing;
  }};
}

/** Inject into Stripe's fetch HTTP client. Covers headers AND body consumption,
 * aborts the real transport, counts hidden SDK requests, and never retries POSTs.
 * Buffer at most 1 MiB so the SDK cannot outlive the request's abort scope reading
 * an unbounded response stream. No default fetch is selected here. */
export function boundedAutomationFetch(fetcher:typeof fetch,currentScope:()=>AutomationScope):typeof fetch {
  return async(input,init)=>{
    const scope=currentScope();scope.providerRequest();
    const controller=new AbortController();
    const abort=()=>controller.abort(new AutomationTimeout());
    scope.signal.addEventListener('abort',abort,{once:true});
    init?.signal?.addEventListener('abort',abort,{once:true});
    if(init?.signal?.aborted)abort();
    const timer=setTimeout(abort,Math.min(1000,scope.remaining()));
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    try {
      const response=await fetcher(input,{...init,signal:controller.signal});
      if(controller.signal.aborted)throw new AutomationTimeout();
      reader=response.body?.getReader();
      const chunks:Uint8Array[]=[];let size=0;
      if(reader)for(;;){
        const chunk=await reader.read();if(chunk.done)break;
        size+=chunk.value.byteLength;
        if(size>1024*1024){abort();throw new Error('PROVIDER_RESPONSE_BUDGET');}
        chunks.push(chunk.value);
      }
      scope.check();
      if(controller.signal.aborted)throw new AutomationTimeout();
      const body=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
      return new Response([204,205,304].includes(response.status)?null:body,{
        status:response.status,statusText:response.statusText,headers:response.headers,
      });
    } finally {
      clearTimeout(timer);
      scope.signal.removeEventListener('abort',abort);
      init?.signal?.removeEventListener('abort',abort);
      if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}
    }
  };
}
