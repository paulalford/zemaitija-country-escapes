export type ShutdownObservation='PENDING_EXTERNAL_SUPERVISION'|'SETTLED'|'FAILED';
/** A watchdog observation, never a cancellation deadline. The returned promise
 * settles only when end() actually settles. A stuck driver requires a supervisor
 * to preserve evidence, inspect server sessions and decide what to terminate. */
export async function observePoolShutdown(end:()=>Promise<void>,
  observe:(state:ShutdownObservation)=>void=()=>{},graceMilliseconds=1000):Promise<void> {
  if(!Number.isSafeInteger(graceMilliseconds) || graceMilliseconds<1)throw Error('INVALID_CLEANUP_GRACE');
  const report=(state:ShutdownObservation)=>{try {observe(state);}catch {/* Reporting cannot abandon settlement. */}};
  const timer=setTimeout(()=>report('PENDING_EXTERNAL_SUPERVISION'),graceMilliseconds);
  timer.unref?.();
  try {await end();report('SETTLED');}catch(error){report('FAILED');throw error;}
  finally {clearTimeout(timer);}
}
