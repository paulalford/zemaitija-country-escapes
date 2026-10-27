import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocaleProvider } from '../src/i18n/client';
import { instant } from '../src/i18n/format';
import { locales } from '../src/i18n/routing';
import { presentation } from '../src/i18n/messages';
import { policyContent } from '../src/i18n/policy';
import { CancellationTerms, PaymentSummary, QuoteValidity, NightlyRates } from '../src/app/booking/quote-presentation';
import type { PublicQuote } from '../src/server/public-booking';

const quote:PublicQuote={ticket:'synthetic-test-only',unitKey:'forest-cottage',capacity:2,
  arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2,nights:3,
  lines:[{night:'2027-07-02',cents:'19000'},{night:'2027-07-03',cents:'19000'},{night:'2027-07-04',cents:'16000'}],
  totalCents:'54000',initialCents:'16200',balanceCents:'37800',basis:'ADVANCE',
  balanceDue:'2027-06-18T12:00:00.000Z',evaluatedAt:'2026-10-27T12:00:00.000Z',expiresAt:'2026-10-27T12:15:00.000Z'};
const render=(locale:typeof locales[number],element:React.ReactNode)=>renderToStaticMarkup(<LocaleProvider locale={locale}>{element}</LocaleProvider>);

describe('M16-V01/V02 booking presentation',()=>{
  it.each(locales)('retains the exact cancellation policy when grouping sentences in %s',locale=>{
    const html=render(locale,<CancellationTerms quote={quote}/>);
    const sentences=[...html.matchAll(/<li>(.*?)<\/li>/g)].map(m=>m[1]);
    expect(sentences).toHaveLength(4);
    const cutoff=instant(new Date(quote.balanceDue),locale,'guest');
    expect(sentences.join(' ')).toBe(renderToStaticMarkup(<>{policyContent(locale,'cancellation',cutoff)}</>));
  });
  it.each(locales)('retains authoritative quote instants with localized Lithuania-time context in %s',locale=>{
    const html=render(locale,<QuoteValidity quote={quote}/>),p=presentation(locale);
    for(const value of [quote.evaluatedAt,quote.expiresAt])expect(html).toContain(`dateTime="${value}"`);
    expect(html).toContain(p.t('All times are Lithuania time.'));
    expect(html).toContain(p.t('Dates are not reserved until your booking is accepted.'));
    expect(html).not.toMatch(/GMT|Europe\/Vilnius/);
  });
  it.each(locales)('associates each exact financial amount and nightly date in %s',locale=>{
    const p=presentation(locale),html=render(locale,<PaymentSummary quote={quote}/>);
    for(const [label,cents] of [['Initial test payment','16200'],['Total price','54000'],['Balance','37800']] as const)
      expect(html).toContain(`<dt>${p.t(label)}</dt><dd>${p.money(cents)}</dd>`);
    expect(html).toContain(`dateTime="${quote.balanceDue}"`);
    const full=render(locale,<PaymentSummary quote={{...quote,basis:'FULL',initialCents:'54000',balanceCents:'0'}}/>);
    expect(full).toContain(`<dt>${p.t('Full test payment')}</dt><dd>${p.money('54000')}</dd>`);
    const rates=render(locale,<NightlyRates quote={quote}/>);
    for(const line of quote.lines)expect(rates).toContain(`<dt><time dateTime="${line.night}">${p.day(line.night)}</time></dt><dd>${p.money(line.cents)}</dd>`);
  });
  it('uses Vilnius daylight-saving transitions independently of browser timezone, preserving technical formatting',()=>{
    for(const [value,time] of [
      ['2027-03-28T00:30:00Z','02:30'],['2027-03-28T01:30:00Z','04:30'],
      ['2027-10-31T00:30:00Z','03:30'],['2027-10-31T02:30:00Z','04:30'],
    ]) {
      for(const locale of locales)expect(instant(new Date(value),locale,'guest')).toContain(time);
    }
    const value=new Date(quote.balanceDue);
    expect(instant(value,'en')).toContain('GMT+3 (Europe/Vilnius)');
    expect(instant(value,'en','guest')).toBe('18 Jun 2027, 15:00');
  });
});
