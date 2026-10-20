import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserNavigationVoiceDriver, NavigationVoiceController,
  type BrowserNavigationVoiceRuntime } from '../src/services/navigationVoice';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('navigation voice normalizes instructions and sends speech only to the selected driver', async () => {
  const spoken: string[] = [];
  const voice = new NavigationVoiceController({ supported: () => true,
    speak: async text => { spoken.push(text); }, stop: async () => {} });
  await voice.speak('  En 100 metros,\n gira a la derecha.  ');
  assert.deepEqual(spoken, ['En 100 metros, gira a la derecha.']);
  for (const text of ['', '\u0000\t', 'a'.repeat(1001)]) await assert.rejects(voice.speak(text), /no es válida/);
  assert.equal(spoken.length, 1);
});

test('mute or finish cancels an instruction waiting for native engine cleanup', async () => {
  const cleanup = deferred();
  const spoken: string[] = [];
  const voice = new NavigationVoiceController({ supported: () => true,
    speak: async text => { spoken.push(text); }, stop: () => cleanup.promise });
  const stopping = voice.stop();
  const obsolete = voice.speak('Gira a la izquierda');
  const muted = voice.stop();
  cleanup.resolve();
  await Promise.all([stopping, obsolete, muted]);
  assert.deepEqual(spoken, []);
  await voice.speak('Continúa por la avenida');
  assert.deepEqual(spoken, ['Continúa por la avenida']);
});

test('only the newest queued direction is spoken after native cleanup', async () => {
  const cleanup = deferred();
  const spoken: string[] = [];
  const voice = new NavigationVoiceController({ supported: () => true,
    speak: async text => { spoken.push(text); }, stop: () => cleanup.promise });
  const stopping = voice.stop();
  const old = voice.speak('En 500 metros gira a la derecha');
  const next = voice.speak('En 50 metros gira a la derecha');
  cleanup.resolve();
  await Promise.all([stopping, old, next]);
  assert.deepEqual(spoken, ['En 50 metros gira a la derecha']);
});

test('a missing or failed speech engine reports failure and cleanup remains usable', async () => {
  let sent = 0, supported = false;
  const voice = new NavigationVoiceController({ supported: () => supported,
    speak: async () => { sent++; throw Object.assign(new Error('Voz española no instalada'), { code: 'VOICE_LANGUAGE_UNAVAILABLE' }); },
    stop: async () => {} });
  await assert.rejects(voice.speak('Continúa'), /no está disponible/);
  assert.equal(sent, 0);
  supported = true;
  await assert.rejects(voice.speak('Continúa'), { code: 'VOICE_LANGUAGE_UNAVAILABLE' });
  await voice.stop();
  assert.equal(sent, 1);
});

function browserHarness(options: Partial<BrowserNavigationVoiceRuntime> = {}) {
  type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
  let sequence = 0, cancellations = 0;
  const created: SpeechSynthesisUtterance[] = [], spoken: SpeechSynthesisUtterance[] = [];
  const timers = new Map<TimerHandle, { callback(): void; milliseconds: number }>();
  const callbacks: Array<() => void> = [];
  const voices = [
    { lang: 'en-US', localService: true },
    { lang: 'es-ES', localService: true },
    { lang: 'es-PE', localService: true },
  ] as SpeechSynthesisVoice[];
  const speech = {
    speak(utterance: SpeechSynthesisUtterance) { spoken.push(utterance); },
    cancel() { cancellations++; },
    getVoices: () => voices,
  };
  const driver = createBrowserNavigationVoiceDriver({
    speech: () => speech,
    available: () => true,
    utterance: text => {
      const utterance = { text, onend: null, onerror: null } as unknown as SpeechSynthesisUtterance;
      created.push(utterance);
      return utterance;
    },
    timeoutMs: 50,
    setTimer: (callback, milliseconds) => {
      const timer = ++sequence as unknown as TimerHandle;
      timers.set(timer, { callback, milliseconds });
      callbacks.push(callback);
      return timer;
    },
    clearTimer: timer => { timers.delete(timer); },
    ...options,
  });
  const end = (utterance = spoken.at(-1)!) => utterance.onend?.call(utterance, {} as SpeechSynthesisEvent);
  const error = (code: string, utterance = spoken.at(-1)!) => utterance.onerror?.call(utterance,
    { error: code } as SpeechSynthesisErrorEvent);
  return { driver, speech, created, spoken, timers, callbacks, voices, end, error,
    cancellations: () => cancellations };
}

test('browser voice waits for the actual end event and releases callbacks and deadline', async () => {
  const browser = browserHarness();
  let finished = false;
  const speaking = browser.driver.speak('En 100 metros gira a la derecha').then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, 'enqueueing speech does not mean playback completed');
  assert.equal(browser.spoken.length, 1);
  const utterance = browser.spoken[0];
  assert.equal(utterance.lang, 'es-PE');
  assert.equal(utterance.rate, 1);
  assert.equal(utterance.voice, browser.voices[2]);
  assert.deepEqual([...browser.timers.values()].map(timer => timer.milliseconds), [50]);
  browser.end();
  await speaking;
  assert.equal(finished, true);
  assert.equal(browser.timers.size, 0);
  assert.equal(utterance.onend, null);
  assert.equal(utterance.onerror, null);
});

test('browser synthesis errors reject instead of reporting a successful indication', async () => {
  const browser = browserHarness();
  for (const error of ['synthesis-failed', 'not-allowed', 'canceled', 'interrupted']) {
    const speaking = browser.driver.speak('Continúa por la avenida');
    const rejected = assert.rejects(speaking, {
      code: error === 'canceled' || error === 'interrupted' ? 'SPEECH_CANCELLED' : 'VOICE_UNAVAILABLE',
    });
    browser.error(error);
    await rejected;
    assert.equal(browser.timers.size, 0);
    assert.equal(browser.spoken.at(-1)!.onerror, null);
    assert.equal(browser.spoken.at(-1)!.onend, null);
  }
  const retry = browser.driver.speak('Sigue recto');
  browser.end();
  await retry;
});

test('an engine which never ends is timed out and the next indication remains usable', async () => {
  const browser = browserHarness();
  const speaking = browser.driver.speak('Gira a la izquierda');
  const rejected = assert.rejects(speaking, { code: 'VOICE_TIMEOUT' });
  const cancellations = browser.cancellations();
  browser.callbacks[0]();
  await rejected;
  assert.equal(browser.cancellations(), cancellations + 1);
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.spoken[0].onerror, null);
  const retry = browser.driver.speak('Continúa');
  browser.end();
  await retry;
});

test('mute settles speech even when the browser emits no cancellation event', async () => {
  const browser = browserHarness();
  const speaking = browser.driver.speak('En 50 metros gira');
  const rejected = assert.rejects(speaking, { code: 'SPEECH_CANCELLED' });
  await browser.driver.stop();
  await rejected;
  await browser.driver.stop();
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.spoken[0].onend, null);
  assert.equal(browser.spoken[0].onerror, null);
});

test('new speech replaces the previous indication and ignores late events and timers', async () => {
  const browser = browserHarness();
  const old = browser.driver.speak('En 500 metros gira');
  const oldRejected = assert.rejects(old, { code: 'SPEECH_CANCELLED' });
  const obsoleteEnd = browser.spoken[0].onend!;
  const obsoleteError = browser.spoken[0].onerror!;
  const current = browser.driver.speak('Gira ahora');
  await oldRejected;
  const cancellations = browser.cancellations();
  obsoleteEnd.call(browser.spoken[0], {} as SpeechSynthesisEvent);
  obsoleteError.call(browser.spoken[0], { error: 'synthesis-failed' } as SpeechSynthesisErrorEvent);
  browser.callbacks[0]();
  assert.equal(browser.cancellations(), cancellations, 'an old deadline cannot stop current speech');
  assert.equal(browser.timers.size, 1);
  assert.equal(typeof browser.spoken[1].onend, 'function');
  browser.end();
  await current;
  assert.equal(browser.timers.size, 0);
});

test('browser and controller do not enqueue stale speech after same-tick mute or finish', async () => {
  const browser = browserHarness();
  const voice = new NavigationVoiceController(browser.driver);
  const obsolete = voice.speak('No debe sonar');
  await voice.stop();
  await obsolete;
  assert.equal(browser.spoken.length, 0);
  const current = voice.speak('Gira a la derecha');
  const rejected = assert.rejects(current, { code: 'SPEECH_CANCELLED' });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(browser.spoken.length, 1);
  await voice.stop();
  await rejected;
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.spoken.length, 1);
});

test('missing or synchronously failing browser speech remains a controlled failure', async () => {
  const absent = browserHarness({ speech: () => undefined });
  assert.equal(absent.driver.supported(), false);
  await assert.rejects(absent.driver.speak('Continúa'), { code: 'VOICE_UNAVAILABLE' });
  const noUtterance = browserHarness({ available: () => false });
  assert.equal(noUtterance.driver.supported(), false);
  await assert.rejects(noUtterance.driver.speak('Continúa'), { code: 'VOICE_UNAVAILABLE' });
  for (const method of ['speak', 'getVoices'] as const) {
    const browser = browserHarness();
    browser.speech[method] = () => { throw new Error('Browser internal failure'); };
    await assert.rejects(browser.driver.speak('Continúa'), { code: 'VOICE_UNAVAILABLE' });
    assert.equal(browser.timers.size, 0);
    assert.equal(browser.created[0].onend, null);
    assert.equal(browser.created[0].onerror, null);
  }
});
