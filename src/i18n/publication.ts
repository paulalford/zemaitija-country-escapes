import type { Metadata, MetadataRoute } from 'next';
import { defaultLocale, isLocale, localePath, locales, type Locale } from './routing';
import { presentation } from './messages';

/** Deliberately unconfigured. Owner approval is required before adding a publication origin.
 * Never infer this from request headers, APP_ORIGIN or deployment environment variables. */
export const approvedCanonicalOrigin: string | undefined = undefined;
export const publicPaths = ['/', '/accommodations', '/accommodations/forest-cottage', '/accommodations/lakeside-cabin', '/accommodations/family-cottage', '/explore', '/experiences', '/privacy', '/terms'] as const;
export type PublicPath = typeof publicPaths[number];
export function isPublicPath(path: string): path is PublicPath {
  return (publicPaths as readonly string[]).includes(path);
}
const copy = {
  '/': {lt:['Viešnagės Žemaitijoje', 'Trys išgalvotos viešnagės Žemaitijoje. Palyginkite demonstracinius namelius ir susipažinkite su rezervavimo eiga.'], en:['Stays in Žemaitija', 'Three fictional stays in Žemaitija. Compare demo cottages and explore the synthetic booking journey.'], de:['Aufenthalte in Žemaitija', 'Drei fiktive Unterkünfte in Žemaitija. Vergleichen Sie Demo-Häuser und erkunden Sie den synthetischen Buchungsablauf.']},
  '/accommodations': {lt:['Palyginkite namelius','Palyginkite tris išgalvotus namelius. Patogumai nėra patvirtinti; kainą nustato tik serverio pasiūlymas.'],en:['Compare cottages','Compare three fictional cottages. Facilities are unspecified; only a server quote establishes a demo price.'],de:['Häuser vergleichen','Vergleichen Sie drei fiktive Häuser. Ausstattung ist nicht festgelegt; nur ein Serverangebot bestimmt den Demo-Preis.']},
  '/explore': {lt:['Atraskite Žemaitiją','Pažinkite Platelių kraštovaizdį ir Žemaitijos lankytinas vietas. Nepriklausomos vietos ir oficiali lankytojų informacija.'],en:['Explore Žemaitija','Discover the Plateliai landscape and destinations across Žemaitija, with independent destinations and official visitor information.'],de:['Žemaitija entdecken','Entdecken Sie die Landschaft um Plateliai und Ausflugsziele in Žemaitija mit unabhängigen Zielen und offiziellen Besucherinformationen.']},
  '/experiences': {lt:['Lankytinų vietų katalogas','Žemaitijos lankytinų vietų katalogas pagal vietovę ir pomėgius. Prieš vykdami patikrinkite oficialią informaciją.'],en:['Destination directory','Browse Žemaitija destinations by area and interest. Check official visitor information before travelling.'],de:['Ausflugsverzeichnis','Erkunden Sie Ziele in Žemaitija nach Gebiet und Interesse. Prüfen Sie vor der Reise die offiziellen Besucherinformationen.']},
  '/privacy': {lt:['Privatumo informacija','Demonstracinės svetainės privatumo projektas: slapukai, rezervavimo duomenys, prieigos nuorodos, žemėlapiai ir bandomieji mokėjimai.'],en:['Privacy information','Draft demo privacy information covering cookies, booking data, access links, maps and test payments.'],de:['Datenschutzhinweise','Entwurf der Demo-Datenschutzhinweise zu Cookies, Buchungsdaten, Zugangslinks, Karten und Testzahlungen.']},
  '/terms': {lt:['Demonstracinės sąlygos','Demonstracinės mokėjimo, atšaukimo ir grąžinimo sąlygos. Komercinėms sąlygoms dar reikalinga savininko ir teisinė peržiūra.'],en:['Demonstration terms','Demo payment, cancellation and refund terms. Commercial terms still require owner and legal review.'],de:['Demonstrationsbedingungen','Demo-Bedingungen für Zahlung, Stornierung und Erstattung. Geschäftsbedingungen erfordern noch Betreiber- und Rechtsprüfung.']},
} as const;
function originUrl(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new RangeError('Canonical origin must be a bare HTTPS origin');
  return url.origin;
}
/** Strict path allowlist rejects query strings, fragments, tokens and private routes. */
export function publicMetadata(locale: Locale, path: PublicPath, origin = approvedCanonicalOrigin): Metadata {
  if (!isLocale(locale) || !isPublicPath(path)) throw new RangeError('Unpublished page');
  const p = presentation(locale);
  const unit = path.startsWith('/accommodations/') ? path.slice('/accommodations/'.length) : undefined;
  const [heading, description] = unit ? [p.unitName(unit), p.t('Facilities, sleeping arrangements, accessibility and stay rules are not specified. Images establish none of these facts.')] : copy[path as keyof typeof copy][locale];
  // Unit-specific descriptions remain unique without inventing accommodation features.
  const detail = unit ? `${heading}. ${description}` : description;
  const title = `${heading} | Žemaitija Country Escapes`;
  const base = origin === undefined ? undefined : originUrl(origin);
  const url = base ? `${base}${localePath(locale,path)}` : undefined;
  return {
    title, description: detail, robots: {index:false,follow:false},
    ...(base ? {alternates:{canonical:url,languages:{...Object.fromEntries(locales.map(language=>[language,`${base}${localePath(language,path)}`])), 'x-default':`${base}${localePath(defaultLocale,path)}`}}} : {}),
    openGraph:{type:'website',title,description:detail,siteName:'Žemaitija Country Escapes',locale:{lt:'lt_LT',en:'en_GB',de:'de_DE'}[locale],alternateLocale:locales.filter(language=>language!==locale).map(language=>({lt:'lt_LT',en:'en_GB',de:'de_DE'}[language])),...(url?{url}:{})},
  };
}
export function publicSitemap(origin = approvedCanonicalOrigin): MetadataRoute.Sitemap {
  if (origin === undefined) return [];
  const base = originUrl(origin);
  return publicPaths.flatMap(path=>locales.map(locale=>({url:`${base}${localePath(locale,path)}`,alternates:{languages:{...Object.fromEntries(locales.map(language=>[language,`${base}${localePath(language,path)}`])), 'x-default':`${base}${localePath(defaultLocale,path)}`}}})));
}
