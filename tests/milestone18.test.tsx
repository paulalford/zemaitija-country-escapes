import type { Pool } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { approvedCanonicalOrigin, isPublicPath, publicMetadata, publicPaths, publicSitemap, type PublicPath } from '../src/i18n/publication';
import { locales, localePath, type Locale } from '../src/i18n/routing';
import { legalDraft, privacySections, termsSections } from '../src/i18n/content/legal';
import { policyContent } from '../src/i18n/policy';
import { presentation } from '../src/i18n/messages';
import { LocaleProvider } from '../src/i18n/client';
import { BookingFlow } from '../src/app/booking/stay-form';
import { Notice, Status } from '../src/app/workspace/ui';
import Privacy, {generateMetadata as privacyMetadata} from '../src/app/privacy/page';
import Terms from '../src/app/terms/page';
import PaymentReturn from '../src/app/booking/return/page';
import Manage from '../src/app/manage/page';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';
import nextConfig from '../next.config';
import { proxy } from '../src/proxy';
import { stripeAutomationConfig } from '../src/server/stripe-automation-config';
import { runStripeAutomationFoundation } from '../src/server/stripe-automation';

let locale:Locale='en';
let path='/privacy';
let bookingState='AWAITING_INITIAL_PAYMENT';
const source=(file:string)=>readFileSync(file,'utf8');
vi.mock('../src/i18n/server',()=>({getPresentation:async()=>presentation(locale)}));
vi.mock('next/navigation',()=>({usePathname:()=>localePath(locale,path),useSearchParams:()=>new URLSearchParams()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:'synthetic-only'})})}));
// No real client, adapter, credential configuration or provider is evaluated.
vi.mock('../src/db/client',()=>({pool:{}}));
vi.mock('../src/server/public-booking-http',()=>({bookingCookie:(kind:string)=>kind}));
vi.mock('../src/server/public-booking-token',()=>({openReceipt:()=>({kind:'receipt'})}));
vi.mock('../src/server/public-booking',()=>({publicBookingStatus:async()=>({status:bookingState,unit_key:'forest-cottage',arrival_date:'2027-07-02',departure_date:'2027-07-05',total_cents:'54000'})}));
vi.mock('../src/app/workspace/session',()=>({workspaceSession:async()=>({raw:'synthetic',session:{expires_at:new Date('2027-06-01T12:00Z')}})}));
vi.mock('../src/server/access',()=>({mintAction:vi.fn(()=>{throw Error('No actions authorized in read-only fixture');})}));
vi.mock('../src/server/guest-management',()=>({guestBooking:async()=>({
  booking:{id:'synthetic',unit_key:'forest-cottage',arrival_date:'2027-07-02',departure_date:'2027-07-05',guest_count:2,status:'CANCELLED_GUEST',total_cents:'54000',locale:'lt',terms_version:'SYNTHETIC_TEST_TERMS_V1',policy_version:'synthetic',balance_due_at:new Date('2027-06-18T12:00Z'),warning_at:new Date('2027-06-11T12:00Z'),grace_ends_at:new Date('2027-06-19T12:00Z')},
  scopes:[],lines:[],obligations:[],assessment:{state:'PENDING',cap_cents:'16200',charge_cents:null},refunds:[{state:'PROCESSING',requested_cents:'16200'}],position:{position:'REFUND_DUE',outstandingCents:0n,paidCents:16200n,refundDueCents:16200n,refundedCents:0n},
})}));
async function html(element:React.ReactNode) { return new Response(await renderToReadableStream(<LocaleProvider locale={locale}>{element}</LocaleProvider>)).text(); }
afterEach(()=>{locale='en';path='/privacy';bookingState='AWAITING_INITIAL_PAYMENT';vi.unstubAllEnvs();});

describe('M18 restrictive allowlisted publication',()=>{
  const origin='https://publication.example';
  it('ships no canonical hostname, absolute alternates or sitemap locations',()=>{
    expect(approvedCanonicalOrigin).toBeUndefined();expect(sitemap()).toEqual([]);expect(robots()).toEqual({rules:{userAgent:'*',disallow:'/'}});
    vi.stubEnv('APP_ORIGIN','https://unapproved.example');
    for(const language of locales)for(const route of publicPaths){
      const metadata=publicMetadata(language,route);expect(metadata.alternates).toBeUndefined();expect(metadata.openGraph).not.toHaveProperty('url');expect(metadata.robots).toEqual({index:false,follow:false});
    }
  });
  it.each(locales)('has unique complete titles and descriptions and real routes in %s',language=>{
    const metadata=publicPaths.map(route=>publicMetadata(language,route));
    expect(new Set(metadata.map(m=>m.title)).size).toBe(publicPaths.length);
    expect(new Set(metadata.map(m=>m.description)).size).toBe(publicPaths.length);
    for(const [i,m] of metadata.entries()){
      const route=publicPaths[i];expect(m.description!.length).toBeGreaterThan(30);
      const file=route==='/'?'src/app/page.tsx':route.startsWith('/accommodations/')?'src/app/accommodations/[slug]/page.tsx':`src/app${route}/page.tsx`;
      expect(existsSync(file)).toBe(true);expect(source(file)).toContain('generateMetadata');
    }
  });
  it('provides reciprocal canonical, hreflang, Lithuanian x-default and matching Open Graph using only an injected origin',()=>{
    for(const route of publicPaths)for(const language of locales){
      const m=publicMetadata(language,route,origin),url=`${origin}${localePath(language,route)}`;
      expect(m.alternates?.canonical).toBe(url);expect(m.openGraph).toMatchObject({url,title:m.title,description:m.description,type:'website'});
      expect(m.alternates?.languages).toEqual({...Object.fromEntries(locales.map(l=>[l,`${origin}${localePath(l,route)}`])),'x-default':`${origin}/lt${route==='/'?'':route}`});
    }
    for(const route of publicPaths)expect(new Set(locales.map(l=>publicMetadata(l,route).description)).size).toBe(3);
  });
  it.each(['http://publication.example','https://user:password@publication.example','https://publication.example/path','https://publication.example?token=secret','https://publication.example#secret','//publication.example'])('rejects unsafe origin %s',origin=>{
    expect(()=>publicMetadata('en','/',origin)).toThrow();expect(()=>publicSitemap(origin)).toThrow();
  });
  it.each(['/api/booking/quote','/admin','/admin/signin','/manage','/manage/access','/booking','/booking/return','/booking/cancel','/explore?destination=L01','/privacy#token','/accommodations/unknown','/en/terms','//evil.test'])('excludes private, unknown or query-specific path %s',route=>{
    expect(isPublicPath(route)).toBe(false);expect(()=>publicMetadata('en',route as PublicPath,origin)).toThrow();
  });
  it('sitemap contains only the exact locale/public-path cross product with no query or fragment',()=>{
    const entries=publicSitemap(origin);expect(entries).toHaveLength(publicPaths.length*3);
    expect(new Set(entries.map(e=>e.url)).size).toBe(entries.length);
    for(const entry of entries){const u=new URL(entry.url);expect(u.search+u.hash).toBe('');expect(isPublicPath(u.pathname.replace(/^\/(lt|en|de)/,'')||'/')).toBe(true);expect(entry.alternates?.languages).toHaveProperty('x-default');}
  });
  it.each(locales)('routes privacy/terms without weakening private boundaries in %s',language=>{
    for(const route of ['/privacy','/terms']){
      const response=proxy(new NextRequest(`https://demo.example/${language}${route}`,{headers:{'x-zce-locale':'de'}}));
      expect(response.headers.get('x-middleware-rewrite')).toBe(`https://demo.example${route}`);
      expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
    expect(proxy(new NextRequest(`https://demo.example/${language}/api/booking/quote`)).status).toBe(404);
    expect(localePath(language,'/terms?token=synthetic&session=synthetic')).toBe(`/${language}/terms`);
  });
  it('retains restrictive headers for new routes and all established private/booking rules',async()=>{
    vi.stubEnv('ADMIN_OIDC_ISSUER','');
    const rules=await nextConfig.headers!();
    for(const route of ['/privacy','/terms','/:locale(lt|en|de)/privacy','/:locale(lt|en|de)/terms','/robots.txt','/sitemap.xml','/booking/:path*','/manage/:path*','/admin/:path*','/api/access/:path*']){
      const headers=rules.find(r=>r.source===route)!.headers;
      expect(headers).toContainEqual({key:'X-Robots-Tag',value:'noindex, nofollow'});
      expect(headers).toContainEqual({key:'Referrer-Policy',value:'no-referrer'});
      expect(headers.find(h=>h.key==='Content-Security-Policy')?.value).not.toContain('tile.openstreetmap.org');
    }
    expect(source('src/app/layout.tsx')).toContain('robots:{index:false,follow:false}');
  });
});

describe('M18 equivalent draft policy pages and accessible reading structure',()=>{
  it.each(locales)('renders full %s privacy and unchanged shared terms with one main/h1, navigation and footer',async language=>{
    locale=language;
    for(const [route,Page] of [['/privacy',Privacy],['/terms',Terms]] as const){
      path=route;const output=await html(await Page());
      expect((output.match(/<main\b/g)||[])).toHaveLength(1);expect((output.match(/<h1\b/g)||[])).toHaveLength(1);
      expect(output).toContain('id="content" tabindex="-1"');expect(output).toContain('href="#content"');
      expect(output).toContain(renderToStaticMarkup(<>{legalDraft[language]}</>));
      expect(output).toContain(`href="/${language}/privacy"`);expect(output).toContain(`href="/${language}/terms"`);
      for(const l of locales)expect(output).toContain(`href="/${l}${route}"`);
      if(route==='/terms')for(const section of ['payment','cancellation','refund','review'] as const)expect(output).toContain(renderToStaticMarkup(<>{policyContent(language,section)}</>));
    }
    expect(await privacyMetadata()).toEqual(publicMetadata(language,'/privacy'));
  });
  it('keeps equivalent section IDs and key cookie/provider disclosures in every language',()=>{
    for(const language of locales){
      const content=privacySections.map(s=>s.body[language]).join(' ');
      for(const name of ['zce_locale','zce_guest','zce_admin','zce_oidc','zce_booking_browser','zce_booking_receipt','HttpOnly','SameSite=Lax','Secure','__Host-','tile.openstreetmap.org','Referer','Stripe','Stage 2C'])expect(content).toContain(name);
      for(const section of privacySections){expect(section.heading[language]).toBeTruthy();expect(section.body[language].length).toBeGreaterThan(100);}
      expect(termsSections(language).map(s=>s.id)).toEqual(['payment','cancellation','refund','review','authority','decisions']);
      const terms=termsSections(language).map(s=>s.body).join(' ');
      for(const fact of ['30%','100%','T–14','T–21','24','15:00','Europe/Vilnius','SYNTHETIC_TEST_TERMS_V1'])expect(terms).toContain(fact);
    }
  });
  it.each(locales)('keeps native labelled required booking controls and availability/status semantics in %s',language=>{
    locale=language;const p=presentation(language);
    const output=renderToStaticMarkup(<LocaleProvider locale={language}><BookingFlow units={[{id:'synthetic',unit_key:'forest-cottage',capacity:2}]} initial={{unit:'',arrival:'',departure:'',guests:'2'}}/></LocaleProvider>);
    for(const field of ['unit','arrival','departure','guests'])expect(output).toMatch(new RegExp(`<label>[^<]+<(?:input|select)[^>]*name="${field}"`));
    expect((output.match(/required=""/g)||[])).toHaveLength(4);expect(output).toContain(p.t('All booking fields are required.'));expect(output).toContain('role="status" aria-live="polite"');
    const empty=renderToStaticMarkup(<LocaleProvider locale={language}><BookingFlow units={[]} initial={{unit:'',arrival:'',departure:'',guests:'2'}}/></LocaleProvider>);
    expect(empty).toContain(p.t('Catalog unavailable. Please try again later.'));expect(empty).toContain('disabled=""');
  });
  it.each(locales)('renders synthetic pending/confirmed/expired return states without navigation confirmation in %s',async language=>{
    locale=language;path='/booking/return';const p=presentation(language);
    for(const state of ['AWAITING_INITIAL_PAYMENT','CONFIRMED','EXPIRED']){
      bookingState=state;const output=await html(await PaymentReturn());
      expect(output).toContain(`role="status" class="booking-notice">${p.statusLabel(state)}`);
      expect(output).toContain(p.money('54000'));expect(output).toContain(p.t('Returning from Checkout never confirms payment. This page reads the recorded booking state only.'));
      expect(output.includes(p.t('Resume existing test Checkout'))).toBe(state==='AWAITING_INITIAL_PAYMENT');
    }
  });
  it.each(locales)('retains pending payment, investigation, cancellation and refund distinctions in %s',async language=>{
    locale=language;const p=presentation(language);
    const output=await html(await Manage({searchParams:Promise.resolve({notice:'refund-queued'})}));
    expect(output).toContain(p.t('The refund request has been queued. It is complete only after provider verification.'));
    expect(output).toContain(p.money('16200'));expect(output).toContain(p.statusLabel('PROCESSING'));expect(output).toContain(p.t('Awaiting assessment'));
    expect(output).toContain(p.instant(new Date('2027-06-18T12:00Z')));expect(output).toContain('SYNTHETIC_TEST_TERMS_V1');
    const statuses=renderToStaticMarkup(<LocaleProvider locale={language}><Notice code="payment-pending"/><Status value="PAYMENT_INCIDENT"/><Status value="REFUNDED_FULL"/></LocaleProvider>);
    expect(statuses).toContain('role="status"');expect(statuses).toContain(p.statusLabel('PAYMENT_INCIDENT'));expect(statuses).toContain(p.statusLabel('REFUNDED_FULL'));
  });
  it('retains error recovery/focus and responsive, reduced-motion and map keyboard safeguards in source',()=>{
    const flow=source('src/app/booking/stay-form.tsx');
    expect(flow).toContain('if(error)errorNotice.current?.focus()');expect(flow).toContain('ref={errorNotice} tabIndex={-1} role="alert"');
    for(const code of ['UNAVAILABLE','EXPIRED_QUOTE','PAYMENT_UNAVAILABLE'])expect(flow).toContain(code);
    expect(flow).toContain('requestAnimationFrame(()=>heading.current?.focus())');
    const css=source('src/app/public-ui/timber.css');
    for(const rule of ['prefers-reduced-motion:reduce','min-height:48px','min-height:44px','outline:3px','max-width:760px','max-width:34em'])expect(css).toContain(rule);
    const map=source('src/app/explore/destination-atlas.tsx');expect(map).toContain('Enter');expect(map).toContain('aria-pressed');expect(map).toContain('<noscript>');
  });
  it('keeps automation disabled without reading runtime configuration or constructing resources',()=>{
    expect(()=>stripeAutomationConfig({})).toThrow('DISABLED');expect(()=>stripeAutomationConfig({STRIPE_AUTOMATION_ENABLED:'false'})).toThrow('DISABLED');
    const constructDatabase=vi.fn(),constructStripe=vi.fn();
    const result=runStripeAutomationFoundation({} as Parameters<typeof runStripeAutomationFoundation>[0],{constructDatabase,constructStripe});
    expect(result).toMatchObject({status:'INACTIVE',processingEnabled:false});expect(constructDatabase).not.toHaveBeenCalled();expect(constructStripe).not.toHaveBeenCalled();
  });
});


describe('M18 offline authorization denial regression',()=>{
  it('denies missing sessions, wrong workspace kind, missing scopes and substituted booking IDs',async()=>{
    const {requireSession,AccessDenied}=await vi.importActual<typeof import('../src/server/access')>('../src/server/access');
    const base={id:'synthetic-session',admin_user_id:null,guest_token_id:'synthetic-token',booking_id:'booking-a',guest_id:'synthetic-guest',scopes:['booking:view'],role:null,expires_at:new Date('2027-01-01'),authenticated_at:new Date('2026-01-01')};
    for(const input of [
      {row:undefined,raw:undefined,kind:'guest'},
      {row:undefined,raw:'a'.repeat(43),kind:'guest'},
      {row:base,raw:'a'.repeat(43),kind:'admin'},
      {row:base,raw:'a'.repeat(43),kind:'guest',scope:'booking:cancel'},
      {row:base,raw:'a'.repeat(43),kind:'guest',scope:'booking:view',bookingId:'booking-b'},
    ] as const){
      const query=vi.fn(async(sql:string)=>sql.includes('SELECT s.id')?{rows:input.row?[input.row]:[],rowCount:input.row?1:0}:{rows:[],rowCount:1});
      await expect(requireSession({query} as unknown as Pool,input.raw,input.kind,'scope' in input?input.scope:undefined,'bookingId' in input?input.bookingId:undefined)).rejects.toBeInstanceOf(AccessDenied);
      expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE access_sessions'))).toBe(false);
    }
  });
});
