/** Explicit local operator provisioning. No HTTP path or password/session bypass.
 * Requires migration credentials and an independently verified OIDC subject. */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { z } from 'zod';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const database=new URL(z.url().parse(process.env.MIGRATION_DATABASE_URL));
if(!['localhost','127.0.0.1'].includes(database.hostname)||!database.pathname.endsWith('_dev'))throw new Error('Local development database required');
const [subject,role,...unitIds]=process.argv.slice(2);
const issuer=z.url().startsWith('https://').parse(process.env.ADMIN_OIDC_ISSUER);
z.string().min(1).max(300).parse(subject);z.enum(['operations','finance','administrator']).parse(role);
unitIds.forEach(id=>z.uuid().parse(id));
const pool=new Pool({connectionString:database.toString(),max:1}),client=await pool.connect();
try{
  await client.query('BEGIN');const id=randomUUID();
  await client.query('INSERT INTO admin_users(id,external_subject,role,enabled) VALUES($1,$2,$3,true)',[id,`${issuer}|${subject}`,role]);
  for(const unit of [...new Set(unitIds)])await client.query('INSERT INTO admin_unit_access(id,admin_user_id,unit_id) VALUES($1,$2,$3)',[randomUUID(),id,unit]);
  await client.query(`INSERT INTO audit_events(id,actor_kind,service_name,action,entity_type,entity_id,reason_code,occurred_at)
    VALUES($1,'SERVICE','explicit-local-provisioning','admin.identity_provisioned','admin_user',$2,'INDEPENDENT_SUBJECT_REVIEW',clock_timestamp())`,[randomUUID(),id]);
  await client.query('COMMIT');console.log(`Provisioned administrator identity ${id}; OIDC MFA is still required to sign in.`);
}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
