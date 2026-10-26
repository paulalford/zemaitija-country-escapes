'use client';
import { createContext, useContext, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { presentation } from './messages';
import { type Locale, locales, languageNames, localeCookie, localePath, stripLocale } from './routing';
const Context=createContext<{locale:Locale;setLocale:(locale:Locale)=>void}>({locale:'lt',setLocale:()=>{}});
export function LocaleProvider({locale,children}:{locale:Locale;children:React.ReactNode}) {
  const [selected,setLocale]=useState(locale);
  return <Context.Provider value={{locale:selected,setLocale}}>{children}</Context.Provider>;
}
export function usePresentation(){return presentation(useContext(Context).locale);}
export function LanguageSwitcher(){
  const {locale,setLocale}=useContext(Context),path=usePathname(),query=useSearchParams();
  const access=stripLocale(path)==='/manage/access';
  const names={lt:'Kalba',en:'Language',de:'Sprache'};
  return <nav className="language-switcher" aria-label={names[locale]}>{locales.map(next=>{
    const destination=localePath(next,path+(query.size?`?${query}`:''));
    return <a key={next} href={destination} lang={next} hrefLang={next} aria-current={locale===next?'page':undefined} onClick={access?event=>{
      // The access component keeps its token in memory. Never navigate or serialize its fragment.
      event.preventDefault();history.replaceState(null,'',destination);setLocale(next);document.documentElement.lang=next;
      document.cookie=`${localeCookie}=${next}; Path=/; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
    }:undefined}>{languageNames[next]}</a>;
  })}</nav>;
}
