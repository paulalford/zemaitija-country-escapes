import 'server-only';
import { headers } from 'next/headers';
import { resolveLocale, localePath } from './routing';
import { presentation } from './messages';
export async function getPresentation() { const locale=resolveLocale((await headers()).get('x-zce-locale'));return {...presentation(locale),href:(path:string)=>localePath(locale,path)}; }
