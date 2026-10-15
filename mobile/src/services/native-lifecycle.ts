/** Dispose handles even when a native registration finishes after unmount. */
export function subscribeAsync(
  register: (isActive: () => boolean) => Promise<() => void | Promise<void>>,
  onError?: (error: unknown) => void,
): () => void {
  let active = true;
  let cleanup: (() => void | Promise<void>) | undefined;
  const release = (fn: () => void | Promise<void>) => {
    try { void Promise.resolve(fn()).catch(error => { if (active) onError?.(error); }); }
    catch (error) { if (active) onError?.(error); }
  };
  void Promise.resolve().then(() => register(() => active)).then(fn => {
    if (active) cleanup = fn;
    else release(fn);
  }).catch(error => { if (active) onError?.(error); });
  return () => {
    active = false;
    const fn = cleanup;
    cleanup = undefined;
    if (fn) release(fn);
  };
}
