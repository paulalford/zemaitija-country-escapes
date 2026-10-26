import { localeTags, type Locale } from './routing';
export const propertyZone = 'Europe/Vilnius';
/** Format the integer and fractional parts independently: no cents pass through floating point. */
export function money(cents: string | bigint, locale: Locale = 'lt', currencyDisplay: 'symbol'|'code' = 'symbol') {
  const value=BigInt(cents),abs=value<0n?-value:value;
  return new Intl.NumberFormat(localeTags[locale],{style:'currency',currency:'EUR',currencyDisplay}).formatToParts(value<0n?-abs/100n:abs/100n)
    .map(part=>part.type==='fraction'?(abs%100n).toString().padStart(2,'0'):part.value).join('')
    .replace(/^/,value<0n&&abs<100n?'-':'');
}
export function day(value: string, locale: Locale = 'lt') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Local date required');
  const date=new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) throw new RangeError('Invalid local date');
  return new Intl.DateTimeFormat(localeTags[locale],{day:'numeric',month:'short',year:'numeric',timeZone:propertyZone}).format(date);
}
export function instant(value: Date, locale: Locale = 'lt') {
  return `${new Intl.DateTimeFormat(localeTags[locale],{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:propertyZone,timeZoneName:'shortOffset'}).format(value)} (${propertyZone})`;
}
