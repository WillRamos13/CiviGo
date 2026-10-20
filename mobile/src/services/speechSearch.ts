import { Capacitor, registerPlugin } from '@capacitor/core';

export type SpeechSearchCapability = { available: boolean; kind: 'android' | 'web' | 'none' };
export type SpeechSearchResult = { status: 'recognized'; transcript: string } | { status: 'cancelled' | 'empty' };
type RawResult = { cancelled?: boolean; transcript?: unknown };
interface NativeSpeechSearch {
  getCapabilities(): Promise<{ available: boolean }>;
  recognize(options: { requestId: string }): Promise<unknown>;
  cancel(options: { requestId: string }): Promise<void>;
}

interface SpeechAlternative { transcript?: unknown }
interface SpeechResult { isFinal?: boolean; 0?: SpeechAlternative }
interface RecognitionEvent { resultIndex?: number; results?: ArrayLike<SpeechResult> }
export interface DeviceSpeechRecognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; abort(): void;
}
type RecognitionConstructor = new () => DeviceSpeechRecognition;
export interface SpeechSearchDriver {
  readonly externalActivity: boolean;
  getCapabilities(): Promise<SpeechSearchCapability>;
  recognize(requestId: string): Promise<unknown>;
  cancel(requestId: string): void | Promise<void>;
}

const NativeSpeech = registerPlugin<NativeSpeechSearch>('SpeechSearch');
const unavailable = () => Object.assign(new Error('La búsqueda por voz no está disponible en este dispositivo.'), { code: 'SPEECH_UNAVAILABLE' });
const failure = (code = 'SPEECH_FAILED') => Object.assign(new Error('No se pudo reconocer la voz. Inténtalo de nuevo o escribe el destino.'), { code });

/** Keep only the actual transcript, bounded like the destination text field. */
export function sanitizeSpeechTranscript(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) : '';
}

export function createSpeechSearchDriver(environment: {
  platform: () => string;
  native: NativeSpeechSearch;
  recognition: () => RecognitionConstructor | undefined;
}): SpeechSearchDriver {
  if (environment.platform() === 'android') return {
    externalActivity: true,
    async getCapabilities() {
      try { return { available: (await environment.native.getCapabilities()).available === true, kind: 'android' }; }
      catch { return { available: false, kind: 'none' }; }
    },
    recognize: requestId => environment.native.recognize({ requestId }),
    cancel: requestId => environment.native.cancel({ requestId }),
  };

  let active: { id: string; cancel: () => void } | null = null;
  return {
    externalActivity: false,
    async getCapabilities() { return { available: Boolean(environment.recognition()), kind: environment.recognition() ? 'web' : 'none' }; },
    recognize(requestId) {
      const Constructor = environment.recognition();
      if (!Constructor) return Promise.reject(unavailable());
      if (active) return Promise.reject(failure('SPEECH_BUSY'));
      return new Promise<RawResult>((resolve, reject) => {
        const recognition = new Constructor();
        let settled = false;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const finish = (result: RawResult | null, error?: Error) => {
          if (settled) return;
          settled = true; clearTimeout(deadline);
          recognition.onresult = null; recognition.onerror = null; recognition.onend = null;
          if (active?.id === requestId) active = null;
          try { recognition.abort(); } catch { /* An ended recognizer needs no further cleanup. */ }
          if (error) reject(error); else resolve(result ?? { cancelled: true });
        };
        active = { id: requestId, cancel: () => finish({ cancelled: true }) };
        recognition.lang = 'es-PE'; recognition.continuous = false; recognition.interimResults = false; recognition.maxAlternatives = 1;
        recognition.onresult = event => {
          const results = event.results;
          if (!results) return;
          for (let index = event.resultIndex ?? 0; index < results.length; index++) {
            if (results[index]?.isFinal === false) continue;
            finish({ transcript: results[index]?.[0]?.transcript }); return;
          }
        };
        recognition.onerror = event => {
          if (event.error === 'aborted') finish({ cancelled: true });
          else if (event.error === 'no-speech') finish({ transcript: '' });
          else finish(null, failure(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'SPEECH_DENIED' : 'SPEECH_FAILED'));
        };
        recognition.onend = () => finish({ transcript: '' });
        deadline = setTimeout(() => finish(null, failure('SPEECH_TIMEOUT')), 20000);
        try { recognition.start(); } catch { finish(null, failure()); }
      });
    },
    cancel(requestId) { if (active?.id === requestId) active.cancel(); },
  };
}

let requestSequence = 0;
/** A closed dialog/previous account never receives a late system response. */
export class SpeechSearchController {
  private active: { id: string; cancel: () => void } | null = null;
  constructor(private readonly driver: SpeechSearchDriver = createSpeechSearchDriver({
    platform: () => Capacitor.getPlatform(), native: NativeSpeech,
    recognition: () => typeof window === 'undefined' ? undefined : ((window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition),
  })) {}
  getCapabilities() { return this.driver.getCapabilities(); }
  get usesExternalActivity() { return this.driver.externalActivity; }
  recognize(): Promise<SpeechSearchResult> {
    if (this.active) return Promise.reject(failure('SPEECH_BUSY'));
    const id = `speech-${Date.now()}-${++requestSequence}`;
    return new Promise((resolve, reject) => {
      const request = { id, cancel: () => resolve({ status: 'cancelled' } as SpeechSearchResult) };
      this.active = request;
      // The driver is called synchronously inside the explicit tap, preserving browser user activation.
      let operation: Promise<unknown>;
      try { operation = this.driver.recognize(id); }
      catch (error) { this.active = null; reject(error); return; }
      void Promise.resolve(operation).then(result => {
        if (this.active !== request) return;
        this.active = null;
        try {
          if (!result || typeof result !== 'object' || Array.isArray(result)) throw failure();
          const payload = result as RawResult;
          if (payload.cancelled !== undefined && typeof payload.cancelled !== 'boolean') throw failure();
          if (payload.transcript !== undefined && payload.transcript !== null && typeof payload.transcript !== 'string') throw failure();
          const transcript = sanitizeSpeechTranscript(payload.transcript);
          resolve(payload.cancelled === true ? { status: 'cancelled' } : transcript ? { status: 'recognized', transcript } : { status: 'empty' });
        } catch { reject(failure()); }
      }, error => {
        if (this.active !== request) return;
        this.active = null; reject(error);
      });
    });
  }
  cancel() {
    const prior = this.active;
    this.active = null;
    if (!prior) return;
    prior.cancel();
    try { void Promise.resolve(this.driver.cancel(prior.id)).catch(() => {}); } catch { /* The stale result remains ignored. */ }
  }
  /** Android's own speech Activity pauses our Activity; let that requested result return. */
  suspend() { if (!this.driver.externalActivity) this.cancel(); }
}

export function speechSearchError(reason: unknown): string {
  const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : '';
  if (code === 'SPEECH_UNAVAILABLE' || code === 'UNIMPLEMENTED') return 'La búsqueda por voz no está disponible. Puedes escribir el destino.';
  if (code === 'SPEECH_DENIED') return 'El reconocedor no tiene acceso al micrófono. Puedes escribir el destino o revisar sus permisos.';
  if (code === 'SPEECH_BUSY') return 'Termina o cancela la búsqueda por voz abierta antes de comenzar otra.';
  return 'No se pudo reconocer la voz. Inténtalo de nuevo o escribe el destino.';
}
