/** Independent application process. No migration library or privileged fixture import. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { testPermit } from './lib/stripe-automation-test-contract';
import type { ExplicitEnvironment } from './lib/stripe-automation-connection';
import { hostDockerReader } from './lib/stripe-automation-docker';
import { applicationTestContext } from '../tests/helpers/stripe-automation-app';
import { runPostgresAcceptance } from '../tests/stripe-automation-postgres.scenarios';

export async function acceptanceMain(args:string[],env:ExplicitEnvironment) {
  const permit=testPermit(args,'app-tests');
  const h=await applicationTestContext(env,permit,{observeShutdown:state=>{if(state==='PENDING_EXTERNAL_SUPERVISION')process.stderr.write('CLEANUP_PENDING_EXTERNAL_SUPERVISION\n');},docker:hostDockerReader(),pool:options=>{
    const pool=import('pg').then(({Pool})=>new Pool(options));
    return {connect:async()=>(await pool).connect(),end:async()=>{await (await pool).end();}};
  }});
  try {return await runPostgresAcceptance(h);}finally {await h.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  acceptanceMain(process.argv.slice(2),process.env).then(r=>{process.stdout.write(JSON.stringify(r)+'\n');})
    .catch(()=>{process.stderr.write('ACCEPTANCE_FAILED_OR_UNCERTAIN_PRESERVE\n');process.exitCode=1;});
