'use client';
import { usePresentation } from '@/i18n/client';
import { instant } from '@/i18n/format';
import { policyContent } from '@/i18n/policy';
import type { PublicQuote } from '@/server/public-booking';

export function BookingTime({value}:{value:string}) {
  const {locale}=usePresentation();
  return <time dateTime={value}>{instant(new Date(value),locale,'guest')}</time>;
}
export function QuoteValidity({quote}:{quote:PublicQuote}) {
  const {t}=usePresentation();
  return <div className="quote-validity">
    <dl>
      <div><dt>{t('Availability checked')}</dt><dd><BookingTime value={quote.evaluatedAt}/></dd></div>
      <div><dt>{t('Quote valid until')}</dt><dd><BookingTime value={quote.expiresAt}/></dd></div>
    </dl>
    <p>{t('All times are Lithuania time.')}</p>
    <p>{t('Dates are not reserved until your booking is accepted.')}</p>
  </div>;
}
export function PaymentSummary({quote}:{quote:PublicQuote}) {
  const {t,money}=usePresentation();
  return <section className="quote-section payment-summary" aria-labelledby="payment-heading">
    <h2 id="payment-heading">{t('Payment summary')}</h2>
    <dl className="quote-facts">
      <div className="initial-payment"><dt>{t(quote.basis==='FULL'?'Full test payment':'Initial test payment')}</dt><dd>{money(quote.initialCents)}</dd></div>
      <div><dt>{t('Total price')}</dt><dd>{money(quote.totalCents)}</dd></div>
      <div><dt>{t('Balance')}</dt><dd>{money(quote.balanceCents)}</dd></div>
      <div><dt>{t('Balance deadline')}</dt><dd><BookingTime value={quote.balanceDue}/></dd></div>
    </dl>
    <p className="booking-notice">{t('Provisional accommodation-only tariff. Fees, taxes and extras are not configured. No real payment is due.')}</p>
  </section>;
}
export function CancellationTerms({quote}:{quote:PublicQuote}) {
  const {t,locale}=usePresentation();
  const cutoff=instant(new Date(quote.balanceDue),locale,'guest');
  // Split the unchanged policy before inserting dates, which can contain abbreviation periods.
  const sentences=policyContent(locale,'cancellation','{cutoff}').split(/(?<=\.)\s+/u);
  return <section className="quote-section cancellation-terms" aria-labelledby="cancellation-heading">
    <h2 id="cancellation-heading">{t('Cancellation')}</h2>
    <ul>{sentences.map((sentence,i)=><li key={i}>{sentence.replace('{cutoff}',cutoff)}</li>)}</ul>
  </section>;
}
export function NightlyRates({quote}:{quote:PublicQuote}) {
  const {t,day,money}=usePresentation();
  return <section className="quote-section nightly-rates"><h2>{t('Nightly rates')}</h2>
    <dl>{quote.lines.map(line=><div key={line.night}>
      <dt><time dateTime={line.night}>{day(line.night)}</time></dt><dd>{money(line.cents)}</dd>
    </div>)}</dl>
  </section>;
}
