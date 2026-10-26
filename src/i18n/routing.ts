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
  if (!/^\/(?:manage(?:\/access)?|admin(?:\/(?:signin|bookings(?:\/[a-f0-9-]{36})?|calendar|incidents|identities))?)?$/.test(base)) throw new RangeError('Unknown local page');
  const query = new URLSearchParams();
  for (const key of ['notice', 'date', 'view', 'unit']) {
    const value = url.searchParams.get(key);
    if (value && (/^(notice)$/.test(key) ? /^[a-z-]{1,40}$/.test(value) : key === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(value) : key === 'view' ? /^(month|week)$/.test(value) : /^[a-f0-9-]{36}$/.test(value))) query.set(key,value);
  }
  return `/${locale}${base==='/'?'':base}${query.size?`?${query}`:''}`;
}
