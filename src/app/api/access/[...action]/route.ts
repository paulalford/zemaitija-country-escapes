import { pool } from '@/db/client';
import { accessRequest } from '@/server/access-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{action:string[]}>};
export async function POST(request:Request,context:Context){return accessRequest(pool,request,(await context.params).action.join('/'));}
export async function GET(request:Request,context:Context){return accessRequest(pool,request,(await context.params).action.join('/'));}
