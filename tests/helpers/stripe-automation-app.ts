import { observePoolShutdown, type ShutdownObservation } from '../../src/server/automation-settlement';
/** Application-only process boundary: no migration environment, factory or callback. */
import type { Pool } from 'pg';
import { attestIsolatedTarget, type DockerEvidenceReader } from '../../src/server/stripe-automation-target';
import { verifyAutomationRecoveryCapabilities } from '../../src/server/stripe-automation-config';
import { isolatedConnectionOptions, verifiedSession, type ExplicitEnvironment, type PoolFactory, type SqlSession } from '../../scripts/lib/stripe-automation-connection';
import { requireTestPermit, testFixtures, type TestPermit } from '../../scripts/lib/stripe-automation-test-contract';
import { fakeIntegrationStripe } from './stripe-automation-postgres';

export async function applicationTestContext(env:ExplicitEnvironment,permit:TestPermit|undefined,
  deps:{docker:DockerEvidenceReader;pool:PoolFactory;observeShutdown?:(state:ShutdownObservation)=>void}) {
  const approval=requireTestPermit(permit,'app-tests');
  const target=await attestIsolatedTarget(deps.docker);
  const options=isolatedConnectionOptions(env,'zemaitija_app',target,4);
  const raw=deps.pool(options),active=new Set<SqlSession>();let closed=false;
  const connect=async()=>{
    if(closed)throw Error('INTEGRATION_CLOSED');
    const s=await verifiedSession(raw,'zemaitija_app',target,deps.docker);
    if(closed){s.release(true);throw Error('INTEGRATION_CLOSED');}
    const wrapped={query:s.query.bind(s),release:(destroy=false)=>{if(active.delete(wrapped))s.release(destroy);}};
    active.add(wrapped);return wrapped;
  };
  const query=async(sql:string,values?:unknown[])=>{const s=await connect();try{return await s.query(sql,values);}finally{s.release();}};
  const close=async()=>{closed=true;for(const s of active)s.release(true);await observePoolShutdown(()=>raw.end(),deps.observeShutdown);};
  const fixtures=testFixtures(approval.runId);
  try {
    const lock=await connect();
    if((await lock.query('SELECT pg_try_advisory_lock(1937001,361) acquired')).rows[0]?.acquired!==true)throw Error('FIXTURE_RUN_BUSY');
    // Hold the session lock through pool disposal; do not share it with test queries.
    const s=await connect();
    try {await s.query('BEGIN READ ONLY');
      await verifyAutomationRecoveryCapabilities({query:async sql=>({rows:(await s.query(sql)).rows.map(r=>({safe:r.safe===true}))})});
      const {rows}=await s.query(`SELECT u.unit_key,g.retention_state,convert_from(g.email_ciphertext,'UTF8') marker
        FROM accommodation_units u CROSS JOIN guests g WHERE u.id=$1 AND g.id=$2`,[fixtures.unit,fixtures.guest]);
      if(rows.length!==1 || rows[0].unit_key!==fixtures.key || rows[0].marker!==fixtures.key || rows[0].retention_state!=='SYNTHETIC')
        throw Error('TEST_OWNERSHIP_REQUIRED');
      // Queue-wide domain services are allowed only if every existing booking belongs
      // to this run. This reads only the already authenticated isolated database.
      if((await s.query('SELECT count(*)::int n FROM bookings WHERE guest_id<>$1 OR unit_id<>$2',[fixtures.guest,fixtures.unit])).rows[0]?.n!==0)
        throw Error('UNRELATED_ISOLATED_BOOKINGS_PRESENT');
      if((await s.query('SELECT count(*)::int n FROM stripe_webhook_events')).rows[0]?.n!==0)throw Error('UNRELATED_ISOLATED_EVENTS_PRESENT');
      await s.query('ROLLBACK');
    } finally {s.release(true);}
  } catch {await close();throw Error('APPLICATION_TEST_PREFLIGHT_REJECTED');}
  // Only these checked application sessions are exposed, never an owner connection.
  return {fixtures,stripe:fakeIntegrationStripe(),connect,query,close,
    pool:{connect,query} as unknown as Pool};
}
export type ApplicationTestContext=Awaited<ReturnType<typeof applicationTestContext>>;
