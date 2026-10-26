import { translate } from './i18n/messages';
import { NextRequest, NextResponse } from 'next/server';
import { isLocale, localePath, resolveLocale, stripLocale, localeCookie } from './i18n/routing';

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Integrations remain on their exact registered, unprefixed URLs.
  if (path.startsWith('/api/') || path.startsWith('/_next/') || /\.[^/]+$/.test(path)) return NextResponse.next();
  const first = path.split('/')[1];
  const localized = isLocale(first);
  const locale = localized ? first : path==='/' ? 'lt' : resolveLocale(request.cookies.get(localeCookie)?.value);
  const internal = localized ? stripLocale(path) : path;
  try { if(localized && isLocale(internal.split('/')[1])) throw new RangeError('Nested locale'); localePath(locale, internal); } catch { return new NextResponse(translate(locale,'Page not found'), {status:404,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}}); }
  // Legacy fragment links must be consumed and cleared in the browser before navigation.
  const legacyAccess = path === '/manage/access';
  if (!localized && !legacyAccess) return NextResponse.redirect(new URL(localePath(locale,path+request.nextUrl.search),request.url),307);
  const headers = new Headers(request.headers);
  headers.set('x-zce-locale',locale);
  const destination = request.nextUrl.clone(); destination.pathname = internal;
  const response = localized ? NextResponse.rewrite(destination,{request:{headers}}) : NextResponse.next({request:{headers}});
  response.cookies.set(localeCookie,locale,{path:'/',sameSite:'lax',secure:request.nextUrl.protocol==='https:',maxAge:31536000});
  response.headers.set('Content-Language',locale);
  response.headers.set('Cache-Control','private, no-store, max-age=0');
  response.headers.set('Referrer-Policy','no-referrer');
  return response;
}
export const config = {matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
