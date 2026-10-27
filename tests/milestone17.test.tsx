import React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { destinationMarkers, destinations } from '../src/content/destinations';
import { locales, localePath, type Locale } from '../src/i18n/routing';
import { presentation, translate } from '../src/i18n/messages';
import { destinationMessages } from '../src/i18n/content/destinations';
import { DestinationAtlas } from '../src/app/explore/destination-atlas';
import { HillOfCrossesFeature } from '../src/app/explore/destination-ui';
import ExplorePage from '../src/app/explore/page';
import ExperiencesPage from '../src/app/experiences/page';
import nextConfig from '../next.config';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

let locale: Locale = 'en';
vi.mock('../src/i18n/server', () => ({ getPresentation: async () => ({ ...presentation(locale), href: (path: string) => localePath(locale, path) }) }));
vi.mock('../src/i18n/client', () => ({ usePresentation: () => presentation(locale), LanguageSwitcher: () => <nav>{locales.map(language => <a key={language} href={localePath(language, '/explore')}>{language}</a>)}</nav> }));
// CSS is not interpreted by static rendering; browser tests inspect actual map and styles.
async function html(element: React.ReactNode) {
  return new Response(await renderToReadableStream(element)).text();
}

describe('M17 conservative destination publication', () => {
  it('preserves all 17 Phase A identifiers and geographic scopes', () => {
    expect(destinations.map(d => d.id)).toEqual(['L01','L02','L03','L04','L05','L06','L07','R01','R02','R03','R04','R05','R06','R07','E01','E02','E03']);
    for (const destination of destinations) expect(destination.group).toBe(destination.id[0] === 'L' ? 'local' : destination.id[0] === 'R' ? 'regional' : 'excursion');
  });
  it('publishes authoritative primary evidence and a review date for every destination', () => {
    const authorities = ['zemaitijosnp.lt','visit.telsiai.lt','www.zdm.lt','www.kretingosmuziejus.lt','www.visitsiauliai.lt','www.visit-palanga.lt'];
    for (const destination of destinations) {
      expect(new URL(destination.source).protocol).toBe('https:');
      expect(authorities).toContain(new URL(destination.source).hostname);
      expect(destination.reviewedOn).toBe('2026-10-27');
    }
  });
  it('withholds unsupported fields and requires complete localized descriptions', () => {
    for (const destination of destinations) {
      expect(Object.keys(destination).sort()).toEqual(['id','group','category','name','area','description','source','reviewedOn','disposition'].sort());
      for (const language of locales) expect(destination.description[language].length).toBeGreaterThan(15);
    }
  });
  it('allows only independently recorded visitor-point coordinates with their exact semantics', () => {
    expect(destinationMarkers.map(p => [p.destinationId,p.latitude,p.longitude])).toEqual([
      ['L01',56.047040,21.828335],['L02',56.048411,21.827357],['L04',56.030465,21.814336],['L05',56.030391,21.906232],
    ]);
    for (const point of destinationMarkers) {
      expect(point.source).toMatch(/^https:\/\/zemaitijosnp.lt\//);
      expect(destinations.some(d => d.id === point.destinationId)).toBe(true);
      for (const language of locales) expect(point.meaning[language]).toBeTruthy();
    }
    expect(destinationMarkers[0].meaning.en).toContain('viewpoint');
    expect(destinationMarkers[1].meaning.en).toContain('start');
    expect(destinationMarkers[3].meaning.en).toContain('visitor centre');
  });
  it('emits no guessed Hill, town-centre, accommodation or boundary geometry', () => {
    expect(destinationMarkers).toHaveLength(4);
    expect(JSON.stringify(destinationMarkers)).not.toMatch(/E01|R0|accommodation|polygon|boundary|56\.01585|23\.432064/);
  });
  it.each(locales)('renders explicit Hill qualifier and significance in %s', async language => {
    locale = language;
    const output = await html(await HillOfCrossesFeature());
    expect(output).toContain(translate(language,'Major excursion · Šiauliai District'));
    expect(output).toContain(destinations.find(d => d.id === 'E01')!.description[language]);
  });
  it.each(locales)('keeps unpinned destinations, real sources and booking entry in the %s directory', async language => {
    locale = language;
    const output = await html(await ExperiencesPage({ searchParams: Promise.resolve({destination:'E01'}) }));
    for (const d of destinations) expect(output).toContain(`id="destination-${d.id}"`);
    expect(output).toContain(translate(language,'No map point'));
    expect(output).toContain(`/${language}/booking`);
    expect(output).toContain(`/${language}/accommodations`);
    expect(output).toContain('https://www.visitsiauliai.lt/en/sightseeing-places/the-hill-of-crosses/');
  });
  it('provides native semantic map/list selection and official links before any map script', () => {
    locale = 'en';
    const output = renderToStaticMarkup(<DestinationAtlas initialId="L02"/>);
    expect(output).toContain('aria-controls="atlas-selected"');
    expect(output).toContain('aria-pressed="true"');
    expect(output).toContain('id="atlas-selected"');
    expect(output).toContain('Selected destination: Šeirė Nature Trail');
    expect(output).toContain('<noscript>');
    expect(output).not.toContain('<img');
    expect(output).toContain('No exact accommodation location, address or boundary is established.');
  });
  it('supports GET filters and honest empty results without removing booking access', async () => {
    locale = 'en';
    const filtered = await html(await ExperiencesPage({searchParams:Promise.resolve({area:'regional',interest:'heritage'})}));
    expect(filtered).toContain('id="destination-R03"');
    expect(filtered).not.toContain('id="destination-L03"');
    const empty = await html(await ExperiencesPage({searchParams:Promise.resolve({area:'regional',interest:'walking'})}));
    expect(empty).toContain(translate('en','No matching destinations'));
    expect(empty).toContain('/en/booking');
  });
  it.each(locales)('preserves route, stable destination and filter context for %s', language => {
    expect(localePath(language,'/experiences?destination=E01&area=excursion&interest=pilgrimage&address=x')).toBe(`/${language}/experiences?destination=E01&area=excursion&interest=pilgrimage`);
    expect(localePath(language,'/explore?destination=forest-cottage&area=unknown')).toBe(`/${language}/explore`);
  });
  it('has complete nonempty UI translations with matching interpolation fields', () => {
    for (const value of Object.values(destinationMessages)) for (const language of locales) {
      expect(value[language]).toBeTruthy();
      expect(value[language].match(/\{\w+\}/g) ?? []).toEqual(value.en.match(/\{\w+\}/g) ?? []);
    }
  });
  it('ships licensed real files and never embeds review boards as production images', async () => {
    locale = 'en';
    const output = await html(await ExplorePage({searchParams:Promise.resolve({})}));
    expect(output).toContain('CC BY-SA 4.0');
    expect(output).not.toMatch(/m17-phase-a|AI illustration|generated_images/);
    expect(readdirSync('public/images/destinations').filter(name => name.endsWith('.jpg')).sort()).toEqual(['hill-of-crosses.jpg','plateliai-viewpoint.jpg']);
    for (const image of ['hill-of-crosses','plateliai-viewpoint']) {
      const record = JSON.parse(readFileSync(`public/images/destinations/${image}.jpg.json`,'utf8'));
      expect(record.license).toBe('CC BY-SA 4.0');
      expect(record.creator).toBeTruthy();
      expect(record.source).toMatch(/^https:\/\/commons.wikimedia.org/);
    }
  });
  it('permits tile imagery/referrer only on destination routes, preserving booking/private policy', async () => {
    const rules = await nextConfig.headers!();
    const publicRule = rules.find(rule => rule.source === '/explore')!;
    const privateRule = rules.find(rule => rule.source === '/booking/:path*')!;
    expect(publicRule.headers.find(h => h.key === 'Referrer-Policy')?.value).toBe('strict-origin-when-cross-origin');
    expect(publicRule.headers.find(h => h.key === 'Content-Security-Policy')?.value).toContain('https://tile.openstreetmap.org');
    expect(privateRule.headers.find(h => h.key === 'Referrer-Policy')?.value).toBe('no-referrer');
    expect(privateRule.headers.find(h => h.key === 'Content-Security-Policy')?.value).not.toContain('tile.openstreetmap.org');
    expect(proxy(new NextRequest('https://demo.example/en/explore')).headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(proxy(new NextRequest('https://demo.example/en/booking')).headers.get('Referrer-Policy')).toBe('no-referrer');
  });
});
