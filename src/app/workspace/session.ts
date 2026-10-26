import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { pool } from '@/db/client';
import { cookieName } from '@/server/access-http';
import { AccessDenied, requireSession } from '@/server/access';
export async function workspaceSession(kind:'guest'|'admin') {
  if(!process.env.ACCESS_SECRET||!process.env.APP_ORIGIN)redirect(kind==='guest'?'/manage/access':'/admin/signin');
  const raw=(await cookies()).get(cookieName(kind))?.value??'';
  try {return {raw,session:await requireSession(pool,raw,kind)};}
  catch(e){if(e instanceof AccessDenied)redirect(kind==='guest'?'/manage/access':'/admin/signin');throw e;}
}
