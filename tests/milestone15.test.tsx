import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { catalog, type MessageKey } from '../src/i18n/catalog';
import { localePath, locales, resolveLocale } from '../src/i18n/routing';
import { money, day, instant } from '../src/i18n/format';
import { policyContent, policyFacts, policyTemplates } from '../src/i18n/policy';
import { presentation, statusLabel, statusMessages, translate } from '../src/i18n/messages';
import { proxy } from '../src/proxy';
import { LocaleProvider, LanguageSwitcher } from '../src/i18n/client';
import Loading from '../src/app/manage/loading';
import GuestError from '../src/app/manage/error';
import AdminError from '../src/app/admin/error';
import Denied from '../src/app/admin/not-found';
import { BlockForm } from '../src/app/admin/calendar/block-form';
import { AssessmentForm } from '../src/app/admin/bookings/[id]/assessment-form';
import { Notice } from '../src/app/workspace/ui';
import { quoteDeadlines, splitPayment } from '../src/server/quote-math';
import { financialNoticeContent, financialNoticeEvents } from '../src/server/financial-notifications';
import { noticeContent } from '../src/server/nonpayment-notices';

vi.mock('next/navigation',()=>({usePathname:()=>'/de/admin/calendar',useSearchParams:()=>new URLSearchParams('date=2027-03-28&view=week')}));
const request=(path:string,cookie='')=>new NextRequest(`https://demo.example${path}`,{headers:{cookie,'x-zce-locale':'de'}});
const rendered=(locale:typeof locales[number],element:React.ReactNode)=>renderToStaticMarkup(<LocaleProvider locale={locale}>{element}</LocaleProvider>);

describe('Milestone 15 canonical locale routing',()=>{
  it('defaults the root to Lithuanian regardless of a language cookie',()=>{
    const response=proxy(request('/','zce_locale=de'));
    expect(response.headers.get('location')).toBe('https://demo.example/lt');
  });
  it.each(locales)('resolves %s deep links without a public redirect',locale=>{
    const response=proxy(request(`/${locale}/admin/calendar?date=2027-03-28&view=week`));
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://demo.example/admin/calendar?date=2027-03-28&view=week');
    expect(response.headers.get('x-middleware-request-x-zce-locale')).toBe(locale);
    expect(response.headers.get('content-language')).toBe(locale);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('localizes unprefixed return pages using a validated preference without changing authentication cookies',()=>{
    const response=proxy(request('/manage?notice=payment-return','zce_locale=de; zce_guest=private'));
    expect(response.headers.get('location')).toBe('https://demo.example/de/manage?notice=payment-return');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(proxy(request('/admin','zce_locale=invalid')).headers.get('location')).toBe('https://demo.example/lt/admin');
  });
  it.each(['/fr/manage','/EN/manage','/en-US/manage','/de/en/manage','/%2fen/manage','/de/api/access/admin/callback'])('rejects unsupported or malformed route %s',path=>{
    expect(proxy(request(path)).status).toBe(404);
  });
  it.each(['/api/stripe/webhook','/api/access/admin/callback?code=test&state=opaque','/api/access/guest/exchange','/_next/static/chunk.js'])('leaves integration endpoint %s untouched',path=>{
    const response=proxy(request(path));
    expect(response.headers.get('location')).toBeNull();expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('does not server-redirect legacy fragment access links',()=>{
    const response=proxy(request('/manage/access'));expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-zce-locale')).toBe('lt');
  });
  it('switches equivalent booking routes and preserves only legitimate calendar context',()=>{
    expect(localePath('en','/lt/manage')).toBe('/en/manage');
    expect(localePath('de','/en/admin/bookings/12345678-1234-1234-1234-123456789abc')).toBe('/de/admin/bookings/12345678-1234-1234-1234-123456789abc');
    expect(localePath('lt','/de/admin/calendar?date=2027-03-28&view=week&token=secret&session=secret&returnTo=https://evil.test')).toBe('/lt/admin/calendar?date=2027-03-28&view=week');
  });
  it.each(['//evil.test','https://evil.test','/\\evil.test','/de/manage#private','/de/%2f%2fevil.test','/manage\n','/api/access/admin/callback'])('refuses unsafe switch target %s',path=>{
    expect(()=>localePath('en',path)).toThrow();
  });
  it('drops encoded unknown query values without making valid pages unavailable',()=>{expect(localePath('de','/en/manage?returnTo=https%3A%2F%2Fevil.test&notice=payment-return')).toBe('/de/manage?notice=payment-return');});
  it('has a safe noncontractual fallback for invalid preference values',()=>{expect(resolveLocale('fr')).toBe('lt');expect(resolveLocale(undefined)).toBe('lt');});
});

describe('Milestone 15 equivalent translations and policy facts',()=>{
  it('requires complete resources, exact template placeholders and no empty values in all three languages',()=>{
    const placeholders=(value:string)=>[...value.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
    for(const message of Object.values(catalog)){
      expect(Object.keys(message).sort()).toEqual(['de','en','lt']);
      for(const locale of locales){expect(message[locale].trim()).not.toBe('');expect(placeholders(message[locale])).toEqual(placeholders(message.en));}
    }
    for(const section of Object.values(policyTemplates))for(const locale of locales)expect(placeholders(section[locale])).toEqual(placeholders(section.en));
  });
  it('fails closed on a missing key or a missing interpolation value without exposing its identifier',()=>{
    expect(()=>translate('lt','INTERNAL_MISSING' as MessageKey)).toThrow('Translation unavailable');
    expect(()=>translate('de','Previous approved charge: {amount}; a revision cannot increase it.')).toThrow('Translation value unavailable');
  });
  it.each(locales)('uses shared approved policy numbers and a backend cutoff in %s',locale=>{
    const cutoff=instant(new Date('2027-03-14T13:00:00Z'),locale);
    const payment=policyContent(locale,'payment'),cancellation=policyContent(locale,'cancellation',cutoff);
    for(const value of ['30%','100%','T–14','T–21','24'])expect(payment).toContain(value);
    expect(cancellation).toContain(cutoff);expect(cancellation).toContain('30%');
    expect(policyContent(locale,'refund')).toBeTruthy();expect(policyContent(locale,'review')).toBeTruthy();
    const boundary=new Date('2027-03-14T13:00:00Z');
    expect(splitPayment(10000n,new Date(boundary.getTime()-1),boundary).initialCents).toBe(BigInt(policyFacts.advancePercent)*100n);
    expect(splitPayment(10000n,boundary,boundary).initialCents).toBe(10000n);
  });
  it('keeps operational states distinct and explicitly describes unverified processing',()=>{
    for(const locale of locales){
      const values=['PROCESSING','REFUNDED','PENDING','SUPPRESSED'].map(value=>statusLabel(value,locale));
      expect(new Set(values).size).toBe(4);
      for(const value of Object.keys(statusMessages))expect(statusLabel(value,locale)).toBeTruthy();
      expect(statusLabel('HISTORICAL_UNKNOWN',locale)).toContain('HISTORICAL_UNKNOWN');
    }
  });
  it.each(locales)('keeps all existing financial and timed notices available in %s',locale=>{
    for(const event of financialNoticeEvents)expect(financialNoticeContent(event,locale,'1234','40000')).toBeTruthy();
    for(const kind of ['BALANCE_WARNING','BALANCE_DUE','BALANCE_OVERDUE'] as const)expect(noticeContent(kind,locale,new Date('2027-03-14T13:00Z'),new Date('2027-03-15T13:00Z'),new Date('2027-03-07T13:00Z'))).toContain('Europe/Vilnius');
  });
});

describe('Milestone 15 exact EUR and Vilnius presentation',()=>{
  it.each(locales)('preserves cents beyond the safe-number range in %s',locale=>{
    expect(money(9223372036854775807n,locale)).toContain('07');
    expect(money(1n,locale)).toContain(locale==='en'?'0.01':'0,01');
    expect(money(-1n,locale)).toContain('-');expect(money(123456n,locale)).toContain('€');
  });
  it('uses language-specific date ordering and accepts local dates only',()=>{
    expect(day('2027-07-02','de')).toContain('2. Juli 2027');expect(day('2027-07-02','en')).toContain('2 Jul 2027');
    expect(()=>day('2027-02-30')).toThrow();expect(()=>day('2027-07-02T00:00:00Z')).toThrow();
  });
  it.each(locales)('keeps Vilnius DST offsets and the decisive instant unchanged in %s',locale=>{
    for(const [value,offset] of [['2027-03-28T00:59:00Z','GMT+2'],['2027-03-28T01:00:00Z','GMT+3'],['2027-10-31T00:59:00Z','GMT+3'],['2027-10-31T01:00:00Z','GMT+2']]){
      const date=new Date(value),before=date.getTime();expect(instant(date,locale)).toContain(offset);expect(instant(date,locale)).toContain('Europe/Vilnius');expect(date.getTime()).toBe(before);
    }
    expect(quoteDeadlines('2027-04-04').grace.getTime()-quoteDeadlines('2027-04-04').balance.getTime()).toBe(policyFacts.graceHours*3600000);
  });
});

describe('Milestone 15 localized accessible workspaces',()=>{
  it.each(locales)('renders translated loading, denial, errors, notices and expandable forms in %s',locale=>{
    const p=presentation(locale);
    expect(rendered(locale,<Loading/>)).toContain(p.t('Loading reservation'));
    expect(rendered(locale,<GuestError reset={()=>{}}/>)).toContain(p.t('Try again'));
    expect(rendered(locale,<AdminError reset={()=>{}}/>)).toContain(p.href('/admin/signin'));
    expect(rendered(locale,<Denied/>)).toContain(p.t('Reservation unavailable'));
    expect(rendered(locale,<Notice code="invalid-input"/>)).toContain('role="status"');
    expect(rendered(locale,<Notice code="internal.unknown"/>)).toBe('');
    const block=rendered(locale,<BlockForm units={[]} token="synthetic" operationKey="synthetic"/>);
    expect(block).toContain(p.t('Select an accommodation and a valid date range to review the nights being blocked.'));
    expect(block).toContain('name="confirmed"');expect(block).toContain('required=""');expect(block).toContain('aria-live="polite"');
    const assessment=rendered(locale,<AssessmentForm token="synthetic" bookingId="synthetic" operationKey="synthetic" revision={0} capCents="3000" priorCharge={null} totalCents="10000"/>);
    expect(assessment).toContain(p.t('Review this calculation'));expect(assessment).toContain('aria-live="polite"');
  });
  it('uses native keyboard links with self-language names and current-language indication',()=>{
    const html=rendered('de',<LanguageSwitcher/>);
    for(const locale of locales)expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain('aria-current="page"');expect(html).toContain('/en/admin/calendar?date=2027-03-28&amp;view=week');
    expect(html).not.toContain('token=');
  });
});
