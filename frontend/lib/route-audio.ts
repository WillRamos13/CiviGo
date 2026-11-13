const pending = new Set<symbol>();
const guards=new Set<()=>Promise<boolean>>();
export const ROUTE_VOICE_EVENT = 'civigo:route-voice';
export function registerRouteAudioGuard(guard:()=>Promise<boolean>){guards.add(guard);return()=>{guards.delete(guard);};}

// Only a boolean is shared. Instructions and GPS never leave the navigation hook.
export function beginRouteVoice(): (() => void)&{ready:Promise<boolean>} {
  const id = Symbol(); pending.add(id);
  window.dispatchEvent(new CustomEvent(ROUTE_VOICE_EVENT, { detail: true }));
  const release = () => {
    if (!pending.delete(id)) return;
    if (!pending.size) window.dispatchEvent(new CustomEvent(ROUTE_VOICE_EVENT, { detail: false }));
  };
  return Object.assign(release,{ready:Promise.allSettled([...guards].map(guard=>Promise.resolve().then(guard))).then(results=>results.every(result=>result.status==='fulfilled'&&result.value===true))});
}
