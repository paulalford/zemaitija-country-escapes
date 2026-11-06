import 'server-only';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import pinned from '../../scripts/stripe-automation-migration-manifest.json';
import { artifactDigest, canonicalRunJson, freshAcceptanceNames, FRESH_ACCEPTANCE_PROFILE,
  runManifestDigest, sealAcceptanceRun, type ArtifactFile, type AcceptanceRunEvidence } from './stripe-acceptance-run';

const uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const reference=z.string().regex(/^review:stage-2c:[a-z0-9][a-z0-9-]{15,79}$/);
const instant=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(s=>Number.isFinite(Date.parse(s)) && new Date(s).toISOString()===s);
const operation=z.enum(['prepare-booking','dispatch-checkout','ingest-payment-webhook','reconcile-payment','verify-read-only']);
const operations=z.array(operation).min(1).max(5).refine(v=>new Set(v).size===v.length && [...v].sort().join()===v.join());
const configSchema=z.object({NODE_ENV:z.literal('test'),mode:z.literal('source-only'),
  profileId:z.string(),runId:uuid,requestedOperations:operations}).strict();
const targetSchema=z.object({project:z.string(),service:z.string(),container:z.string(),network:z.string(),volume:z.string(),
  database:z.string(),owner:z.literal('zemaitija_migrator'),role:z.literal('zemaitija_app'),containerId:hash,networkId:hash,
  volumeIdentity:uuid,image:z.literal('postgres:17.6'),imageId:z.string().regex(/^sha256:[a-f0-9]{64}$/),
  address:z.string().refine(s=>isIP(s)===4 && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(s)),port:z.literal(5432)}).strict();
// Version-1 wire shape, checked before any attestation record is needed. The
// unchanged seal validator remains the final authority over combined evidence.
const manifestSchema=z.object({version:z.literal(1),profileId:z.literal('stage-2c-fresh-pg17-v1'),runId:uuid,
  approvalReference:reference,target:targetSchema,sourceDigest:hash,migrationDigest:hash,
  stripe:z.object({mode:z.literal('test'),accountId:z.string().regex(/^acct_[A-Za-z0-9]+$/),
    webhookEndpointId:z.string().regex(/^we_[A-Za-z0-9]+$/),apiVersion:z.literal('2026-08-26.dahlia')}).strict(),
  operations,issuedAt:instant,notBefore:instant,expiresAt:instant,
  fixtures:z.object({namespace:z.string(),guestId:uuid,unitId:uuid,bookingOperationId:uuid}).strict(),
  budgets:z.object({invocations:z.number().int().min(1).max(30),items:z.number().int().min(1).max(150),
    providerRequests:z.number().int().min(1).max(1800),providerPerInvocation:z.number().int().min(1).max(60),
    lanes:z.object({PAYMENT_WEBHOOKS:z.number().int().min(1).max(2),CHECKOUT_COMMAND_RECOVERY:z.literal(1),
      INITIAL_RECONCILIATION:z.literal(1),BALANCE_RECONCILIATION:z.literal(1),DEFERRED_INVESTIGATION:z.literal(0)}).strict()}).strict(),
}).strict();
const authoritySchema=z.object({issuer:z.literal('protected-host-review-v1'),approvalReference:reference,runId:uuid,
  manifestDigest:hash,sourceDigest:hash,migrationDigest:hash,sourcePaths:z.array(z.string()).min(1).max(4096),
  allowedOperations:operations,notBefore:instant,expiresAt:instant}).strict();
const historySchema=z.object({complete:z.literal(true),runIds:z.array(uuid).max(4096),
  resourceIdentities:z.array(z.string().min(1).max(256)).max(32768)}).strict();
const reservationSchema=z.object({kind:z.literal('durable-atomic-authority-record-v1'),reservationId:uuid,
  runId:uuid,manifestDigest:hash,exclusive:z.literal(true),resources:z.array(z.string()).length(8),
  notBefore:instant,expiresAt:instant}).strict();
const inventorySchema=z.object({history:historySchema,reservation:z.unknown()}).strict();
const protectionSchema=z.object({path:z.string(),ownerUid:z.literal(0),mode:z.union([z.literal(0o400),z.literal(0o600)]),
  regular:z.literal(true),symlink:z.literal(false),links:z.literal(1),parentsProtected:z.literal(true),
  openedNoFollow:z.literal(true)}).strict();
const recordSchema=z.object({protection:protectionSchema,settlement:z.enum(['SETTLED','UNCERTAIN']),text:z.string().max(1024*1024)}).strict();
export type ProtectedHostText=z.input<typeof recordSchema>;
export interface ProtectedHostReader { read(fixedPath:string):Promise<ProtectedHostText> }
export interface RecordedHostAttestationReader {
  read(fixedPath:string):Promise<ProtectedHostText|{state:'UNAVAILABLE'}>;
}
const artifactFileSchema=z.object({path:z.string(),bytes:z.instanceof(Uint8Array).refine(b=>b.byteLength<=4*1024*1024)}).strict();
const artifactSchema=z.object({protection:protectionSchema,settlement:z.enum(['SETTLED','UNCERTAIN']),
  source:z.array(artifactFileSchema).min(1).max(4096),migrations:z.array(artifactFileSchema).length(38)}).strict();
export interface ReviewedHostArtifactReader {
  read(fixedIndexPath:string):Promise<z.input<typeof artifactSchema>>;
}
/** Trusted record-reading capabilities only. No operational factories, default
 * adapters, credentials, env loader, listeners, query callbacks or SDKs. */
export type AcceptanceHostReaders={now:()=>number;manifest?:ProtectedHostReader;approval?:ProtectedHostReader;
  inventory?:ProtectedHostReader;artifact?:ReviewedHostArtifactReader;
  docker?:RecordedHostAttestationReader;postgres?:RecordedHostAttestationReader;stripe?:RecordedHostAttestationReader};
export type HostDiagnostic='INVALID_CONFIGURATION'|'INVALID_PROFILE'|'MANIFEST_INTEGRITY_FAILURE'|'APPROVAL_INVALID'|
  'APPROVAL_EXPIRED'|'RESOURCE_COLLISION'|'RESERVATION_MISSING'|'DOCKER_UNAVAILABLE'|'DOCKER_MISMATCH'|
  'POSTGRES_UNAVAILABLE'|'POSTGRES_MISMATCH'|'STRIPE_UNAVAILABLE'|'STRIPE_MISMATCH'|'RESOURCE_UNCERTAIN'|
  'LIVE_REVALIDATION_REQUIRED';
export type AcceptanceHostReadiness=Readonly<{stage:'2C-3D';status:'REJECTED'|'PENDING_EXTERNAL_ATTESTATION';
  ready:false;operationsEnabled:false;diagnostic:HostDiagnostic}>;
class Rejection extends Error {
  constructor(readonly code:HostDiagnostic,readonly pending=false){super(code);}
}
const reject=(code:HostDiagnostic):never=>{throw new Rejection(code);};
const equal=(a:unknown,b:unknown)=>canonicalRunJson(a)===canonicalRunJson(b);
const root='/var/lib/zec-acceptance';
function protectedRecord(raw:unknown,path:string) {
  const record=recordSchema.parse(raw);
  if(record.settlement!=='SETTLED')return reject('RESOURCE_UNCERTAIN');
  if(Buffer.byteLength(record.text,'utf8')>1024*1024)throw Error('Record size');
  if(record.protection.path!==path)throw Error('Wrong protected record');
  const decoded:unknown=JSON.parse(record.text);
  if(canonicalRunJson(decoded)!==record.text)throw Error('Noncanonical record');
  return {record,decoded};
}
function currentWindow(start:string,end:string,now:number) {
  return Date.parse(start)<=now && now<Date.parse(end) && Date.parse(end)>Date.parse(start);
}
function resourceIdentities(target:z.infer<typeof targetSchema>) {
  return [target.project,target.container,target.network,target.volume,target.database,target.containerId,target.networkId,target.volumeIdentity];
}
function verifyMigrationBytes(files:readonly ArtifactFile[]) {
  const paths=['scripts/stripe-automation-migration-manifest.json','drizzle/meta/_journal.json',
    ...pinned.entries.map(e=>`drizzle/${e.tag}.sql`)].sort();
  if(!equal(files.map(f=>f.path),paths))throw Error('Migration paths');
  const bytes=new Map(files.map(f=>[f.path,f.bytes]));
  const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  if(sha(bytes.get('scripts/stripe-automation-migration-manifest.json')!)!==FRESH_ACCEPTANCE_PROFILE.pinnedManifestSha256 ||
    pinned.entries.some(e=>sha(bytes.get(`drizzle/${e.tag}.sql`)!)!==e.sha256))throw Error('Migration bytes');
  const journal:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.get('drizzle/meta/_journal.json')));
  if(!equal(journal,{version:'7',dialect:'postgresql',entries:pinned.entries.map(e=>{
    const {sha256,...entry}=e;void sha256;return entry;
  })}))throw Error('Migration journal');
}

/** Inspect detached protected records only. Never returns READY or an operational
 * capability, even when all recorded external attestations match. */
export async function inspectAcceptanceHost(config:unknown,readers:AcceptanceHostReaders):Promise<AcceptanceHostReadiness> {
  let stage:HostDiagnostic='INVALID_CONFIGURATION';
  const result=(status:AcceptanceHostReadiness['status'],diagnostic:HostDiagnostic):AcceptanceHostReadiness=>
    Object.freeze({stage:'2C-3D',status,ready:false,operationsEnabled:false,diagnostic});
  try {
    const cfg=configSchema.parse(config);
    stage='INVALID_PROFILE';
    if(cfg.profileId!==FRESH_ACCEPTANCE_PROFILE.id)reject(stage);
    const names=freshAcceptanceNames(cfg.runId);
    stage='INVALID_CONFIGURATION';
    const clock=()=>{const n=readers.now();if(!Number.isSafeInteger(n) || n<0)reject('RESOURCE_UNCERTAIN');return n;};
    clock();
    stage='MANIFEST_INTEGRITY_FAILURE';
    const manifestPath=`${root}/approved/${cfg.runId}/manifest.json`;
    const {record,decoded}=protectedRecord(await readers.manifest!.read(manifestPath),manifestPath);
    if(Buffer.byteLength(record.text,'utf8')>16384)reject(stage);
    const m=manifestSchema.parse(decoded),manifestHash=runManifestDigest(record.text);
    if(m.runId!==cfg.runId || m.profileId!==cfg.profileId || !equal(names,Object.fromEntries(
      Object.keys(names).map(key=>[key,m.target[key as keyof typeof m.target]]))) || m.target.containerId===m.target.networkId)reject(stage);
    const b=m.budgets;
    if(b.items!==b.invocations*Object.values(b.lanes).reduce((sum,n)=>sum+n,0) ||
      b.providerRequests!==b.invocations*b.providerPerInvocation || m.fixtures.namespace!==`stage2c:${m.runId}` ||
      new Set([m.fixtures.guestId,m.fixtures.unitId,m.fixtures.bookingOperationId]).size!==3 ||
      Date.parse(m.issuedAt)>Date.parse(m.notBefore) || Date.parse(m.notBefore)-Date.parse(m.issuedAt)>1800000 ||
      Date.parse(m.expiresAt)-Date.parse(m.notBefore)>1800000 || Date.parse(m.expiresAt)<=Date.parse(m.notBefore))reject(stage);
    const artifactPath=`${root}/artifacts/${m.sourceDigest}/index.json`;
    const artifact=artifactSchema.parse(await readers.artifact!.read(artifactPath));
    if(artifact.settlement!=='SETTLED')reject('RESOURCE_UNCERTAIN');
    if(artifact.protection.path!==artifactPath)reject(stage);
    if([...artifact.source,...artifact.migrations].reduce((sum,f)=>sum+f.bytes.byteLength,0)>32*1024*1024)reject(stage);
    // Own byte snapshots before yielding again; readers cannot change reviewed bytes later.
    const copy=(files:ArtifactFile[])=>files.map(f=>({path:f.path,bytes:Buffer.from(f.bytes)}));
    const source=copy(artifact.source),migrations=copy(artifact.migrations);
    if(artifactDigest('source',source)!==m.sourceDigest || artifactDigest('migrations',migrations)!==m.migrationDigest)reject(stage);
    verifyMigrationBytes(migrations);
    stage='APPROVAL_INVALID';
    const approvalPath=`${root}/reviews/${cfg.runId}.json`;
    const a=authoritySchema.parse(protectedRecord(await readers.approval!.read(approvalPath),approvalPath).decoded);
    if(a.runId!==m.runId || a.approvalReference!==m.approvalReference || a.manifestDigest!==manifestHash ||
      a.sourceDigest!==m.sourceDigest || a.migrationDigest!==m.migrationDigest || !equal(a.sourcePaths,source.map(f=>f.path)) ||
      !equal(a.allowedOperations,m.operations) || cfg.requestedOperations.some(op=>!a.allowedOperations.includes(op)))reject(stage);
    const checkAuthority=()=>{
      const now=clock();
      if(!currentWindow(a.notBefore,a.expiresAt,now) || !currentWindow(m.notBefore,m.expiresAt,now) ||
        Date.parse(a.notBefore)<Date.parse(m.notBefore) || Date.parse(a.expiresAt)>Date.parse(m.expiresAt))reject('APPROVAL_EXPIRED');
      return now;
    };
    checkAuthority();
    stage='RESOURCE_COLLISION';
    const inventoryPath=`${root}/inventory.json`;
    const inventory=inventorySchema.parse(protectedRecord(await readers.inventory!.read(inventoryPath),inventoryPath).decoded);
    const resources=resourceIdentities(m.target);
    if(inventory.history.runIds.includes(m.runId) || resources.some(r=>inventory.history.resourceIdentities.includes(r)) ||
      new Set(inventory.history.runIds).size!==inventory.history.runIds.length ||
      new Set(inventory.history.resourceIdentities).size!==inventory.history.resourceIdentities.length)reject(stage);
    stage='RESERVATION_MISSING';
    const reservation=reservationSchema.parse(inventory.reservation);
    const checkReservation=()=>{
      const now=checkAuthority();
      if(reservation.runId!==m.runId || reservation.manifestDigest!==manifestHash || !equal(reservation.resources,resources) ||
        !currentWindow(reservation.notBefore,reservation.expiresAt,now) || Date.parse(reservation.notBefore)<Date.parse(a.notBefore) ||
        Date.parse(reservation.expiresAt)>Date.parse(a.expiresAt))reject('RESERVATION_MISSING');
      return now;
    };
    checkReservation();
    const attestationWindows:{start:string;end:string;code:HostDiagnostic}[]=[];
    const attestation=async(kind:'docker'|'postgres'|'stripe',expected:unknown)=>{
      const unavailable=({docker:'DOCKER_UNAVAILABLE',postgres:'POSTGRES_UNAVAILABLE',stripe:'STRIPE_UNAVAILABLE'} as const)[kind];
      const mismatch=({docker:'DOCKER_MISMATCH',postgres:'POSTGRES_MISMATCH',stripe:'STRIPE_MISMATCH'} as const)[kind];
      stage=unavailable;checkReservation();
      const reader=readers[kind];
      if(!reader)throw new Rejection(unavailable,true);
      const path=`${root}/attestations/${m.runId}/${kind}.json`,raw=await reader.read(path);
      if(equal(raw,{state:'UNAVAILABLE'}))throw new Rejection(unavailable,true);
      stage=mismatch;
      const body=protectedRecord(raw,path).decoded;
      const snapshot=z.object({manifestDigest:hash,observedAt:instant,expiresAt:instant,data:z.unknown()}).strict().parse(body);
      const now=checkReservation();
      if(snapshot.manifestDigest!==manifestHash || !currentWindow(snapshot.observedAt,snapshot.expiresAt,now) ||
        Date.parse(snapshot.expiresAt)-Date.parse(snapshot.observedAt)>60000 || !equal(snapshot.data,expected))reject(mismatch);
      attestationWindows.push({start:snapshot.observedAt,end:snapshot.expiresAt,code:mismatch});
      return snapshot.data;
    };
    const docker=await attestation('docker',{...m.target,running:true,privileged:false,addedCapabilities:0,internal:true,
      driver:'bridge',soleNetwork:true,soleContainer:true,dedicatedVolume:true,unexpectedMounts:false,publishedPorts:0,independentCredentials:true});
    const postgres=await attestation('postgres',{database_name:m.target.database,role_name:m.target.role,session_role:m.target.role,
      database_owner:m.target.owner,server_address:m.target.address,server_port:5432,server_version:170006,in_recovery:false,
      superuser:false,create_database:false,create_role:false,replication:false,bypass_rls:false,has_memberships:false,
      database_create:false,schema_create:false,recoveryMetadataUpdate:false,publicRecoveryExecute:false,
      recoveryDefinerOwner:'zemaitija_migrator',recoverySearchPath:'pg_catalog, public',recoveryGuardsValid:true,
      inventoryExclusionValid:true,financialConstraintsValid:true,migrationCount:36,migrationDigest:m.migrationDigest});
    const stripe=await attestation('stripe',{...m.stripe,livemode:false});
    const finalNow=checkReservation();
    for(const window of attestationWindows)if(!currentWindow(window.start,window.end,finalNow))reject(window.code);
    stage='MANIFEST_INTEGRITY_FAILURE';
    const {allowedOperations,notBefore,expiresAt,...authority}=a;void [allowedOperations,notBefore,expiresAt];
    // Actual reader snapshots, never synthesized substitutes, enter the old validator.
    sealAcceptanceRun(record.text,{now:new Date(finalNow).toISOString(),authority,history:inventory.history,
      docker, database:postgres, stripe} as AcceptanceRunEvidence,source,migrations);
    return result('PENDING_EXTERNAL_ATTESTATION','LIVE_REVALIDATION_REQUIRED');
  } catch(error) {
    return result(error instanceof Rejection && error.pending?'PENDING_EXTERNAL_ATTESTATION':'REJECTED',
      error instanceof Rejection?error.code:stage);
  }
}
