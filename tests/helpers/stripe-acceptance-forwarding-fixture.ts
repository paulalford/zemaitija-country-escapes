import { readFileSync } from 'node:fs';
import pinned from '../../scripts/stripe-automation-migration-manifest.json';
import { artifactDigest, canonicalRunJson, freshAcceptanceNames, runManifestDigest, sealAcceptanceRun } from '../../src/server/stripe-acceptance-run';

/** Source bytes only; no database fixtures or operational dependencies. */
export function forwardingRun() {
  const runId='10000000-0000-4000-8000-000000000001',source=[{path:'src/server/synthetic.ts',bytes:Buffer.from('synthetic source\n')}];
  const migrations=['scripts/stripe-automation-migration-manifest.json','drizzle/meta/_journal.json',
    ...pinned.entries.map(e=>`drizzle/${e.tag}.sql`)].sort().map(path=>({path,bytes:readFileSync(path)}));
  const target={...freshAcceptanceNames(runId),containerId:'a'.repeat(64),networkId:'b'.repeat(64),
    volumeIdentity:'20000000-0000-4000-8000-000000000001',image:'postgres:17.6',imageId:`sha256:${'c'.repeat(64)}`,address:'172.28.0.2',port:5432};
  const stripe={mode:'test',accountId:'acct_synthetic',webhookEndpointId:'we_synthetic',apiVersion:'2026-08-26.dahlia'};
  const m={version:1,profileId:'stage-2c-fresh-pg17-v1',runId,approvalReference:'review:stage-2c:synthetic-review-0001',target,
    sourceDigest:artifactDigest('source',source),migrationDigest:artifactDigest('migrations',migrations),stripe,
    operations:['ingest-payment-webhook'],issuedAt:'2035-01-01T00:00:00.000Z',notBefore:'2035-01-01T00:00:00.000Z',expiresAt:'2035-01-01T00:30:00.000Z',
    fixtures:{namespace:`stage2c:${runId}`,guestId:'30000000-0000-4000-8000-000000000001',unitId:'40000000-0000-4000-8000-000000000001',
      bookingOperationId:'50000000-0000-4000-8000-000000000001'},budgets:{invocations:10,items:50,providerRequests:600,providerPerInvocation:60,
      lanes:{PAYMENT_WEBHOOKS:2,CHECKOUT_COMMAND_RECOVERY:1,INITIAL_RECONCILIATION:1,BALANCE_RECONCILIATION:1,DEFERRED_INVESTIGATION:0}}};
  const text=canonicalRunJson(m),digest=runManifestDigest(text);
  return sealAcceptanceRun(text,{now:'2035-01-01T00:01:00.000Z',authority:{issuer:'protected-host-review-v1',runId,
    approvalReference:m.approvalReference,manifestDigest:digest,sourceDigest:m.sourceDigest,migrationDigest:m.migrationDigest,sourcePaths:source.map(f=>f.path)},
    history:{complete:true,runIds:[],resourceIdentities:[]},docker:{...target,running:true,privileged:false,addedCapabilities:0,internal:true,
      driver:'bridge',soleNetwork:true,soleContainer:true,dedicatedVolume:true,unexpectedMounts:false,publishedPorts:0,independentCredentials:true},
    database:{database_name:target.database,role_name:target.role,session_role:target.role,database_owner:target.owner,
      server_address:target.address,server_port:5432,server_version:170006,in_recovery:false,superuser:false,create_database:false,create_role:false,
      replication:false,bypass_rls:false,has_memberships:false,database_create:false,schema_create:false,recoveryMetadataUpdate:false,
      publicRecoveryExecute:false,recoveryDefinerOwner:'zemaitija_migrator',recoverySearchPath:'pg_catalog, public',recoveryGuardsValid:true,
      inventoryExclusionValid:true,financialConstraintsValid:true,migrationCount:36,migrationDigest:m.migrationDigest},stripe:{...stripe,livemode:false}},source,migrations);
}
