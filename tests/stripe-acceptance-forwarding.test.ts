import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAcceptanceWebhookForwarder, createAcceptanceWebhookIngestion, type AcceptanceAdmissionReceipt,
  type AcceptanceForwardRequest } from '../src/server/stripe-acceptance-forwarding';
import { canonicalRunJson, runManifestDigest } from '../src/server/stripe-acceptance-run';
import { forwardingRun } from './helpers/stripe-acceptance-forwarding-fixture';
import type { VerifiedEvent } from '../src/server/stripe-adapter';

vi.mock('pg',()=>{throw Error('Database forbidden');});
vi.mock('stripe',()=>{throw Error('Stripe SDK forbidden');});
vi.mock('../src/db/client',()=>{throw Error('Shared pool forbidden');});
vi.mock('../src/server/stripe-acceptance',()=>{throw Error('Old boundary forbidden');});
vi.mock('../src/server/stripe-acceptance-http',()=>{throw Error('HTTP mounting forbidden');});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2035-01-01T00:01:00.000Z'));
  vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Default network forbidden');}));});
afterEach(()=>{expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
const token='abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const signature=()=>`t=${Math.floor(Date.now()/1000)},v1=${'a'.repeat(64)}`;
function fixture() {
  const run=forwardingRun(),manifestDigest=runManifestDigest(canonicalRunJson(run));
  const grant={status:'VERIFIED',runId:run.runId,manifestDigest,forwardingProfile:'fresh-loopback-webhook-v1',
    operation:'ingest-payment-webhook',notBefore:run.notBefore,expiresAt:run.expiresAt,reservationVerified:true,
    targetVerified:true,accountVerified:true,durableAdmissionVerified:true};
  const authority={verify:vi.fn(async()=>({...grant}))},credentials={readBearer:vi.fn(async()=>token)};
  const event:VerifiedEvent={id:'evt_synthetic',type:'checkout.session.completed',objectType:'checkout.session',
    objectId:'cs_test_synthetic',created:Math.floor(Date.now()/1000),livemode:false,accountId:run.stripe.accountId};
  const makeReceipt=(bytes:Uint8Array):AcceptanceAdmissionReceipt=>({version:1,durable:true,runId:run.runId,manifestDigest,
    payloadDigest:sha(bytes),originalPayloadDigest:sha(bytes),eventId:event.id,eventType:event.type,objectType:event.objectType,
    disposition:'INGESTED',lane:'PAYMENT',ownership:'OWNED'});
  const fetch=vi.fn<typeof globalThis.fetch>(async(_url,init)=>Response.json(makeReceipt(new Uint8Array(init!.body as ArrayBuffer))));
  const deps={now:Date.now,authority,credentials,fetch},forward=createAcceptanceWebhookForwarder(run,deps);
  const raw=Buffer.from('{ "synthetic": "žą 😀" }\n');
  const input:AcceptanceForwardRequest={method:'POST',path:`/stripe/acceptance/${run.runId}/webhook`,
    headers:[['Stripe-Signature',signature()],['Host','untrusted.invalid']],body:raw};
  const admission={commit:vi.fn(async(data:{payloadDigest:string})=>({...makeReceipt(raw),payloadDigest:data.payloadDigest}))};
  const verifyEvent=vi.fn((raw:Buffer,signature:string)=>{void raw;void signature;return {...event};});
  const ingest=()=>createAcceptanceWebhookIngestion(run,{...deps,verifyEvent,admission});
  return {run,grant,deps,authority,credentials,fetch,forward,input,raw,event,makeReceipt,admission,verifyEvent,ingest};
}

describe('fixed, unmounted forwarding boundary',()=>{
  it('preserves bytes and original signature and supplies only private minimal headers',async()=>{
    const f=fixture();f.input.headers=[['Host','ignored.invalid'],['Stripe-Signature',signature().replace(',v1',', v1')]];
    expect(await f.forward(f.input)).toMatchObject({status:200,outcome:'DURABLE'});
    const [url,init]=f.fetch.mock.calls[0];
    expect(url).toBe(`http://127.0.0.1:3101/api/acceptance/runs/${f.run.runId}/stripe/webhook`);
    expect(init).toMatchObject({method:'POST',redirect:'manual',credentials:'omit',cache:'no-store'});
    expect(init!.headers).toEqual({'Content-Type':'application/json','Stripe-Signature':f.input.headers[1][1],Authorization:`Bearer ${token}`});
    expect(Buffer.from(init!.body as ArrayBuffer)).toEqual(f.raw);expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('preserves arbitrary binary bytes without parsing the signed body',async()=>{
    const f=fixture(),raw=Uint8Array.from([0,255,128,13,10,123,34,0]);f.input.body=raw;
    expect((await f.forward(f.input)).status).toBe(200);expect(new Uint8Array(f.fetch.mock.calls[0][1]!.body as ArrayBuffer)).toEqual(raw);
  });
  it.each(['destination','database','runId','authorization'])('rejects caller override %s',async key=>{
    const f=fixture();expect((await f.forward({...f.input,[key]:'untrusted'})).status).not.toBe(200);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(['Authorization','X-Forwarded-Host','Forwarded','X-Acceptance-Run','X-Database-Target'])('rejects spoofed %s header',async name=>{
    const f=fixture();f.input.headers.push([name,'untrusted']);expect((await f.forward(f.input)).status).not.toBe(200);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([[],[['Stripe-Signature','']], [['Stripe-Signature','t=1,v1=bad']],
    [['Stripe-Signature',signature()],['stripe-signature',signature()]],
    [['Stripe-Signature',signature()+', t=1']], [['Stripe-Signature',signature()+'\r\nspoof']],
    [['Stripe-Signature',`t=1,v1=${'a'.repeat(64)}`]]].map(headers=>({headers:headers as [string,string][]})))
  ('rejects missing/duplicate/malformed/stale signature %#',async({headers})=>{
    const f=fixture();f.input.headers=headers;
    expect((await f.forward(f.input)).status).toBe(400);expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([{method:'GET'},{path:'/api/stripe/webhook'},{path:'/stripe/acceptance/other/webhook'},
    {path:'/stripe/webhook?destination=unsafe'},{body:new Uint8Array(1024*1024+1)}])('rejects request %#',async change=>{
    const f=fixture();expect((await f.forward({...f.input,...change} as AcceptanceForwardRequest)).status).not.toBe(200);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('bounds streamed bodies and declared size without sending',async()=>{
    const f=fixture();f.input.body=new ReadableStream({start(c){c.enqueue(new Uint8Array(1024*1024+1));c.close();}});
    expect((await f.forward(f.input)).status).toBe(413);expect(f.fetch).not.toHaveBeenCalled();
    const g=fixture();g.input.headers.push(['Content-Length','1048577']);expect((await g.forward(g.input)).status).toBe(413);
  });
  it('preserves streamed UTF-8 chunks even when split inside a multibyte character',async()=>{
    const f=fixture();f.input.body=new ReadableStream({start(c){c.enqueue(f.raw.subarray(0,19));c.enqueue(f.raw.subarray(19));c.close();}});
    expect((await f.forward(f.input)).status).toBe(200);expect(Buffer.from(f.fetch.mock.calls[0][1]!.body as ArrayBuffer)).toEqual(f.raw);
  });
  it('requires independent current authority, not just a seal',async()=>{
    const f=fixture();f.authority.verify.mockResolvedValueOnce({status:'PENDING_EXTERNAL_ATTESTATION'} as never);
    expect((await f.forward(f.input)).status).not.toBe(200);expect(f.fetch).not.toHaveBeenCalled();
    const g=fixture();g.grant.runId='20000000-0000-4000-8000-000000000001';expect((await g.forward(g.input)).status).toBe(401);
    expect(()=>createAcceptanceWebhookForwarder(structuredClone(g.run),g.deps)).toThrow();
  });
  it('rejects a missing transport without selecting the default fetch',()=>{
    const f=fixture();expect(()=>createAcceptanceWebhookForwarder(f.run,{...f.deps,fetch:undefined as never})).toThrow('FORWARDING_CONTRACT_REJECTED');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('rejects expired and future run authority before send',async()=>{
    const f=fixture();f.grant.expiresAt='2035-01-01T00:01:00.000Z';expect((await f.forward(f.input)).status).toBe(401);
    const g=fixture();vi.setSystemTime('2034-01-01T00:00:00Z');expect((await g.forward(g.input)).status).toBe(401);
    expect(g.fetch).not.toHaveBeenCalled();
  });
  it.each(['INGESTED','DUPLICATE','INVESTIGATION'] as const)('acknowledges only durable %s receipts',async disposition=>{
    const f=fixture();f.fetch.mockImplementation(async()=>Response.json({...f.makeReceipt(f.raw),disposition,
      ...(disposition==='INVESTIGATION'?{ownership:'UNKNOWN',lane:'NONE'}:{})}));
    expect(await f.forward(f.input)).toMatchObject({status:200,outcome:'DURABLE',diagnostic:`DURABLE_${disposition}`});
  });
  it('does not acknowledge until the durable downstream reply arrives',async()=>{
    const f=fixture();let finish!:(response:Response)=>void;
    f.fetch.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    let settled=false;const pending=f.forward(f.input).then(r=>{settled=true;return r;});
    await vi.advanceTimersByTimeAsync(0);expect(settled).toBe(false);
    finish(Response.json(f.makeReceipt(f.raw)));expect((await pending).status).toBe(200);
  });
  it.each([400,401,413,503,500,202])('fails closed for downstream %s',async status=>{
    const f=fixture();f.fetch.mockResolvedValue(new Response('private details',{status}));
    const r=await f.forward(f.input);expect(r.status).toBe([400,401,413].includes(status)?status:503);
    expect(r.outcome).not.toBe('DURABLE');expect(JSON.stringify(r)).not.toContain('private');expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each([301,302,307,308])('rejects redirect %s without another call',async status=>{
    const f=fixture();f.fetch.mockResolvedValue(new Response(null,{status,headers:{Location:'https://untrusted.invalid'}}));
    expect(await f.forward(f.input)).toMatchObject({status:503,outcome:'UNCERTAIN'});expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('rejects a transport that reports an already-followed redirect',async()=>{
    const f=fixture(),response=Response.json(f.makeReceipt(f.raw));
    Object.defineProperty(response,'redirected',{value:true});f.fetch.mockResolvedValue(response);
    expect((await f.forward(f.input)).outcome).toBe('UNCERTAIN');expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('distinguishes pre-send cancellation from post-send uncertainty and never retries',async()=>{
    const f=fixture(),controller=new AbortController();controller.abort();
    expect(await f.forward({...f.input,signal:controller.signal})).toMatchObject({outcome:'NOT_SENT'});expect(f.fetch).not.toHaveBeenCalled();
    const g=fixture(),live=new AbortController();let started!:()=>void;const sent=new Promise<void>(resolve=>{started=resolve;});
    g.fetch.mockImplementation(async(_input,init)=>new Promise((_resolve,reject)=>{started();
      init!.signal!.addEventListener('abort',()=>reject(Error('private possibly committed')),{once:true});}));
    const pending=g.forward({...g.input,signal:live.signal});await sent;live.abort();
    expect(await pending).toMatchObject({status:503,outcome:'UNCERTAIN'});expect(g.fetch).toHaveBeenCalledOnce();
  });
  it('enforces header/body response deadlines and response size',async()=>{
    const f=fixture();let aborted=false;
    f.fetch.mockImplementation(async(_input,init)=>new Response(new ReadableStream({start(c){
      init!.signal!.addEventListener('abort',()=>{aborted=true;c.error(Error('aborted'));},{once:true});
    }})));
    const pending=f.forward(f.input);await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({status:503,outcome:'UNCERTAIN'});expect(aborted).toBe(true);
    const g=fixture();g.fetch.mockResolvedValue(new Response(new Uint8Array(1024*1024+1)));
    expect((await g.forward(g.input)).outcome).toBe('UNCERTAIN');
    const h=fixture();h.fetch.mockResolvedValue(new Response(' '.repeat(4097),{headers:{'Content-Type':'application/json'}}));
    expect((await h.forward(h.input)).outcome).toBe('UNCERTAIN');
  });
  it('bounds inbound body and authority waits before transmission',async()=>{
    const f=fixture();f.input.body=new ReadableStream();const pending=f.forward(f.input);
    await vi.advanceTimersByTimeAsync(2001);expect((await pending).outcome).toBe('NOT_SENT');expect(f.fetch).not.toHaveBeenCalled();
    const g=fixture();g.authority.verify.mockImplementation(()=>new Promise(()=>{}));
    const waiting=g.forward(g.input);await vi.advanceTimersByTimeAsync(5001);expect((await waiting).outcome).toBe('NOT_SENT');
  });
  it.each([{durable:false},{payloadDigest:'e'.repeat(64)},{runId:'20000000-0000-4000-8000-000000000001'},
    {disposition:'DUPLICATE',ownership:'DIGEST_CONFLICT'},{eventType:'refund.created',objectType:'refund'}])
  ('rejects invalid or conflicting receipt %#',async change=>{
    const f=fixture();f.fetch.mockResolvedValue(Response.json({...f.makeReceipt(f.raw),...change}));
    expect((await f.forward(f.input)).outcome).toBe('UNCERTAIN');
  });
});

describe('acceptance-only durable admission contract',()=>{
  it('verifies exact raw bytes before admission and requires a durable store',async()=>{
    const f=fixture();const output=await f.ingest()({raw:f.raw,signature:signature(),authorization:`Bearer ${token}`});
    expect(output.status).toBe(200);expect(f.verifyEvent).toHaveBeenCalledExactlyOnceWith(f.raw,signature());
    expect(f.admission.commit).toHaveBeenCalledWith(expect.objectContaining({database:f.run.target.database,supportedPayment:true}),expect.any(AbortSignal));
    const missing=createAcceptanceWebhookIngestion(f.run,{...f.deps,verifyEvent:f.verifyEvent});
    expect(await missing({raw:f.raw,signature:signature(),authorization:`Bearer ${token}`})).toEqual({status:503,diagnostic:'DURABLE_STORE_REQUIRED'});
  });
  it.each(['refund.created','charge.refunded','charge.dispute.created','checkout.session.async_payment_succeeded','unknown.event'])
  ('keeps %s outside the payment lane',async type=>{
    const f=fixture();f.event.type=type;f.event.objectType='refund';
    f.admission.commit.mockImplementation(async data=>({...f.makeReceipt(f.raw),payloadDigest:data.payloadDigest,
      disposition:'INVESTIGATION',lane:'NONE',ownership:'UNSUPPORTED'}));
    const r=await f.ingest()({raw:f.raw,signature:signature(),authorization:`Bearer ${token}`});
    expect(r).toMatchObject({status:200,receipt:{lane:'NONE',ownership:'UNSUPPORTED'}});
    expect(f.admission.commit.mock.calls[0][0]).toMatchObject({supportedPayment:false});
  });
  it.each(['UNKNOWN','CONFLICT','DIGEST_CONFLICT'] as const)('requires durable investigation for %s',async ownership=>{
    const f=fixture();f.admission.commit.mockImplementation(async data=>({...f.makeReceipt(f.raw),payloadDigest:data.payloadDigest,
      originalPayloadDigest:ownership==='DIGEST_CONFLICT'?'e'.repeat(64):data.payloadDigest,
      disposition:'INVESTIGATION',lane:'NONE',ownership}));
    expect(await f.ingest()({raw:f.raw,signature:signature(),authorization:`Bearer ${token}`}))
      .toMatchObject({status:200,receipt:{disposition:'INVESTIGATION',lane:'NONE',ownership}});
  });
  it.each(['live','account','signature','bearer'])('rejects %s before storage',async condition=>{
    const f=fixture();if(condition==='live')f.event.livemode=true;if(condition==='account')f.event.accountId='acct_other';
    if(condition==='signature')f.verifyEvent.mockImplementation(()=>{throw Error('private signature error');});
    const r=await f.ingest()({raw:f.raw,signature:signature(),authorization:condition==='bearer'?'Bearer wrong':`Bearer ${token}`});
    expect(r.status).toBe(condition==='bearer'?401:400);expect(f.admission.commit).not.toHaveBeenCalled();
  });
  it('reports uncertain commit without retry or payment-failure claims',async()=>{
    const f=fixture();f.admission.commit.mockRejectedValue(Error('private database URL'));
    expect(await f.ingest()({raw:f.raw,signature:signature(),authorization:`Bearer ${token}`}))
      .toEqual({status:503,diagnostic:'DELIVERY_UNCERTAIN'});expect(f.admission.commit).toHaveBeenCalledOnce();
  });
  it('retains the original digest and records conflicts instead of ordinary duplicates',async()=>{
    const f=fixture(),events=new Map<string,string>(),incidents:string[]=[];
    f.admission.commit.mockImplementation(async input=>{
      const original=events.get(f.event.id),conflict=original!==undefined && original!==input.payloadDigest;
      if(!original)events.set(f.event.id,input.payloadDigest);
      if(conflict)incidents.push(input.payloadDigest);
      return {...f.makeReceipt(f.raw),payloadDigest:input.payloadDigest,originalPayloadDigest:original??input.payloadDigest,
        disposition:conflict?'INVESTIGATION':original?'DUPLICATE':'INGESTED',lane:conflict?'NONE':'PAYMENT',
        ownership:conflict?'DIGEST_CONFLICT':'OWNED'};
    });
    const ingest=f.ingest(),delivery={raw:f.raw,signature:signature(),authorization:`Bearer ${token}`};
    expect((await ingest(delivery)).receipt?.disposition).toBe('INGESTED');
    expect((await ingest(delivery)).receipt?.disposition).toBe('DUPLICATE');
    expect((await ingest({...delivery,raw:Buffer.from('different signed synthetic bytes')})).receipt)
      .toMatchObject({disposition:'INVESTIGATION',ownership:'DIGEST_CONFLICT',lane:'NONE'});
    expect(events.size).toBe(1);expect(events.get(f.event.id)).toBe(sha(f.raw));expect(incidents).toHaveLength(1);
  });
});
