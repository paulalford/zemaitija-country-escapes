export const locales = ['lt', 'en', 'de'] as const;
export type Locale = typeof locales[number];
export const defaultLocale: Locale = 'lt';
export const localeCookie = 'zce_locale';
export const localeTags = {lt:'lt-LT', en:'en-GB', de:'de-DE'} as const;
export const languageNames = {lt:'Lietuvių', en:'English', de:'Deutsch'} as const;
export function isLocale(value: unknown): value is Locale { return typeof value === 'string' && locales.includes(value as Locale); }
export function resolveLocale(value: unknown): Locale { return isLocale(value) ? value : defaultLocale; }
export function stripLocale(path: string): string { return path.replace(/^\/(lt|en|de)(?=\/|$)/, '') || '/'; }
/** Only known application pages and allowlisted presentation context can cross a locale boundary. */
export function localePath(locale: Locale, path: string): string {
  if (!isLocale(locale) || !path.startsWith('/') || path.startsWith('//') || /[%\\\x00-\x20#]/.test(path.split('?')[0]) || path.includes('#')) throw new RangeError('Invalid local page');
  const url = new URL(path, 'https://local.invalid');
  const base = stripLocale(url.pathname);
  if (!/^\/(?:explore|experiences|accommodations(?:\/(?:forest-cottage|lakeside-cabin|family-cottage))?|booking(?:\/(?:return|cancel))?|manage(?:\/access)?|admin(?:\/(?:signin|bookings(?:\/[a-f0-9-]{36})?|calendar|incidents|identities))?)?$/.test(base)) throw new RangeError('Unknown local page');
  const query = new URLSearchParams();
  if (base === '/explore' || base === '/experiences') {
    const allowed = { destination: /^(L0[1-7]|R0[1-7]|E0[1-3])$/, area: /^(local|regional|excursion)$/, interest: /^(nature|walking|viewpoint|heritage|culture|pilgrimage|history|excursion)$/ };
    for (const [key, pattern] of Object.entries(allowed)) {
      const value = url.searchParams.get(key);
      if (value && pattern.test(value)) query.set(key, value);
    }
    return `/${locale}${base}${query.size ? `?${query}` : ''}`;
  }
  for (const key of ['notice', 'date', 'view', 'unit', 'arrival', 'departure', 'guests']) {
    const value = url.searchParams.get(key);
    if (value && (/^(notice)$/.test(key) ? /^[a-z-]{1,40}$/.test(value) : ['date','arrival','departure'].includes(key) ? /^\d{4}-\d{2}-\d{2}$/.test(value) : key === 'guests' ? /^[1-9]\d{0,3}$/.test(value) : key === 'view' ? /^(month|week)$/.test(value) : /^[a-f0-9-]{36}$/.test(value))) query.set(key,value);
  }
  return `/${locale}${base==='/'?'':base}${query.size?`?${query}`:''}`;
}
