'use client';
import Link from 'next/link';
export default function Error({reset}:{reset:()=>void}){return <><h1>Reservation unavailable</h1><p className="notice" role="alert">Your session may have expired, or the service could not retrieve the latest records. Refresh before retrying any action.</p><button onClick={reset}>Try again</button><p><Link href="/manage/access">Open a fresh access link</Link></p></>;}
