import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pinned from '../scripts/stripe-automation-migration-manifest.json';
import { inspectAcceptanceHost, type ProtectedHostText } from '../src/server/stripe-acceptance-host';
import { artifactDigest, canonicalRunJson, freshAcceptanceNames, runManifestDigest } from '../src/server/stripe-acceptance-run';

vi.mock('pg',()=>{throw Error('Database forbidden');});
vi.mock('stripe',()=>{throw Error('Provider SDK forbidden');});
vi.mock('../src/db/client',()=>{throw Error('Shared pool forbidden');});
vi.mock('../scripts/lib/stripe-automation-docker',()=>{throw Error('Docker forbidden');});
vi.mock('../src/server/stripe-acceptance',()=>{throw Error('Operational boundary forbidden');});
vi.mock('../src/server/stripe-acceptance-http',()=>{throw Error('HTTP mounting forbidden');});
vi.mock('../src/server/stripe-automation-runner',()=>{throw Error('Runner forbidden');});
const runId='10000000-0000-4000-8000-000000000001';
const migrations=['scripts/stripe-automation-migration-manifest.json','drizzle/meta/_journal.json',
  ...pinned.entries.map(e=>`drizzle/${e.tag}.sql`)].sort().map(path=>({path,bytes:readFileSync(path)}));
const source=[{path:'src/server/synthetic.ts',bytes:Buffer.from('reviewed synthetic source\n')}];
function protectedText(path:string,value:unknown):ProtectedHostText {
  return {protection:{path,ownerUid:0,mode:0o400,regular:true,symlink:false,links:1,parentsProtected:true,openedNoFollow:true},
    settlement:'SETTLED',text:canonicalRunJson(value)};
}
function fixture() {
  const config={NODE_ENV:'test',mode:'source-only',profileId:'stage-2c-fresh-pg17-v1',runId,requestedOperations:['verify-read-only']};
  const m={version:1,profileId:config.profileId,runId,approvalReference:'review:stage-2c:synthetic-review-0001',
    target:{...freshAcceptanceNames(runId),containerId:'a'.repeat(64),networkId:'b'.repeat(64),
      volumeIdentity:'20000000-0000-4000-8000-000000000001',image:'postgres:17.6',imageId:`sha256:${'c'.repeat(64)}`,
      address:'172.28.0.2',port:5432},sourceDigest:artifactDigest('source',source),migrationDigest:artifactDigest('migrations',migrations),
    stripe:{mode:'test',accountId:'acct_synthetic',webhookEndpointId:'we_synthetic',apiVersion:'2026-08-26.dahlia'},
    operations:['verify-read-only'],issuedAt:'2035-01-01T00:00:00.000Z',notBefore:'2035-01-01T00:00:00.000Z',expiresAt:'2035-01-01T00:30:00.000Z',
    fixtures:{namespace:`stage2c:${runId}`,guestId:'30000000-0000-4000-8000-000000000001',
      unitId:'40000000-0000-4000-8000-000000000001',bookingOperationId:'50000000-0000-4000-8000-000000000001'},
    budgets:{invocations:10,items:50,providerRequests:600,providerPerInvocation:60,
      lanes:{PAYMENT_WEBHOOKS:2,CHECKOUT_COMMAND_RECOVERY:1,INITIAL_RECONCILIATION:1,BALANCE_RECONCILIATION:1,DEFERRED_INVESTIGATION:0}}};
  const manifestHash=runManifestDigest(canonicalRunJson(m));
  const authority={issuer:'protected-host-review-v1',approvalReference:m.approvalReference,runId,manifestDigest:manifestHash,
    sourceDigest:m.sourceDigest,migrationDigest:m.migrationDigest,sourcePaths:source.map(f=>f.path),
    allowedOperations:['verify-read-only'],notBefore:m.notBefore,expiresAt:'2035-01-01T00:25:00.000Z'};
  const resources=[m.target.project,m.target.container,m.target.network,m.target.volume,m.target.database,
    m.target.containerId,m.target.networkId,m.target.volumeIdentity];
  const inventory={history:{complete:true,runIds:[] as string[],resourceIdentities:[] as string[]},
    reservation:{kind:'durable-atomic-authority-record-v1',reservationId:'60000000-0000-4000-8000-000000000001',
      runId,manifestDigest:manifestHash,exclusive:true,resources,notBefore:m.notBefore,expiresAt:'2035-01-01T00:20:00.000Z'}};
  const docker={...m.target,running:true,privileged:false,addedCapabilities:0,internal:true,driver:'bridge',soleNetwork:true,
    soleContainer:true,dedicatedVolume:true,unexpectedMounts:false,publishedPorts:0,independentCredentials:true};
  const postgres={database_name:m.target.database,role_name:'zemaitija_app',session_role:'zemaitija_app',
    database_owner:'zemaitija_migrator',server_address:m.target.address,server_port:5432,server_version:170006,in_recovery:false,
    superuser:false,create_database:false,create_role:false,replication:false,bypass_rls:false,has_memberships:false,
    database_create:false,schema_create:false,recoveryMetadataUpdate:false,publicRecoveryExecute:false,
    recoveryDefinerOwner:'zemaitija_migrator',recoverySearchPath:'pg_catalog, public',recoveryGuardsValid:true,
    inventoryExclusionValid:true,financialConstraintsValid:true,migrationCount:36,migrationDigest:m.migrationDigest};
  const stripe={...m.stripe,livemode:false};
  let now=Date.parse('2035-01-01T00:01:00.000Z');
  const trace:string[]=[];
  const snapshot=(data:unknown)=>({manifestDigest:manifestHash,observedAt:'2035-01-01T00:00:50.000Z',expiresAt:'2035-01-01T00:01:40.000Z',data});
  const readers={now:()=>now,
    manifest:{read:vi.fn(async(path:string)=>{trace.push('manifest');return protectedText(path,m);})},
    artifact:{read:vi.fn(async(path:string)=>{trace.push('artifact');return {protection:protectedText(path,{}).protection,
      settlement:'SETTLED' as const,source,migrations};})},
    approval:{read:vi.fn(async(path:string)=>{trace.push('approval');return protectedText(path,authority);})},
    inventory:{read:vi.fn(async(path:string)=>{trace.push('inventory');return protectedText(path,inventory);})},
    docker:{read:vi.fn(async(path:string)=>{trace.push('docker');return protectedText(path,snapshot(docker));})},
    postgres:{read:vi.fn(async(path:string)=>{trace.push('postgres');return protectedText(path,snapshot(postgres));})},
    stripe:{read:vi.fn(async(path:string)=>{trace.push('stripe');return protectedText(path,snapshot(stripe));})},
  };
  return {config,m,authority,inventory,docker,postgres,stripe,readers,trace,resources,
    setTime:(instant:string)=>{now=Date.parse(instant);},
    run:()=>inspectAcceptanceHost(config,readers)};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('source-only dedicated acceptance host',()=>{
  it('checks in order and never reports operational readiness, even with all matching records',async()=>{
    const f=fixture(),result=await f.run();
    expect(result).toEqual({stage:'2C-3D',status:'PENDING_EXTERNAL_ATTESTATION',ready:false,operationsEnabled:false,
      diagnostic:'LIVE_REVALIDATION_REQUIRED'});
    expect(f.trace).toEqual(['manifest','artifact','approval','inventory','docker','postgres','stripe']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(f.readers.manifest.read).toHaveBeenCalledExactlyOnceWith(`/var/lib/zec-acceptance/approved/${runId}/manifest.json`);
    expect(f.readers.approval.read).toHaveBeenCalledExactlyOnceWith(`/var/lib/zec-acceptance/reviews/${runId}.json`);
    expect(f.readers.inventory.read).toHaveBeenCalledExactlyOnceWith('/var/lib/zec-acceptance/inventory.json');
  });
  it.each([{NODE_ENV:'production'},{mode:'live'},{runId:'../escape'},{database:'zemaitija_dev'},
    {DATABASE_URL:'synthetic-private-url'},{address:'172.28.0.9'},{approval:{approved:true}},
    {headers:{authorization:'synthetic-secret'}},{requestedOperations:['migrate']}])
  ('rejects config before manifest access %#',async change=>{
    const f=fixture();const result=await inspectAcceptanceHost({...f.config,...change},f.readers);
    expect(result.diagnostic).toBe('INVALID_CONFIGURATION');expect(f.trace).toEqual([]);
  });
  it('rejects wrong profile before manifest access',async()=>{
    const f=fixture();f.config.profileId='old-target';expect((await f.run()).diagnostic).toBe('INVALID_PROFILE');expect(f.trace).toEqual([]);
  });
  it.each(['zemaitija_dev','zemaitija_stripe_automation_dev'])('rejects target %s before artifacts or resources',async database=>{
    const f=fixture();f.m.target.database=database;expect((await f.run()).diagnostic).toBe('MANIFEST_INTEGRITY_FAILURE');
    expect(f.trace).toEqual(['manifest']);
  });
  it('rejects old container and unexpected manifest fields',async()=>{
    const f=fixture();f.m.target.container='zemaitija-stripe-automation-db';expect((await f.run()).status).toBe('REJECTED');
    const g=fixture();Object.assign(g.m,{targetOverride:'synthetic'});expect((await g.run()).status).toBe('REJECTED');
  });
  it.each(['sourceDigest','migrationDigest'] as const)('rejects %s mismatch before approval access',async key=>{
    const f=fixture();f.m[key]='d'.repeat(64);expect((await f.run()).diagnostic).toBe('MANIFEST_INTEGRITY_FAILURE');
    expect(f.trace).toEqual(['manifest','artifact']);
  });
  it('does not treat an approval-reference string or untrusted file as authorisation',async()=>{
    const f=fixture();Reflect.deleteProperty(f.readers,'approval');expect((await f.run()).diagnostic).toBe('APPROVAL_INVALID');
    const g=fixture();g.readers.approval.read.mockImplementation(async path=>{
      const record=protectedText(path,g.authority);Object.assign(record.protection,{ownerUid:1000});return record;
    });
    expect((await g.run()).diagnostic).toBe('APPROVAL_INVALID');expect(g.trace).not.toContain('docker');
  });
  it.each(['manifestDigest','sourceDigest','migrationDigest'] as const)('requires independent approval %s',async key=>{
    const f=fixture();f.authority[key]='e'.repeat(64);expect((await f.run()).diagnostic).toBe('APPROVAL_INVALID');
  });
  it('rejects expired/future authority and operation mismatch',async()=>{
    const f=fixture();f.authority.expiresAt='2035-01-01T00:01:00.000Z';expect((await f.run()).diagnostic).toBe('APPROVAL_EXPIRED');
    const g=fixture();g.authority.notBefore='2035-01-01T00:02:00.000Z';expect((await g.run()).diagnostic).toBe('APPROVAL_EXPIRED');
    const h=fixture();h.authority.allowedOperations=['dispatch-checkout'];expect((await h.run()).diagnostic).toBe('APPROVAL_INVALID');
    const j=fixture();j.config.requestedOperations=['dispatch-checkout'];expect((await j.run()).diagnostic).toBe('APPROVAL_INVALID');
  });
  it.each(['project','container','network','volume','database','containerId','networkId','volumeIdentity'] as const)
  ('rejects historical or foreign-reserved %s',async key=>{
    const f=fixture();f.inventory.history.resourceIdentities.push(f.m.target[key]);
    expect((await f.run()).diagnostic).toBe('RESOURCE_COLLISION');expect(f.trace).not.toContain('docker');
  });
  it('rejects reused run, incomplete inventory and duplicate entries',async()=>{
    const f=fixture();f.inventory.history.runIds.push(runId);expect((await f.run()).diagnostic).toBe('RESOURCE_COLLISION');
    const g=fixture();g.inventory.history.complete=false;expect((await g.run()).diagnostic).toBe('RESOURCE_COLLISION');
    const h=fixture();h.inventory.history.resourceIdentities.push('retired','retired');expect((await h.run()).diagnostic).toBe('RESOURCE_COLLISION');
  });
  it.each([{kind:'snapshot-only'},{exclusive:false},{manifestDigest:'f'.repeat(64)},
    {expiresAt:'2035-01-01T00:01:00.000Z'},{resources:[]},{runId:'70000000-0000-4000-8000-000000000001'}])
  ('requires exclusive durable reservation evidence %#',async change=>{
    const f=fixture();Object.assign(f.inventory.reservation,change);expect((await f.run()).diagnostic).toBe('RESERVATION_MISSING');
    expect(f.trace).not.toContain('docker');
  });
  it.each(['docker','postgres','stripe'] as const)('leaves absent %s explicitly pending',async key=>{
    const f=fixture();Reflect.deleteProperty(f.readers,key);const result=await f.run();
    expect(result.status).toBe('PENDING_EXTERNAL_ATTESTATION');expect(result.diagnostic).toBe(`${key.toUpperCase()}_UNAVAILABLE`);
    expect(result.ready).toBe(false);
  });
  it.each(['docker','postgres','stripe'] as const)('leaves unavailable %s pending and rejects unknown results',async key=>{
    const f=fixture();f.readers[key].read.mockResolvedValueOnce({state:'UNAVAILABLE'} as never);
    expect((await f.run()).status).toBe('PENDING_EXTERNAL_ATTESTATION');
    f.readers[key].read.mockResolvedValueOnce({state:'UNKNOWN'} as never);expect((await f.run()).status).toBe('REJECTED');
  });
  it.each(['docker','postgres','stripe'] as const)('rejects mismatched %s',async key=>{
    const f=fixture();Object.assign(f[key],key==='docker'?{container:'wrong'}:key==='postgres'?{superuser:true}:{accountId:'acct_wrong'});
    expect((await f.run()).diagnostic).toBe(`${key.toUpperCase()}_MISMATCH`);
  });
  it('rejects stale, future or wrong-manifest attestation records',async()=>{
    for(const change of [{observedAt:'2035-01-01T00:02:00.000Z'},{expiresAt:'2035-01-01T00:01:00.000Z'},
      {manifestDigest:'d'.repeat(64)}]) {
      const f=fixture();f.readers.docker.read.mockImplementation(async path=>protectedText(path,{
        manifestDigest:f.authority.manifestDigest,observedAt:'2035-01-01T00:00:50.000Z',expiresAt:'2035-01-01T00:01:40.000Z',data:f.docker,...change}));
      expect((await f.run()).diagnostic).toBe('DOCKER_MISMATCH');
    }
  });
  it('rechecks expiration after yielding to evidence readers',async()=>{
    const f=fixture();f.readers.docker.read.mockImplementation(async path=>{
      f.setTime('2035-01-01T00:26:00.000Z');return protectedText(path,{});
    });
    expect((await f.run()).status).toBe('REJECTED');expect(f.trace).not.toContain('postgres');
  });
  it('rejects earlier attestation records that expire while later records are read',async()=>{
    const f=fixture();f.readers.stripe.read.mockImplementation(async path=>{
      f.setTime('2035-01-01T00:01:41.000Z');
      return protectedText(path,{manifestDigest:f.authority.manifestDigest,observedAt:'2035-01-01T00:01:40.000Z',
        expiresAt:'2035-01-01T00:02:20.000Z',data:f.stripe});
    });
    expect((await f.run()).diagnostic).toBe('DOCKER_MISMATCH');
  });
  it.each([{symlink:true},{links:2},{mode:0o644},{parentsProtected:false},{openedNoFollow:false},
    {path:'/tmp/untrusted-manifest.json'}])('rejects unprotected manifest provenance %#',async change=>{
    const f=fixture();f.readers.manifest.read.mockImplementation(async path=>{
      const record=protectedText(path,f.m);Object.assign(record.protection,change);return record;
    });
    expect((await f.run()).diagnostic).toBe('MANIFEST_INTEGRITY_FAILURE');expect(f.trace).not.toContain('artifact');
  });
  it('surfaces resource uncertainty without printing secret details',async()=>{
    const secret='synthetic-private-url-and-bearer';const f=fixture();
    f.readers.approval.read.mockRejectedValue(Error(secret));const result=await f.run();
    expect(result.diagnostic).toBe('APPROVAL_INVALID');expect(JSON.stringify(result)).not.toContain(secret);
    const g=fixture();g.readers.inventory.read.mockImplementation(async path=>({...protectedText(path,g.inventory),settlement:'UNCERTAIN'}));
    expect((await g.run()).diagnostic).toBe('RESOURCE_UNCERTAIN');
  });
  it('has no live construction path or network/environment side effects',async()=>{
    const network=vi.fn(()=>{throw Error('Network forbidden');});vi.stubGlobal('fetch',network);
    const load=vi.spyOn(process,'loadEnvFile').mockImplementation(()=>{throw Error('Env forbidden');});
    const f=fixture();expect((await f.run()).ready).toBe(false);expect(network).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();
    expect(Object.keys(await import('../src/server/stripe-acceptance-host'))).toEqual(['inspectAcceptanceHost']);
  });
});
