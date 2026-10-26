'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePresentation, LanguageSwitcher } from '@/i18n/client';
import type { MessageKey } from '@/i18n/catalog';
export function Status({value}:{value:string}) {const {statusLabel}=usePresentation();return <span className={`status status-${value.toLowerCase()}`}>{statusLabel(value)}</span>;}
export function Shell({children,admin=false}:{children:ReactNode;admin?:boolean}) {
  const {t,href}=usePresentation();
  return <div className="workspace"><a className="skip" href="#workspace-main">{t('Skip to content')}</a><header className="workspace-header"><Link href={href(admin?'/admin':'/manage')}>Žemaitija Country Escapes</Link><span>{t(admin?'Operator workspace':'Your reservation')}</span></header>
    <div className="demo-note">{t('Fictional portfolio demonstration · Synthetic bookings · Stripe test mode')}</div>
    <LanguageSwitcher/>
    {admin&&<nav className="workspace-nav" aria-label={t('Administration')}><Link href={href('/admin/bookings')}>{t('Bookings')}</Link><Link href={href('/admin/calendar')}>{t('Accommodation calendar')}</Link><Link href={href('/admin/incidents')}>{t('Operational review')}</Link><Link href={href('/admin/identities')}>{t('Identities')}</Link></nav>}
    <main id="workspace-main" className="workspace-main">{children}</main>
    <footer className="workspace-footer">{t('Dates and deadlines use Europe/Vilnius. No real accommodation or live bookings are available.')}</footer></div>;
}
const notices:Record<string,MessageKey>={
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
export function Notice({code}:{code?:string}) {const {t}=usePresentation();return code&&notices[code]?<p className="notice" role="status">{t(notices[code])}</p>:null;}
export function Confirm({children}:{children:ReactNode}) {return <label className="confirmation"><input type="checkbox" name="confirmed" value="yes" required/><span>{children}</span></label>;}
export function ActionFields({token}:{token:string}) {return <input type="hidden" name="actionToken" value={token}/>;}
