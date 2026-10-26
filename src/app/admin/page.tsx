import { redirect } from 'next/navigation';
import { workspaceSession } from '../workspace/session';
import { Notice } from '../workspace/ui';
export default async function Admin({searchParams}:{searchParams:Promise<{notice?:string}>}){
  await workspaceSession('admin');const p=await searchParams;
  if(!p.notice)redirect('/admin/bookings');
  return <><h1>Operator workspace</h1><Notice code={p.notice}/><p>Choose a workflow in the navigation to inspect its current state before retrying.</p></>;
}
