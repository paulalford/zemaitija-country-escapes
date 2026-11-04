import { commitAcknowledgement } from './lib/stripe-automation-transactions';
import { observePoolShutdown } from '../src/server/automation-settlement';
/** Privileged host entry. Never imported by the application acceptance process. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attestIsolatedTarget } from '../src/server/stripe-automation-target';
import { hostDockerReader } from './lib/stripe-automation-docker';
import { isolatedConnectionOptions, verifiedSession, type ExplicitEnvironment, type PoolFactory, type SqlSession } from './lib/stripe-automation-connection';
import { reviewedMigrationPlan, readMigrationLedger } from './stripe-automation-migrate';
import { requireTestPermit, testPermit, testFixtures, type TestPermit } from './lib/stripe-automation-test-contract';

async function owned(session:SqlSession,f:ReturnType<typeof testFixtures>) {
  const {rows}=await session.query(`SELECT u.unit_key,g.retention_state,convert_from(g.email_ciphertext,'UTF8') marker,
    s.unit_id,s.state FROM accommodation_units u JOIN rate_schedule_versions s ON s.unit_id=u.id
    CROSS JOIN guests g WHERE u.id=$1 AND s.id=$2 AND g.id=$3`,[f.unit,f.schedule,f.guest]);
  if(rows.length!==1 || rows[0].unit_key!==f.key || rows[0].marker!==f.key ||
    rows[0].retention_state!=='SYNTHETIC' || rows[0].unit_id!==f.unit || rows[0].state!=='ACTIVE')
    throw Error('FIXTURE_OWNERSHIP_REJECTED');
  const history=await session.query(`SELECT a.recovery_enabled,b.guest_id,b.unit_id FROM payment_attempts a
    JOIN bookings b ON b.id=a.booking_id WHERE a.id=$1 AND b.id=$2 AND a.obligation_id=$3`,
    [f.historyAttempt,f.historyBooking,f.historyObligation]);
  if(history.rows.length!==1 || history.rows[0].recovery_enabled!==false ||
    history.rows[0].guest_id!==f.guest || history.rows[0].unit_id!==f.unit)throw Error('FIXTURE_HISTORY_REJECTED');
}
/** Fixed reviewed SQL only. A fresh run is required: no UPSERT, retries or reset. */
export async function fixtureOperation(env:ExplicitEnvironment,permit:TestPermit|undefined,
  deps:{docker:ReturnType<typeof hostDockerReader>;pool:PoolFactory;plan?:typeof reviewedMigrationPlan}) {
  if(permit?.operation!=='fixture-setup' && permit?.operation!=='fixture-retain')throw Error('LIVE_TEST_GATE_CLOSED');
  const approval=requireTestPermit(permit,permit.operation),f=testFixtures(approval.runId);
  const target=await attestIsolatedTarget(deps.docker);
  const options=isolatedConnectionOptions(env,'zemaitija_migrator',target);
  const plan=await (deps.plan??reviewedMigrationPlan)();
  const pool=deps.pool(options);
  try {
    const s=await verifiedSession(pool,'zemaitija_migrator',target,deps.docker);
    let commitStarted=false;
    try {
      if((await s.query('SELECT pg_try_advisory_lock(1937001,361) acquired')).rows[0]?.acquired!==true)throw Error('FIXTURE_RUN_BUSY');
      if(await readMigrationLedger(s,plan)!==36)throw Error('COMPLETE_MIGRATION_CHAIN_REQUIRED');
      await s.query('BEGIN');
      if(approval.operation==='fixture-setup') {
        if((await s.query('SELECT ((SELECT count(*) FROM bookings)+(SELECT count(*) FROM stripe_webhook_events))::int n')).rows[0]?.n!==0)
          throw Error('EMPTY_ISOLATED_TEST_DATA_REQUIRED');
        await s.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES($1,$2,2,true,1)',[f.unit,f.key]);
        await s.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES($1,convert_to($2,'UTF8'),'en','SYNTHETIC')",[f.guest,f.key]);
        await s.query("INSERT INTO rate_schedule_versions(id,unit_id,version_no,state) VALUES($1,$2,1,'DRAFT')",[f.schedule,f.unit]);
        for(const [id,day] of [[f.weekday,'WEEKDAY'],[f.weekend,'WEEKEND']])
          await s.query("INSERT INTO seasonal_rates(id,rate_schedule_version_id,start_date,end_date,day_class,nightly_cents,currency) VALUES($1,$2,'2035-01-01','2036-01-01',$3,10000,'EUR')",[id,f.schedule,day]);
        await s.query("UPDATE rate_schedule_versions SET state='ACTIVE',activated_at=clock_timestamp() WHERE id=$1",[f.schedule]);
        // Snapshot-free synthetic legacy shape. Does not pretend to be pre-migration evidence.
        await s.query(`INSERT INTO bookings(id,guest_id,unit_id,arrival_date,departure_date,guest_count,status,version,accepted_at,
          check_in_local_time,property_zone,scheduled_arrival_at,warning_at,balance_due_at,grace_ends_at)
          VALUES($1,$2,$3,'2035-12-01','2035-12-02',1,'AWAITING_INITIAL_PAYMENT',1,'2034-01-01',
          '15:00','Europe/Vilnius','2035-12-01 13:00Z','2035-11-10 13:00Z','2035-11-17 13:00Z','2035-11-18 13:00Z')`,[f.historyBooking,f.guest,f.unit]);
        await s.query("INSERT INTO payment_obligations(id,booking_id,kind,amount_cents,due_at,currency) VALUES($1,$2,'INITIAL',10000,'2034-01-01','EUR')",[f.historyObligation,f.historyBooking]);
        await s.query("INSERT INTO payment_attempts(id,booking_id,obligation_id,state,expected_cents,currency,version) VALUES($1,$2,$3,'CREATING',10000,'EUR',1)",[f.historyAttempt,f.historyBooking,f.historyObligation]);
      }
      await owned(s,f);
      // Cleanup deliberately retains immutable evidence and occupied test inventory.
      // No callbacks, arbitrary IDs, financial writes, deletes or automatic cleanup.
      commitStarted=true;if(await commitAcknowledgement(s)==='UNCERTAIN')throw Error('COMMIT_UNCERTAIN');
      return {runId:f.runId,state:approval.operation==='fixture-setup'?'FIXTURES_PREPARED':'EVIDENCE_RETAINED'};
    } catch {
      if(!commitStarted)await s.query('ROLLBACK').catch(()=>{});
      throw Error(commitStarted?'FIXTURE_COMMIT_UNCERTAIN_PRESERVE':'FIXTURE_REJECTED_PRESERVE');
    } finally {s.release(true);}
  } finally {await observePoolShutdown(()=>pool.end(),state=>{if(state==='PENDING_EXTERNAL_SUPERVISION')process.stderr.write('CLEANUP_PENDING_EXTERNAL_SUPERVISION\n');});}
}
export async function fixtureMain(args:string[],env:ExplicitEnvironment) {
  const operation=args[0]==='--acknowledge-stage-2b-3c-1-fixture-setup'?'fixture-setup':'fixture-retain';
  const permit=testPermit(args,operation);
  return fixtureOperation(env,permit,{docker:hostDockerReader(),pool:options=>{
    // No pg import or credential fallback before the explicit entry and validation.
    const pool=import('pg').then(({Pool})=>new Pool(options));
    return {connect:async()=>(await pool).connect(),end:async()=>{await (await pool).end();}};
  }});
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  fixtureMain(process.argv.slice(2),process.env).then(r=>{process.stdout.write(JSON.stringify(r)+'\n');})
    .catch(()=>{process.stderr.write('FIXTURE_REJECTED_PRESERVE\n');process.exitCode=1;});
