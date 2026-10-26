'use client';
import Link from 'next/link';
export default function Error({reset}:{reset:()=>void}){return <><h1>Workspace unavailable</h1><p className="notice" role="alert">Access may have changed, or the service could not retrieve current records. Refresh before retrying any action.</p><button onClick={reset}>Try again</button><p><Link href="/admin/signin">Sign in again</Link></p></>;}
