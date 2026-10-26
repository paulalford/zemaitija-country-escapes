import Link from 'next/link';
import type { ReactNode } from 'react';
export const unitName=(key:string)=>({'forest-cottage':'Forest Cottage','lakeside-cabin':'Lakeside Cabin','family-cottage':'Family Cottage'}[key]??key);
export const money=(cents:string|bigint)=>{
  const n=BigInt(cents);return `${n<0n?'-':''}€${(n<0n?-n:n)/100n}.${((n<0n?-n:n)%100n).toString().padStart(2,'0')}`;
};
export const day=(date:string)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Vilnius'}).format(new Date(`${date}T12:00:00Z`));
export const instant=(date:Date)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Vilnius',timeZoneName:'short'}).format(date);
export const statusLabel=(status:string)=>status.toLowerCase().replaceAll('_',' ').replace(/^\w/,c=>c.toUpperCase());
export function Status({value}:{value:string}) {return <span className={`status status-${value.toLowerCase()}`}>{statusLabel(value)}</span>;}
export function Shell({children,admin=false}:{children:ReactNode;admin?:boolean}) {
  return <div className="workspace"><a className="skip" href="#workspace-main">Skip to content</a><header className="workspace-header"><Link href={admin?'/admin':'/manage'}>Žemaitija Country Escapes</Link><span>{admin?'Operator workspace':'Your reservation'}</span></header>
    <div className="demo-note">Fictional portfolio demonstration · Synthetic bookings · Stripe test mode</div>
    {admin&&<nav className="workspace-nav" aria-label="Administration"><Link href="/admin/bookings">Bookings</Link><Link href="/admin/calendar">Accommodation calendar</Link><Link href="/admin/incidents">Operational review</Link><Link href="/admin/identities">Identities</Link></nav>}
    <main id="workspace-main" className="workspace-main">{children}</main>
    <footer className="workspace-footer">Dates and deadlines use Europe/Vilnius. No real accommodation or live bookings are available.</footer></div>;
}
const notices:Record<string,string>={
  'link-queued':'A fresh access link has been queued for sandbox delivery. Your current session remains available until it expires.',
  'payment-return':'Payment is verified separately. Returning from Checkout does not confirm payment. Refresh to see the latest recorded status.',
  'payment-pending':'Your payment session is being prepared or reconciled. Refresh before trying again.',
  'balance-unavailable':'No balance payment is currently available. Review the recorded payment schedule below.',
  'cancellation-pending':'Cancellation could not yet be completed because payment status needs reconciliation. Your reservation has not been released by this request. Review its status before trying again.',
  'cancellation-reviewed':'The cancellation request has been reviewed. Check the current booking and refund status below.',
  'block-saved':'The inventory block has been saved. The calendar below reflects committed inventory.',
  'block-released':'The operator block has been released. Dates may be claimed by another booking after release.',
  'assessment-saved':'The immutable cancellation assessment revision has been recorded.',
  'refund-queued':'The refund request has been queued. It is complete only after provider verification.',
  'guest-access-revoked':'All currently issued guest access links and their sessions for this reservation have been revoked.',
  'identity-saved':'The identity change has been recorded and affected sessions revoked.',
  'conflict':'The dates or operation key are already in use. Review current availability before submitting a new operation.',
  'access-denied':'Access is unavailable. Sign in again or request a fresh link through the sandbox operator workflow.',
  'invalid-input':'The request was not accepted. Review every field and confirm the action before submitting.',
  'retry':'The operation could not be completed. Refresh to inspect its current state before retrying.',
};
export function Notice({code}:{code?:string}) {return code&&notices[code]?<p className="notice" role="status">{notices[code]}</p>:null;}
export function Confirm({children}:{children:ReactNode}) {return <label className="confirmation"><input type="checkbox" name="confirmed" value="yes" required/><span>{children}</span></label>;}
export function ActionFields({token}:{token:string}) {return <input type="hidden" name="actionToken" value={token}/>;}
