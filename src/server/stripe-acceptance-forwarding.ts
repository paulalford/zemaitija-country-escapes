import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { canonicalRunJson, FRESH_ACCEPTANCE_PROFILE, requireSealedAcceptanceRun, runManifestDigest,
  type SealedAcceptanceRun } from './stripe-acceptance-run';
import { AutomationScope, boundedAutomationFetch } from './stripe-automation-runtime';
import type { VerifiedEvent } from './stripe-adapter';

export const ACCEPTANCE_FORWARDING_PROFILE=Object.freeze({id:'fresh-loopback-webhook-v1',
  targetProfileId:FRESH_ACCEPTANCE_PROFILE.id,origin:'http://127.0.0.1:3101',
  bodyLimit:1024*1024,receiptLimit:4096,totalMilliseconds:5000,bodyMilliseconds:2000});
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.uuid();
const instant=z.string().datetime({precision:3});
const grantSchema=z.object({status:z.literal('VERIFIED'),runId:uuid,manifestDigest:hash,
  forwardingProfile:z.literal('fresh-loopback-webhook-v1'),operation:z.literal('ingest-payment-webhook'),
  notBefore:instant,expiresAt:instant,reservationVerified:z.literal(true),targetVerified:z.literal(true),
  accountVerified:z.literal(true),durableAdmissionVerified:z.literal(true)}).strict();
export type ForwardingHostAuthority={
  /** Future independent launcher verification, not the Stage 2C-3D pending result.
   * Must revalidate protected approval, reservation and actual fresh target. */
  verify(binding:Readonly<{runId:string;manifestDigest:string;forwardingProfile:string;operation:'ingest-payment-webhook'}>,
    signal:AbortSignal):Promise<unknown>;
};
export type ForwardingCredentials={readBearer(signal:AbortSignal):Promise<string>};
type HostDependencies={now:()=>number;authority:ForwardingHostAuthority;credentials:ForwardingCredentials};
export type AcceptanceForwardingDependencies=HostDependencies & {fetch:typeof fetch};
const requestSchema=z.object({method:z.literal('POST'),path:z.string(),
  headers:z.array(z.tuple([z.string().max(128),z.string().max(2048)])).max(32),
  body:z.union([z.instanceof(Uint8Array),z.instanceof(ReadableStream)]),signal:z.instanceof(AbortSignal).optional()}).strict();
export type AcceptanceForwardRequest=z.input<typeof requestSchema>;
type Diagnostic='INVALID_REQUEST'|'INVALID_SIGNATURE'|'UNAUTHORIZED'|'PAYLOAD_TOO_LARGE'|'NOT_SENT'|'DELIVERY_UNCERTAIN'|
  'DOWNSTREAM_REJECTED'|'DURABLE_INGESTED'|'DURABLE_DUPLICATE'|'DURABLE_INVESTIGATION'|'DURABLE_STORE_REQUIRED';
export type AcceptanceForwardResult=Readonly<{status:number;outcome:'NOT_SENT'|'REJECTED'|'UNCERTAIN'|'DURABLE';diagnostic:Diagnostic}>;
const result=(status:number,outcome:AcceptanceForwardResult['outcome'],diagnostic:Diagnostic):AcceptanceForwardResult=>
  Object.freeze({status,outcome,diagnostic});
class InputFailure extends Error {constructor(readonly status:number,readonly code:Diagnostic){super(code);}}
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const tokenSchema=z.string().regex(/^[A-Za-z0-9_-]{43,128}$/).refine(s=>new Set(s).size>=16);

function context(run:SealedAcceptanceRun,deps:HostDependencies) {
  requireSealedAcceptanceRun(run);
  if(run.profileId!==FRESH_ACCEPTANCE_PROFILE.id || !run.operations.includes('ingest-payment-webhook'))throw Error('FORWARDING_CONTRACT_REJECTED');
  const manifestDigest=runManifestDigest(canonicalRunJson(run));
  const binding=Object.freeze({runId:run.runId,manifestDigest,forwardingProfile:ACCEPTANCE_FORWARDING_PROFILE.id,
    operation:'ingest-payment-webhook' as const});
  function now() {const n=deps.now();if(!Number.isSafeInteger(n))throw Error('CLOCK_REJECTED');return n;}
  function window() {
    const n=now();if(n<Date.parse(run.notBefore) || n>=Date.parse(run.expiresAt))throw new InputFailure(401,'UNAUTHORIZED');return n;
  }
  async function authority(scope:AutomationScope) {
    scope.check();window();
    const evidence=grantSchema.safeParse(await scoped(deps.authority.verify(binding,scope.signal),scope));
    if(!evidence.success)throw new InputFailure(401,'UNAUTHORIZED');
    const grant=evidence.data;
    const n=window();
    if(grant.runId!==run.runId || grant.manifestDigest!==manifestDigest || n<Date.parse(grant.notBefore) ||
      n>=Date.parse(grant.expiresAt) || Date.parse(grant.notBefore)<Date.parse(run.notBefore) ||
      Date.parse(grant.expiresAt)>Date.parse(run.expiresAt))throw new InputFailure(401,'UNAUTHORIZED');
    return grant;
  }
  return {binding,now,window,authority};
}
async function scoped<T>(pending:Promise<T>,scope:AutomationScope):Promise<T> {
  scope.check();let abort:()=>void=()=>{};
  const stopped=new Promise<never>((_resolve,reject)=>{abort=()=>reject(Error('OPERATION_ABORTED'));
    scope.signal.addEventListener('abort',abort,{once:true});if(scope.signal.aborted)abort();});
  try {const value=await Promise.race([pending,stopped]);scope.check();return value;}
  finally {scope.signal.removeEventListener('abort',abort);}
}
function signature(value:string,now:number) {
  if(value.length>1024 || /[\r\n]/.test(value))throw new InputFailure(400,'INVALID_SIGNATURE');
  const fields=value.split(',').map(s=>s.trim()),times=fields.filter(s=>/^t=\d{1,12}$/.test(s));
  if(times.length!==1 || fields.length<2 || fields.length>5 ||
    fields.some(s=>!/^t=\d{1,12}$/.test(s) && !/^v1=[a-f0-9]{64}$/.test(s)) ||
    fields.filter(s=>s.startsWith('v1=')).length<1 || Math.abs(Math.floor(now/1000)-Number(times[0].slice(2)))>300)
    throw new InputFailure(400,'INVALID_SIGNATURE');
}
async function bodyBytes(body:Uint8Array|ReadableStream<unknown>,scope:AutomationScope):Promise<Buffer> {
  if(body instanceof Uint8Array) {
    scope.check();if(body.byteLength>ACCEPTANCE_FORWARDING_PROFILE.bodyLimit)throw new InputFailure(413,'PAYLOAD_TOO_LARGE');
    if(body.byteLength===0)throw new InputFailure(400,'INVALID_REQUEST');return Buffer.from(body);
  }
  const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;) {
      const chunk=await scoped(reader.read(),scope);if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array))throw new InputFailure(400,'INVALID_REQUEST');
      size+=chunk.value.byteLength;if(size>ACCEPTANCE_FORWARDING_PROFILE.bodyLimit)throw new InputFailure(413,'PAYLOAD_TOO_LARGE');
      chunks.push(Uint8Array.from(chunk.value));
    }
    if(size===0)throw new InputFailure(400,'INVALID_REQUEST');return Buffer.concat(chunks);
  } finally {
    // Cooperative cancellation; do not abandon or call successful a stalled cleanup.
    try {await reader.cancel();}finally {reader.releaseLock();}
  }
}
function incomingHeaders(headers:readonly (readonly [string,string])[],now:number) {
  let original:string|undefined;const counts=new Map<string,number>();
  const ignored=new Set(['host','user-agent','accept','connection','content-type','content-length']);
  for(const [name,value] of headers) {
    const key=name.toLowerCase();counts.set(key,(counts.get(key)??0)+1);
    if(key==='authorization')throw new InputFailure(401,'UNAUTHORIZED');
    if(key==='stripe-signature'){if(original!==undefined)throw new InputFailure(400,'INVALID_SIGNATURE');original=value;}
    else if(!ignored.has(key))throw new InputFailure(400,'INVALID_REQUEST');
    if(/[\r\n]/.test(name+value))throw new InputFailure(400,'INVALID_REQUEST');
  }
  if(!original)throw new InputFailure(400,'INVALID_SIGNATURE');signature(original,now);
  if((counts.get('content-length')??0)>1)throw new InputFailure(400,'INVALID_REQUEST');
  const length=headers.find(([name])=>name.toLowerCase()==='content-length')?.[1];
  if(length!==undefined && !/^\d{1,10}$/.test(length))throw new InputFailure(400,'INVALID_REQUEST');
  if(length!==undefined && Number(length)>ACCEPTANCE_FORWARDING_PROFILE.bodyLimit)throw new InputFailure(413,'PAYLOAD_TOO_LARGE');
  return {original,length:length===undefined?undefined:Number(length)};
}
const receiptSchema=z.object({version:z.literal(1),durable:z.literal(true),runId:uuid,manifestDigest:hash,payloadDigest:hash,
  originalPayloadDigest:hash,
  eventId:z.string().regex(/^evt_[A-Za-z0-9]+$/),eventType:z.string().max(100),objectType:z.string().max(100),
  disposition:z.enum(['INGESTED','DUPLICATE','INVESTIGATION']),lane:z.enum(['PAYMENT','NONE']),
  ownership:z.enum(['OWNED','UNKNOWN','CONFLICT','UNSUPPORTED','DIGEST_CONFLICT'])}).strict();
export type AcceptanceAdmissionReceipt=z.infer<typeof receiptSchema>;
function supported(type:string,object:string) {
  return object==='checkout.session' && ['checkout.session.completed','checkout.session.expired'].includes(type) ||
    object==='payment_intent' && ['payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled'].includes(type);
}
function receipt(raw:unknown,runId:string,manifestDigest:string,payloadDigest:string) {
  const r=receiptSchema.parse(raw);
  if(r.runId!==runId || r.manifestDigest!==manifestDigest || r.payloadDigest!==payloadDigest ||
    (r.originalPayloadDigest!==r.payloadDigest)!==(r.ownership==='DIGEST_CONFLICT') ||
    (r.disposition==='INVESTIGATION' ? r.lane!=='NONE' || r.ownership==='OWNED'
      :r.lane!=='PAYMENT' || r.ownership!=='OWNED' || !supported(r.eventType,r.objectType)))throw Error('RECEIPT_REJECTED');
  return r;
}

/** Unmounted, no default fetch/authority/credential source. Not a generic proxy. */
export function createAcceptanceWebhookForwarder(run:SealedAcceptanceRun,deps:AcceptanceForwardingDependencies) {
  if(typeof deps.fetch!=='function')throw Error('FORWARDING_CONTRACT_REJECTED');
  const ctx=context(run,deps),path=`/stripe/acceptance/${run.runId}/webhook`;
  const destination=`${ACCEPTANCE_FORWARDING_PROFILE.origin}/api/acceptance/runs/${run.runId}/stripe/webhook`;
  return async(input:AcceptanceForwardRequest):Promise<AcceptanceForwardResult>=>{
    let sent=false,overall:AutomationScope|undefined,bodyScope:AutomationScope|undefined;
    try {
      const parsed=requestSchema.safeParse(input);if(!parsed.success)throw new InputFailure(400,'INVALID_REQUEST');
      const request=parsed.data;if(request.path!==path)throw new InputFailure(400,'INVALID_REQUEST');
      const start=ctx.window(),headers=incomingHeaders(request.headers,start);
      overall=new AutomationScope(Math.min(start+5000,Date.parse(run.expiresAt)),ctx.now,request.signal,1);overall.check();
      const grant=await ctx.authority(overall);
      bodyScope=new AutomationScope(Math.min(ctx.now()+2000,overall.deadline,Date.parse(grant.expiresAt)),ctx.now,overall.signal);
      const raw=await bodyBytes(request.body,bodyScope);bodyScope.close();bodyScope=undefined;
      if(headers.length!==undefined && headers.length!==raw.byteLength)throw new InputFailure(400,'INVALID_REQUEST');
      const token=tokenSchema.parse(await scoped(deps.credentials.readBearer(overall.signal),overall));
      const current=await ctx.authority(overall);ctx.window();signature(headers.original,ctx.now());
      const delivery=new AutomationScope(Math.min(overall.deadline,Date.parse(current.expiresAt)),ctx.now,overall.signal,1);
      try {
        const transport=boundedAutomationFetch(async(target,init)=>{
          sent=true;const response=await deps.fetch(target,init);
          // Check before the bounded wrapper reconstructs the response body.
          if(response.redirected || response.url && response.url!==destination) {
            await response.body?.cancel();throw Error('REDIRECT_REJECTED');
          }
          return response;
        },()=>delivery);
        const response=await transport(destination,{method:'POST',redirect:'manual',credentials:'omit',cache:'no-store',
          headers:{'Content-Type':'application/json','Stripe-Signature':headers.original,Authorization:`Bearer ${token}`},
          body:Uint8Array.from(raw).buffer});
        if(response.redirected || response.status>=300 && response.status<400)throw Error('REDIRECT_REJECTED');
        if(response.status!==200) {
          const status=[400,401,413].includes(response.status)?response.status:503;
          return result(status,status===503?'UNCERTAIN':'REJECTED',status===503?'DELIVERY_UNCERTAIN':'DOWNSTREAM_REJECTED');
        }
        if(response.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('RECEIPT_REQUIRED');
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(bytes.byteLength>4096)throw Error('RECEIPT_LIMIT');
        const r=receipt(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),run.runId,ctx.binding.manifestDigest,sha(raw));
        delivery.check();overall.check();ctx.window();
        return result(200,'DURABLE',r.disposition==='INVESTIGATION'?'DURABLE_INVESTIGATION':r.disposition==='DUPLICATE'?'DURABLE_DUPLICATE':'DURABLE_INGESTED');
      } finally {delivery.close();}
    } catch(error) {
      if(sent)return result(503,'UNCERTAIN','DELIVERY_UNCERTAIN');
      if(error instanceof InputFailure)return result(error.status,'NOT_SENT',error.code);
      return result(503,'NOT_SENT','NOT_SENT');
    } finally {bodyScope?.close();overall?.close();}
  };
}

/** Must atomically verify persisted booking/attempt/command/Session/PI ownership,
 * compare event-ID digests and commit inbox or incident evidence. No adapter or DDL
 * is installed here; metadata run IDs alone cannot satisfy this capability. */
export interface AtomicAcceptanceAdmission {
  commit(input:Readonly<{runId:string;manifestDigest:string;database:string;event:VerifiedEvent;payloadDigest:string;
    supportedPayment:boolean}>,signal:AbortSignal):Promise<unknown>;
}
export type AcceptanceIngestionDependencies=HostDependencies & {
  verifyEvent(raw:Buffer,signature:string):VerifiedEvent;admission?:AtomicAcceptanceAdmission;
};
/** Separate downstream source contract. Never calls the existing unscoped ingester,
 * SQL, a processor or provider reconciliation. No operational implementation. */
export function createAcceptanceWebhookIngestion(run:SealedAcceptanceRun,deps:AcceptanceIngestionDependencies) {
  const ctx=context(run,deps);
  return async(input:{raw:Uint8Array;signature:string;authorization:string;signal?:AbortSignal}):Promise<{
    status:number;diagnostic?:Diagnostic;receipt?:AcceptanceAdmissionReceipt;
  }>=>{
    let scope:AutomationScope|undefined,commitStarted=false;
    try {
      const parsed=z.object({raw:z.instanceof(Uint8Array),signature:z.string().max(1024),authorization:z.string().max(160),
        signal:z.instanceof(AbortSignal).optional()}).strict().safeParse(input);
      if(!parsed.success)throw new InputFailure(400,'INVALID_REQUEST');
      const delivery=parsed.data;
      const now=ctx.window();scope=new AutomationScope(Math.min(now+5000,Date.parse(run.expiresAt)),ctx.now,delivery.signal,1);scope.check();
      await ctx.authority(scope);
      const expected=tokenSchema.parse(await scoped(deps.credentials.readBearer(scope.signal),scope));
      const supplied=delivery.authorization.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
      if(!supplied || !timingSafeEqual(Buffer.from(sha(supplied),'hex'),Buffer.from(sha(expected),'hex')))
        throw new InputFailure(401,'UNAUTHORIZED');
      const raw=await bodyBytes(delivery.raw,scope);signature(delivery.signature,ctx.now());
      let event:VerifiedEvent;
      try {event=z.object({id:z.string().regex(/^evt_[A-Za-z0-9]+$/),type:z.string().min(1).max(100),
        objectId:z.string().min(1).max(255),objectType:z.string().min(1).max(100),created:z.number().int().nonnegative(),
        livemode:z.literal(false),accountId:z.literal(run.stripe.accountId)}).strict().parse(deps.verifyEvent(raw,delivery.signature));
      }catch {throw new InputFailure(400,'INVALID_SIGNATURE');}
      if(event.livemode || event.accountId!==run.stripe.accountId || !/^evt_[A-Za-z0-9]+$/.test(event.id))
        throw new InputFailure(400,'INVALID_SIGNATURE');
      Object.freeze(event);
      if(!deps.admission)return {status:503,diagnostic:'DURABLE_STORE_REQUIRED'};
      const grant=await ctx.authority(scope);scope.check();ctx.window();
      if(ctx.now()>=Date.parse(grant.expiresAt))throw new InputFailure(401,'UNAUTHORIZED');
      const commitScope=new AutomationScope(Math.min(scope.deadline,Date.parse(grant.expiresAt)),ctx.now,scope.signal);
      try {
        commitScope.check();const digest=sha(raw);commitStarted=true;
        const r=receipt(await scoped(deps.admission.commit({runId:run.runId,manifestDigest:ctx.binding.manifestDigest,
          database:run.target.database,event,payloadDigest:digest,supportedPayment:supported(event.type,event.objectType)},commitScope.signal),commitScope),
        run.runId,ctx.binding.manifestDigest,digest);
        if(r.eventId!==event.id || r.eventType!==event.type || r.objectType!==event.objectType)throw Error('EVENT_MISMATCH');
        ctx.window();return {status:200,receipt:r};
      } finally {commitScope.close();}
    } catch(error) {
      if(commitStarted)return {status:503,diagnostic:'DELIVERY_UNCERTAIN'};
      if(error instanceof InputFailure)return {status:error.status,diagnostic:error.code};
      return {status:503,diagnostic:'NOT_SENT'};
    } finally {scope?.close();}
  };
}
