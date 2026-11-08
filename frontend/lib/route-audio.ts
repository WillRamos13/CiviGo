const pending = new Set<symbol>();
export const ROUTE_VOICE_EVENT = 'civigo:route-voice';

// Only a boolean is shared. Instructions and GPS never leave the navigation hook.
export function beginRouteVoice(): () => void {
  const id = Symbol(); pending.add(id);
  window.dispatchEvent(new CustomEvent(ROUTE_VOICE_EVENT, { detail: true }));
  return () => {
    if (!pending.delete(id)) return;
    if (!pending.size) window.dispatchEvent(new CustomEvent(ROUTE_VOICE_EVENT, { detail: false }));
  };
}
