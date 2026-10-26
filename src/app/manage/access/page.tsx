'use client';
import { useEffect, useRef, useState } from 'react';
export default function GuestAccess() {
  const initialized=useRef(false);const token=useRef('');const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(initialized.current)return;initialized.current=true;token.current=location.hash.slice(1);history.replaceState(null,'','/manage/access');setReady(/^[A-Za-z0-9_-]{43}$/.test(token.current));},[]);
  async function exchange() {
    setBusy(true);setError('');
    try {
      const r=await fetch('/api/access/guest/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token.current})});
      if(!r.ok){setError(r.status===429?'Please wait before trying again.':'This link is unavailable or has expired. Ask the operator for a fresh sandbox link.');setBusy(false);return;}
      token.current='';location.replace('/manage');
    }catch{setError('The connection failed. Try again when the connection is available.');setBusy(false);}
  }
  return <div className="access-panel"><h1>Manage your reservation</h1><p>Open the secure link delivered through the sandbox notification workflow. Each link can be used once and expires after 15 minutes.</p>
    {ready?<button onClick={exchange} disabled={busy}>{busy?'Opening reservation…':'Open my reservation'}</button>:<p className="notice">Open a fresh manage-booking link to continue. If your session has expired, ask the operator to queue another sandbox link.</p>}
    {error&&<p role="alert" className="notice notice-error">{error}</p>}
    <p className="muted">Reservation details are available only after the link is verified.</p></div>;
}
