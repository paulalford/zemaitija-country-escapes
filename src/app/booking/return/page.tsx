import { cookies } from 'next/headers';
import { pool } from '@/db/client';
import { getPresentation } from '@/i18n/server';
import { bookingCookie } from '@/server/public-booking-http';
import { openReceipt } from '@/server/public-booking-token';
import { publicBookingStatus } from '@/server/public-booking';
import { PublicShell } from '../../public-ui/shell';
import { ResumeCheckout } from '../stay-form';
export default async function PaymentReturn() {
  const {t,href,unitName,statusLabel,money,day}=await getPresentation();
  let status=null;
  try {const jar=await cookies(),receipt=openReceipt(jar.get(bookingCookie('receipt'))?.value??'',jar.get(bookingCookie('browser'))?.value??'');status=await publicBookingStatus(pool,receipt);}catch{ /* Uniform denial; no query-string identity grants access. */ }
  return <PublicShell><main id="content" className="booking-main"><h1>{t('Test payment status')}</h1><p>{t('Returning from Checkout never confirms payment. This page reads the recorded booking state only.')}</p>{status?<><h2>{unitName(status.unit_key)}</h2><p>{day(status.arrival_date)} – {day(status.departure_date)}</p><p className="booking-notice">{statusLabel(status.status)}</p><dl className="quote-facts"><dt>{t('Accepted total')}</dt><dd>{money(status.total_cents)}</dd></dl><a className="button secondary" href={href('/booking/return')}>{t('Refresh recorded status')}</a>{status.status==='AWAITING_INITIAL_PAYMENT'&&<ResumeCheckout/>}<p>{t('Manage-booking access is delivered through the existing sandbox notification workflow.')}</p></>:<p>{t('No current booking receipt is available in this browser. Use your secure sandbox manage-booking link.')}</p>}<a className="text-link" href={href('/manage/access')}>{t('Manage booking')}</a></main></PublicShell>;
}
