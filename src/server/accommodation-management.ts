import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { AccessDenied, recordAccessDenial, deny, ManagementConflict, requireSession, requireUnit, accessAudit, uuid, type Session } from './access';

export const localDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{
  const d=new Date(`${v}T12:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;
},'Use a valid calendar date');
export const blockInput=z.object({unitId:uuid,arrivalDate:localDate,departureDate:localDate,
  reason:z.enum(['PRIVATE_USE','MAINTENANCE','OTHER'])}).strict().refine(v=>v.arrivalDate<v.departureDate,'Departure must be after arrival');
const commandKey=z.string().regex(/^[a-zA-Z0-9:_-]{8,150}$/);
const releaseReason=z.enum(['PLANS_CHANGED','WORK_COMPLETE','CORRECTION','REPLACED']);
export type BlockInput=z.infer<typeof blockInput>;
type Result={blockId:string;replacedBlockId?:string;released?:boolean};
async function locked<T>(pool:Pool,work:(c:PoolClient)=>Promise<T>) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='15s'");
    const r=await work(c);await c.query('COMMIT');return r;
  }catch(e){await c.query('ROLLBACK');if(e instanceof AccessDenied)await recordAccessDenial(c,e);throw e;}
  finally{c.release();}
}
async function replay(c:PoolClient,s:Session,key:string,input:unknown):Promise<{result?:Result;fingerprint:string}> {
  commandKey.parse(key);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`management:${key}`]);
  const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const p=(await c.query<{admin_user_id:string;fingerprint:string;result:Result}>(
    'SELECT admin_user_id,fingerprint,result FROM management_commands WHERE operation_key=$1',[key])).rows[0];
  if(p&&(p.admin_user_id!==s.admin_user_id||p.fingerprint!==fingerprint))throw new ManagementConflict('Operation key already used with different input');
  return {result:p?.result,fingerprint};
}
async function finish(c:PoolClient,s:Session,key:string,fingerprint:string,result:Result) {
  await c.query('INSERT INTO management_commands(operation_key,admin_user_id,fingerprint,result) VALUES($1,$2,$3,$4)',[key,s.admin_user_id,fingerprint,result]);
  return result;
}
async function insertBlock(c:PoolClient,s:Session,input:BlockInput,key:string) {
  const id=randomUUID();
  await c.query(`INSERT INTO operator_blocks(id,unit_id,arrival_date,departure_date,reason_code,created_by_admin_id)
    VALUES($1,$2,$3,$4,$5,$6)`,[id,input.unitId,input.arrivalDate,input.departureDate,input.reason,s.admin_user_id]);
  await c.query(`INSERT INTO inventory_claims(id,unit_id,arrival_date,departure_date,operator_block_id,version)
    VALUES($1,$2,$3,$4,$5,1)`,[randomUUID(),input.unitId,input.arrivalDate,input.departureDate,id]);
  await accessAudit(c,'block.created',s,id,{operationKey:key,unitId:input.unitId,arrivalDate:input.arrivalDate,departureDate:input.departureDate,reason:input.reason});
  return id;
}
function classify(e:unknown):never {
  if(e&&typeof e==='object'&&'code' in e&&e.code==='23P01')throw new ManagementConflict('Dates already unavailable. No existing reservation was changed.');
  throw e;
}
export async function createOperatorBlock(pool:Pool,raw:string,key:string,input:BlockInput) {
  const value=blockInput.parse(input);
  try{return await locked(pool,async c=>{
    await c.query('SELECT lock_management_units($1::uuid[])',[[value.unitId]]);
    const s=await requireSession(c,raw,'admin');await requireUnit(c,s,value.unitId);
    const p=await replay(c,s,key,{kind:'create',...value});if(p.result)return p.result;
    const blockId=await insertBlock(c,s,value,key);return finish(c,s,key,p.fingerprint,{blockId});
  });}catch(e){return classify(e);}
}
async function findBlock(c:PoolClient,id:string) {
  uuid.parse(id);
  const b=(await c.query<{id:string;unit_id:string;released_at:Date|null;arrival_date:string;departure_date:string}>(
    'SELECT id,unit_id,released_at,arrival_date::text,departure_date::text FROM operator_blocks WHERE id=$1',[id])).rows[0];
  if(!b)return deny(c);return b;
}
async function release(c:PoolClient,s:Session,id:string,key:string,reason:string) {
  const b=(await c.query<{released_at:Date|null}>('SELECT released_at FROM operator_blocks WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(b.released_at)return;
  const claim=(await c.query<{id:string}>(`SELECT id FROM inventory_claims WHERE operator_block_id=$1
    AND hold_id IS NULL AND booking_id IS NULL AND released_at IS NULL FOR UPDATE`,[id])).rows[0];
  if(!claim)throw new ManagementConflict('Block ownership could not be verified');
  const at=(await c.query<{now:Date}>('SELECT clock_timestamp() now')).rows[0].now;
  await c.query('UPDATE operator_blocks SET released_at=$2 WHERE id=$1',[id,at]);
  await c.query('UPDATE inventory_claims SET released_at=$2,release_reason=$3,version=version+1 WHERE id=$1',[claim.id,at,reason]);
  await accessAudit(c,'block.released',s,id,{operationKey:key,reason});
}
export async function releaseOperatorBlock(pool:Pool,raw:string,key:string,id:string,reason:string) {
  releaseReason.parse(reason);
  return locked(pool,async c=>{
    // Authenticate before resolving a caller-supplied identifier.
    await requireSession(c,raw,'admin');const b=await findBlock(c,id);
    await c.query('SELECT lock_management_units($1::uuid[])',[[b.unit_id]]);
    const s=await requireSession(c,raw,'admin');await requireUnit(c,s,b.unit_id);
    const p=await replay(c,s,key,{kind:'release',id,reason});if(p.result)return p.result;
    await release(c,s,id,key,reason);return finish(c,s,key,p.fingerprint,{blockId:id,released:true});
  });
}
export async function replaceOperatorBlock(pool:Pool,raw:string,key:string,id:string,input:BlockInput) {
  const v=blockInput.parse(input);
  try{return await locked(pool,async c=>{
    await requireSession(c,raw,'admin');const b=await findBlock(c,id);
    await c.query('SELECT lock_management_units($1::uuid[])',[[b.unit_id,v.unitId].sort()]);
    const s=await requireSession(c,raw,'admin');await requireUnit(c,s,b.unit_id);await requireUnit(c,s,v.unitId);
    const p=await replay(c,s,key,{kind:'replace',id,...v});if(p.result)return p.result;
    if(b.released_at)throw new ManagementConflict('Released block cannot be replaced');
    // Re-read after acquiring the unit lock: a competing release may have committed.
    if((await findBlock(c,id)).released_at)throw new ManagementConflict('Released block cannot be replaced');
    await release(c,s,id,key,'REPLACED');
    const blockId=await insertBlock(c,s,v,key);
    await accessAudit(c,'block.replaced',s,id,{operationKey:key,replacementId:blockId});
    return finish(c,s,key,p.fingerprint,{blockId,replacedBlockId:id});
  });}catch(e){return classify(e);}
}
export async function managementCalendar(pool:Pool,raw:string,start:string,end:string,unitId?:string) {
  localDate.parse(start);localDate.parse(end);if(start>=end||new Date(end).getTime()-new Date(start).getTime()>366*86400000)throw new Error('Choose a range of at most one year');
  const s=await requireSession(pool,raw,'admin');
  if(unitId){uuid.parse(unitId);await requireUnit(pool,s,unitId);}
  else if(!['operations','administrator'].includes(s.role??''))throw new AccessDenied();
  const units=(await pool.query<{id:string;unit_key:string;capacity:number;enabled:boolean;config_version:number}>(`SELECT u.id,u.unit_key,u.capacity,u.enabled,u.config_version
    FROM accommodation_units u WHERE ($1::uuid IS NULL OR u.id=$1) AND
    ($2='administrator' OR EXISTS(SELECT 1 FROM admin_unit_access a WHERE a.admin_user_id=$3 AND a.unit_id=u.id)) ORDER BY u.unit_key`,[unitId??null,s.role,s.admin_user_id])).rows;
  const occupancy=(await pool.query<{id:string;unit_id:string;arrival_date:string;departure_date:string;status:string;block_id:string|null}>(`SELECT c.id,c.unit_id,c.arrival_date::text,c.departure_date::text,c.operator_block_id block_id,
    CASE WHEN c.operator_block_id IS NOT NULL THEN ob.reason_code WHEN c.hold_id IS NOT NULL THEN 'PENDING_HOLD' ELSE 'CONFIRMED_BOOKING' END status
    FROM inventory_claims c LEFT JOIN operator_blocks ob ON ob.id=c.operator_block_id
    WHERE c.unit_id=ANY($1::uuid[]) AND c.released_at IS NULL AND c.arrival_date<$3::date AND c.departure_date>$2::date
    ORDER BY c.arrival_date,c.id`,[units.map(u=>u.id),start,end])).rows;
  await accessAudit(pool,'calendar.viewed',s,undefined,{start,end,unitCount:units.length});
  return {units,occupancy};
}

export async function managementHistory(pool:Pool,raw:string,unitIds:string[]) {
  const s=await requireSession(pool,raw,'admin');
  for(const id of unitIds)await requireUnit(pool,s,id);
  return (await pool.query<{action:string;occurred_at:Date;unit_key:string;arrival_date:string;departure_date:string;admin_user_id:string;reason:string|null}>(`SELECT a.action,a.occurred_at,u.unit_key,b.arrival_date::text,b.departure_date::text,a.admin_user_id,a.details->>'reason' reason
    FROM audit_events a JOIN operator_blocks b ON b.id=a.entity_id JOIN accommodation_units u ON u.id=b.unit_id
    WHERE b.unit_id=ANY($1::uuid[]) AND a.action IN ('block.created','block.released','block.replaced') ORDER BY a.occurred_at DESC LIMIT 50`,[unitIds])).rows;
}
