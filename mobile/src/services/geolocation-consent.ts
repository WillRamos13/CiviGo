import type { LocationFix } from '../types';

export class GeolocationError extends Error {
  constructor(message: string, public readonly code?: string | number) {
    super(message); this.name = 'GeolocationError';
  }
}

export function normalizeGeolocationError(value: unknown): GeolocationError {
  if (value instanceof GeolocationError) return value;
  const source = value && typeof value === 'object' ? value as { message?: unknown; code?: unknown } : {};
  let code = typeof source.code === 'string' || typeof source.code === 'number' ? source.code : undefined;
  const originalMessage = typeof source.message === 'string' ? source.message : 'No se pudo obtener la ubicación GPS.';
  // Exact messages from installed @capacitor/geolocation, for older bridge errors without a code.
  if (code === undefined && originalMessage === 'Request to enable location was denied.') code = 'OS-PLUG-GLOC-0009';
  if (code === undefined && originalMessage === 'Location permission request was denied.') code = 'OS-PLUG-GLOC-0003';
  const message = code === 'OS-PLUG-GLOC-0009'
    ? 'No se activó la precisión de ubicación. Pulsa Reintentar GPS para volver a intentarlo.'
    : code === 'OS-PLUG-GLOC-0003' || code === 1
      ? 'Permiso de GPS denegado. Pulsa Reintentar GPS para volver a solicitarlo.'
      : code === 3 || code === 'OS-PLUG-GLOC-0010'
        ? 'El GPS tardó demasiado en obtener tu ubicación. Comprueba la ubicación del dispositivo y pulsa Reintentar GPS.'
        : code === 2 || code === 'OS-PLUG-GLOC-0002'
          ? 'No se pudo obtener tu ubicación. Comprueba la señal GPS e inténtalo de nuevo.'
          : code === 'OS-PLUG-GLOC-0007'
            ? 'Activa la ubicación en los ajustes del dispositivo y pulsa Reintentar GPS.'
            : code === 'OS-PLUG-GLOC-0008'
              ? 'El acceso a la ubicación está restringido. Revisa los permisos de CiviGo en los ajustes del dispositivo.'
              : originalMessage;
  return new GeolocationError(message, code);
}

export function isGeolocationDenial(error: unknown): boolean {
  const code = normalizeGeolocationError(error).code;
  return code === 'OS-PLUG-GLOC-0003' || code === 'OS-PLUG-GLOC-0008' || code === 'OS-PLUG-GLOC-0009' || code === 1;
}

/** A denial is a user decision; temporary GPS failures must remain retryable. */
export class GeolocationAccessPolicy {
  private denied = false;
  private manualInProgress = false;
  private revision = 0;
  private denialListeners = new Set<(error: GeolocationError, revision: number) => void>();
  canWatchAutomatically() { return !this.denied && !this.manualInProgress; }
  currentRevision() { return this.revision; }
  isCurrentRevision(revision: number) { return revision === this.revision; }
  onDenial(listener: (error: GeolocationError, revision: number) => void): () => void {
    this.denialListeners.add(listener);
    return () => { this.denialListeners.delete(listener); };
  }
  beginManualAttempt() { this.revision++; this.denied = false; this.manualInProgress = true; }
  finishManualAttempt() { this.manualInProgress = false; }
  observeError(error: unknown, revision = this.revision): boolean {
    if (!this.isCurrentRevision(revision)) return false;
    if (isGeolocationDenial(error)) {
      this.denied = true;
      const normalized = normalizeGeolocationError(error);
      for (const listener of this.denialListeners) listener(normalized, revision);
    }
    return this.denied;
  }
}

type LocationWatcher = (success: (fix: LocationFix) => void, error: (error: Error) => void) => () => void;

export function watchWithGeolocationConsent(
  policy: GeolocationAccessPolicy,
  register: LocationWatcher,
  onSuccess: (fix: LocationFix) => void,
  onError: (error: GeolocationError) => void
): () => void {
  if (!policy.canWatchAutomatically()) return () => {};
  const revision = policy.currentRevision();
  let closed = false;
  let cleanup: (() => void) | undefined;
  let released = false;
  let unsubscribeDenial = () => {};
  const stop = () => {
    closed = true;
    unsubscribeDenial();
    if (cleanup && !released) { released = true; cleanup(); }
  };
  unsubscribeDenial = policy.onDenial((error, deniedRevision) => {
    if (closed || deniedRevision !== revision || !policy.isCurrentRevision(revision)) return;
    stop(); onError(error);
  });
  const fail = (error: unknown) => {
    if (!policy.isCurrentRevision(revision)) return;
    const wasClosed = closed;
    const normalized = normalizeGeolocationError(error);
    // A permission/settings dialog can finish after the page was suspended.
    // Remember that user decision without sending UI callbacks to a closed view.
    if (isGeolocationDenial(normalized)) {
      // Also close a replacement automatic watch that started on resume before
      // the previous permission dialog delivered its denial.
      policy.observeError(normalized, revision);
      return;
    }
    if (!wasClosed) onError(normalized);
  };
  try {
    cleanup = register((fix) => { if (!closed && policy.isCurrentRevision(revision)) onSuccess(fix); }, fail);
    if (closed) stop(); // A platform may reject synchronously before returning its watch handle.
  } catch (error) { fail(error); }
  return stop;
}
