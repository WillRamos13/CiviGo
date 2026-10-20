import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeNavigationVoice {
  speak(options: { text: string }): Promise<void>;
  stop(): Promise<void>;
}
const nativeVoice = registerPlugin<NativeNavigationVoice>('NavigationVoice');

export interface NavigationVoiceDriver {
  supported(): boolean;
  speak(text: string): Promise<void>;
  stop(): Promise<void>;
}

/** A mute/finish wins over speech waiting for a previous stop to complete. */
export class NavigationVoiceController {
  private revision = 0;
  private stopping: Promise<void> = Promise.resolve();
  constructor(private driver: NavigationVoiceDriver) {}
  supported() { return this.driver.supported(); }
  async speak(text: string): Promise<void> {
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > 1000) throw new Error('La indicación de voz no es válida.');
    if (!this.supported()) throw new Error('La voz no está disponible en este dispositivo.');
    const owned = ++this.revision;
    await this.stopping;
    if (owned !== this.revision) return;
    await this.driver.speak(clean);
  }
  stop(): Promise<void> {
    this.revision++;
    const previous = this.stopping;
    // Dispatch immediately, including when native TTS is still initializing.
    const current = Promise.resolve().then(() => this.driver.stop());
    this.stopping = Promise.allSettled([previous, current]).then(() => {});
    return current;
  }
}

type BrowserSpeech = Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>;
type SpeechTimer = ReturnType<typeof globalThis.setTimeout>;
export interface BrowserNavigationVoiceRuntime {
  speech(): BrowserSpeech | undefined;
  utterance(text: string): SpeechSynthesisUtterance;
  available(): boolean;
  setTimer(callback: () => void, milliseconds: number): SpeechTimer;
  clearTimer(timer: SpeechTimer): void;
  timeoutMs: number;
}
const speechFailure = (message: string, code: string) => Object.assign(new Error(message), { code });
const speechCancelled = () => speechFailure('Indicación de voz cancelada.', 'SPEECH_CANCELLED');

/** Browser cancellation does not consistently emit an utterance event. Own its
 * promise, callbacks and deadline so mute/finish always settle pending speech. */
export function createBrowserNavigationVoiceDriver(options: Partial<BrowserNavigationVoiceRuntime> = {}): NavigationVoiceDriver {
  const runtime: BrowserNavigationVoiceRuntime = {
    speech: () => typeof window !== 'undefined' ? window.speechSynthesis : undefined,
    utterance: text => new SpeechSynthesisUtterance(text),
    available: () => Boolean(options.utterance) || typeof SpeechSynthesisUtterance !== 'undefined',
    setTimer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clearTimer: timer => globalThis.clearTimeout(timer),
    timeoutMs: 60000,
    ...options,
  };
  const timeoutMs = Number.isFinite(runtime.timeoutMs) && runtime.timeoutMs > 0
    ? Math.min(120000, runtime.timeoutMs) : 60000;
  let revision = 0;
  let active: { speech: BrowserSpeech; finish(error?: Error): void } | null = null;
  const supported = () => {
    try {
      const speech = runtime.speech();
      return runtime.available() && typeof speech?.speak === 'function' && typeof speech.cancel === 'function';
    } catch { return false; }
  };
  const cancelActive = () => {
    const current = active;
    // Settle before cancel: some engines emit a synchronous cancellation error;
    // others emit nothing. Neither path may leave an old promise waiting.
    current?.finish(speechCancelled());
    try { (current?.speech || runtime.speech())?.cancel(); }
    catch { throw speechFailure('No se pudo detener la voz del dispositivo.', 'VOICE_UNAVAILABLE'); }
  };
  const stop = async () => { revision++; cancelActive(); };
  return {
    supported,
    stop,
    speak: async text => {
      const owned = ++revision;
      cancelActive();
      if (!supported()) throw speechFailure('La voz no está disponible en este dispositivo.', 'VOICE_UNAVAILABLE');
      const speech = runtime.speech()!;
      let utterance: SpeechSynthesisUtterance;
      try { utterance = runtime.utterance(text); }
      catch { throw speechFailure('No se pudo preparar la indicación de voz.', 'VOICE_UNAVAILABLE'); }
      if (owned !== revision) throw speechCancelled();
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        let timer: SpeechTimer | undefined;
        const job = { speech, finish: (error?: Error) => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) try { runtime.clearTimer(timer); } catch { /* Always settle the owned promise. */ }
          utterance.onend = null;
          utterance.onerror = null;
          if (active === job) active = null;
          if (error) reject(error); else resolve();
        } };
        active = job;
        utterance.onend = () => job.finish();
        utterance.onerror = event => job.finish(event.error === 'canceled' || event.error === 'interrupted'
          ? speechCancelled() : speechFailure('No se pudo reproducir la indicación de voz.', 'VOICE_UNAVAILABLE'));
        try {
          timer = runtime.setTimer(() => {
            if (settled || active !== job) return;
            job.finish(speechFailure('El dispositivo no completó la indicación de voz.', 'VOICE_TIMEOUT'));
            try { speech.cancel(); } catch { /* The pending promise has already settled. */ }
          }, timeoutMs);
          utterance.lang = 'es-PE';
          utterance.rate = 1;
          const voices = speech.getVoices();
          const spanish = voices.find(voice => voice.lang.toLowerCase() === 'es-pe')
            || voices.find(voice => /^es(?:-|$)/i.test(voice.lang) && voice.localService)
            || voices.find(voice => /^es(?:-|$)/i.test(voice.lang));
          if (spanish) utterance.voice = spanish;
          if (!settled && owned === revision) speech.speak(utterance);
        } catch {
          job.finish(speechFailure('No se pudo reproducir la indicación de voz.', 'VOICE_UNAVAILABLE'));
          try { speech.cancel(); } catch { /* Cleanup must not mask the controlled error. */ }
        }
      });
    },
  };
}

const browserVoice = createBrowserNavigationVoiceDriver();
const driver: NavigationVoiceDriver = {
  supported: () => Capacitor.getPlatform() === 'android' ? Capacitor.isPluginAvailable('NavigationVoice') : browserVoice.supported(),
  speak: text => Capacitor.getPlatform() === 'android' ? nativeVoice.speak({ text }) : browserVoice.speak(text),
  stop: async () => {
    if (Capacitor.getPlatform() === 'android') {
      if (Capacitor.isPluginAvailable('NavigationVoice')) await nativeVoice.stop();
    } else await browserVoice.stop();
  },
};
const voice = new NavigationVoiceController(driver);
export const navigationVoiceSupported = () => voice.supported();
export const speakNavigation = (text: string) => voice.speak(text);
export const stopNavigationVoice = () => voice.stop();
