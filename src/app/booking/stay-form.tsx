'use client';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { usePresentation } from '@/i18n/client';
import type { PublicUnit } from '@/server/public-catalog';
import type { PublicQuote } from '@/server/public-booking';
import type { MessageKey } from '@/i18n/catalog';
import { policyContent } from '@/i18n/policy';
import { Arrow } from '../public-ui/arrow';
import { instant } from '@/i18n/format';
import { QuoteValidity, PaymentSummary, CancellationTerms, NightlyRates } from './quote-presentation';
const errors:Record<string,MessageKey>={INVALID_INPUT:'Please review valid arrival, departure and guest details.',UNAVAILABLE:'These dates or guest numbers are unavailable. Change your stay and check again.',NO_PRICE:'No configured price covers this stay. Try other dates; demo tariffs currently cover 2027.',EXPIRED_QUOTE:'The quote expired or changed. Check availability again and review the new payment terms.',PAYMENT_UNAVAILABLE:'Test payment is unavailable. No new acceptance was requested. Try again later.',RATE_LIMITED:'Please wait before trying again.',RETRY:'The request could not finish. Retry the same action to inspect or resume it; do not start another booking.'};
export async function bookingPost(action:string,input:unknown) {
  const response=await fetch(`/api/booking/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.code??'RETRY');
  return result;
}
export function BookingFlow({units,initial}:{units:PublicUnit[];initial:{unit:string;arrival:string;departure:string;guests:string}}) {
  const {t,locale,href,unitName,day,money}=usePresentation();
  const [quote,setQuote]=useState<PublicQuote|null>(null),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const form=useRef<HTMLFormElement>(null),heading=useRef<HTMLHeadingElement>(null),locked=useRef(false);
  async function check(values:FormData) {
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setQuote(null);setReview(false);
    try { const result=await bookingPost('quote',{locale,stay:{unitId:values.get('unit'),arrivalDate:values.get('arrival'),departureDate:values.get('departure'),guestCount:Number(values.get('guests'))}});setQuote(result);requestAnimationFrame(()=>heading.current?.focus()); }
    catch(e){setError(e instanceof Error?e.message:'RETRY');}
    finally {setBusy(false);locked.current=false;}
  }
  useEffect(()=>{
    // Search from a discovery page is advisory only. Deferring avoids duplicate requests in development Strict Mode.
    if(!initial.unit||!initial.arrival||!initial.departure)return;
    const timer=setTimeout(()=>{if(form.current)void check(new FormData(form.current));},0);
    return ()=>clearTimeout(timer);
    // Locale changes navigate and remount this page. Initial search context is immutable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function accept(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!quote||locked.current)return;
    locked.current=true;setBusy(true);setError('');
    try {const result=await bookingPost('accept',{ticket:quote.ticket,acceptedTerms:true,acknowledgedPayment:true,syntheticOnly:true});window.location.assign(result.destination);}
    catch(e){setError(e instanceof Error?e.message:'RETRY');setBusy(false);locked.current=false;}
  }
  const back=<a className="text-link" href={href('/accommodations')}>{t('All stays')}</a>;
  return <>{back}<h1 ref={heading} tabIndex={-1}>{t(quote?review?'Review demo booking':'Your server quote':'Your demo stay')}</h1><div role="status" aria-live="polite">{busy&&<p>{t('Checking…')}</p>}</div>{error&&<p role="alert" className="booking-error">{t(errors[error]??errors.RETRY)}</p>}
    {!units.length&&<p>{t('Catalog unavailable. Please try again later.')}</p>}
    <div hidden={!!quote}><form ref={form} className="booking-fields" onSubmit={e=>{e.preventDefault();void check(new FormData(e.currentTarget));}}><label>{t('Accommodation')}<select name="unit" required defaultValue={units.some(u=>u.id===initial.unit)?initial.unit:''}><option value="" disabled>{t('Choose accommodation')}</option>{units.map(u=><option key={u.id} value={u.id}>{unitName(u.unit_key)} · {t('Up to {capacity} guests',{capacity:u.capacity})}</option>)}</select></label><div className="date-fields"><label>{t('Arrival')}<input type="date" required name="arrival" defaultValue={initial.arrival}/></label><label>{t('Departure')}<input type="date" required name="departure" defaultValue={initial.departure}/></label></div><label>{t('Guests')}<input type="number" min="1" max={units.length?Math.max(...units.map(u=>u.capacity)):undefined} required name="guests" defaultValue={initial.guests}/></label><button disabled={busy||!units.length}>{t('Check availability')}<Arrow/></button></form><p>{t('Availability is advisory. Dates are reserved only after server acceptance.')}</p><p>{t('Departure date is not an occupied night')}</p></div>
    {quote&&<>
      <div className="quote-stay">
        <h2>{unitName(quote.unitKey)}</h2>
        <p>{day(quote.arrivalDate)} – {day(quote.departureDate)}</p>
        <p>{t('{nights} nights · {guests} guests',{nights:quote.nights,guests:quote.guestCount})}</p>
      </div>
      <QuoteValidity quote={quote}/>
      <PaymentSummary quote={quote}/>
      {quote.basis==='ADVANCE'&&<p>{t('If Checkout remains open past the balance deadline, the balance becomes due immediately after verified initial payment.')}</p>}
      {review?<form className="booking-review" onSubmit={accept}>
        <h2>{t('Your details (synthetic)')}</h2>
        <p>{t('Synthetic guest: guest@example.test. Do not enter personal information.')}</p>
        <CancellationTerms quote={quote}/>
        <QuoteDetails quote={quote}/>
        <label className="check-label"><input type="checkbox" required/><span>{t('I accept the displayed synthetic demo terms (SYNTHETIC_TEST_TERMS_V1).')}</span></label>
        <label className="check-label"><input type="checkbox" required/><span>{t('I acknowledge an initial Stripe test payment of {amount}.',{amount:money(quote.initialCents)})}</span></label>
        <p className="booking-notice">{t('No booking accepted or payment confirmed. Continuing requests server acceptance before test Checkout.')}</p>
        <button disabled={busy}>{t('Continue to test payment')}<Arrow/></button>
      </form>:<>
        <NightlyRates quote={quote}/>
        <CancellationTerms quote={quote}/>
        <QuoteDetails quote={quote} includeRates={false}/>
        <button onClick={()=>{setReview(true);requestAnimationFrame(()=>heading.current?.focus());}}>{t('Review demo booking')}<Arrow/></button>
      </>}
      <button className="secondary change-dates" disabled={busy} onClick={()=>{setQuote(null);setReview(false);setError('');requestAnimationFrame(()=>heading.current?.focus());}}>{t('Change dates')}</button>
      <p>{t('Payment is recorded only after provider verification. A return from Checkout does not confirm payment.')}</p>
    </>}
  </>;
}
function QuoteDetails({quote,includeRates=true}:{quote:PublicQuote;includeRates?:boolean}) {
  const {t,locale}=usePresentation();
  return <details className="demo-terms"><summary>{t('Demo terms: payment, cancellation and refunds')}</summary>
    {includeRates&&<NightlyRates quote={quote}/>}
    <p>{policyContent(locale,'payment')}</p><p>{policyContent(locale,'cancellation',instant(new Date(quote.balanceDue),locale,'guest'))}</p>
    <p>{policyContent(locale,'refund')}</p><p>{policyContent(locale,'review')}</p>
  </details>;
}
export function ResumeCheckout() {
  const {t,locale}=usePresentation(),[busy,setBusy]=useState(false),[error,setError]=useState('');const locked=useRef(false);
  return <><button disabled={busy} onClick={async()=>{if(locked.current)return;locked.current=true;setBusy(true);setError('');try{const result=await bookingPost('resume',{locale});window.location.assign(result.destination);}catch(e){setError(e instanceof Error?e.message:'RETRY');setBusy(false);locked.current=false;}}}>{t(busy?'Checking…':'Resume existing test Checkout')}</button>{error&&<p role="alert" className="booking-error">{t(errors[error]??errors.RETRY)}</p>}</>;
}
