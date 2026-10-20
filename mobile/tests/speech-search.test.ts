import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createSpeechSearchDriver, sanitizeSpeechTranscript, SpeechSearchController, speechSearchError, type DeviceSpeechRecognition, type SpeechSearchDriver } from '../src/services/speechSearch';

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function controlledDriver(externalActivity = true) {
  const operations: { id: string; result: ReturnType<typeof deferred<{ transcript?: unknown; cancelled?: boolean }>> }[] = [];
  const cancelled: string[] = [];
  const driver: SpeechSearchDriver = {
    externalActivity, getCapabilities: async () => ({ available: true, kind: externalActivity ? 'android' : 'web' }),
    recognize(id) { const result = deferred<{ transcript?: unknown; cancelled?: boolean }>(); operations.push({ id, result }); return result.promise; },
    cancel(id) { cancelled.push(id); },
  };
  return { controller: new SpeechSearchController(driver), operations, cancelled };
}
const nativeUnavailable = { getCapabilities: async () => ({ available: false }), recognize: async () => { throw Object.assign(new Error('No recognizer'), { code: 'SPEECH_UNAVAILABLE' }); }, cancel: async () => {} };

test('voice capability checks never start capture and an absent real API stays unavailable', async () => {
  let nativeCalls = 0;
  const web = createSpeechSearchDriver({ platform: () => 'web', native: { ...nativeUnavailable, recognize: async () => { nativeCalls++; return {}; } }, recognition: () => undefined });
  assert.deepEqual(await web.getCapabilities(), { available: false, kind: 'none' });
  await assert.rejects(web.recognize('test'), { code: 'SPEECH_UNAVAILABLE' });
  const android = createSpeechSearchDriver({ platform: () => 'android', native: { ...nativeUnavailable, recognize: async () => { nativeCalls++; return {}; } }, recognition: () => { throw new Error('Android must use its Activity, never browser microphone'); } });
  assert.deepEqual(await android.getCapabilities(), { available: false, kind: 'android' });
  assert.equal(nativeCalls, 0);
  const absentPlugin = createSpeechSearchDriver({ platform: () => 'android', native: { ...nativeUnavailable, getCapabilities: async () => { throw new Error('Missing native plugin'); } }, recognition: () => undefined });
  assert.deepEqual(await absentPlugin.getCapabilities(), { available: false, kind: 'none' });
});

test('closed speech requests settle quietly and late results/rejections cannot replace a new request', async () => {
  const { controller, operations, cancelled } = controlledDriver();
  const first = controller.recognize();
  await assert.rejects(controller.recognize(), { code: 'SPEECH_BUSY' });
  controller.cancel();
  assert.deepEqual(await first, { status: 'cancelled' });
  assert.deepEqual(cancelled, [operations[0].id]);
  const second = controller.recognize();
  operations[0].result.resolve({ transcript: 'Old account private destination' });
  operations[1].result.resolve({ transcript: '  Plaza\n de Armas de Ica\u0000 ' });
  assert.deepEqual(await second, { status: 'recognized', transcript: 'Plaza de Armas de Ica' });
  const third = controller.recognize(); controller.cancel();
  operations[2].result.reject(new Error('Late recognizer failure'));
  assert.deepEqual(await third, { status: 'cancelled' });
  await new Promise(resolve => setImmediate(resolve)); // No unhandled rejection from the obsolete native promise.
});

test('the requested Android Activity survives its own pause while browser capture stops on suspension', async () => {
  const android = controlledDriver(true), web = controlledDriver(false);
  const nativeResult = android.controller.recognize(), browserResult = web.controller.recognize();
  android.controller.suspend(); web.controller.suspend();
  assert.equal(android.cancelled.length, 0);
  assert.equal(web.cancelled.length, 1);
  assert.deepEqual(await browserResult, { status: 'cancelled' });
  android.operations[0].result.resolve({ transcript: 'Universidad Tecnológica del Perú Ica' });
  assert.deepEqual(await nativeResult, { status: 'recognized', transcript: 'Universidad Tecnológica del Perú Ica' });
});

test('empty and cancelled recognizer results never fabricate a destination', async () => {
  const { controller, operations } = controlledDriver();
  const cancelled = controller.recognize(); operations[0].result.resolve({ cancelled: true, transcript: 'Ignored' });
  assert.deepEqual(await cancelled, { status: 'cancelled' });
  for (const transcript of [null, undefined, ' \n\u0000 ']) {
    const result = controller.recognize(); operations[operations.length - 1].result.resolve({ transcript });
    assert.deepEqual(await result, { status: 'empty' });
  }
  assert.equal(sanitizeSpeechTranscript('x'.repeat(300)).length, 160);
  assert.equal(sanitizeSpeechTranscript('  Mercado   San Antonio  '), 'Mercado San Antonio');
});

test('malformed bridge payloads settle with a handled error and release the next explicit attempt', async () => {
  const values: unknown[] = [null, undefined, false, 7, 'Plaza de Ica', [], { transcript: 54 }, { transcript: {} }, { cancelled: 'false', transcript: 'Plaza' }, Object.defineProperty({}, 'transcript', { get() { throw new Error('Malformed property'); } })];
  const pending: ReturnType<typeof deferred<unknown>>[] = [];
  const controller = new SpeechSearchController({
    externalActivity: true, getCapabilities: async () => ({ available: true, kind: 'android' }), cancel() {},
    recognize() { const result = deferred<unknown>(); pending.push(result); return result.promise; },
  });
  for (const value of values) {
    const operation = controller.recognize();
    pending[pending.length - 1].resolve(value);
    await assert.rejects(operation, { code: 'SPEECH_FAILED' });
  }
  const empty = controller.recognize(); pending[pending.length - 1].resolve({});
  assert.deepEqual(await empty, { status: 'empty' });
  const valid = controller.recognize(); pending[pending.length - 1].resolve({ transcript: 'Plaza de Armas de Ica' });
  assert.deepEqual(await valid, { status: 'recognized', transcript: 'Plaza de Armas de Ica' });
  await new Promise(resolve => setImmediate(resolve)); // No detached .then rejection or unsettled caller promise.
});

class BrowserRecognition implements DeviceSpeechRecognition {
  static instances: BrowserRecognition[] = [];
  lang = ''; continuous = true; interimResults = true; maxAlternatives = 0;
  onresult: DeviceSpeechRecognition['onresult'] = null; onerror: DeviceSpeechRecognition['onerror'] = null; onend: DeviceSpeechRecognition['onend'] = null;
  starts = 0; aborts = 0;
  constructor() { BrowserRecognition.instances.push(this); }
  start() { this.starts++; }
  abort() { this.aborts++; this.onerror?.({ error: 'aborted' }); this.onend?.(); }
}
const browserController = () => new SpeechSearchController(createSpeechSearchDriver({ platform: () => 'web', native: nativeUnavailable, recognition: () => BrowserRecognition }));
test('browser recognition is constructed only on a tap and accepts only final returned speech', async () => {
  BrowserRecognition.instances = [];
  const controller = browserController();
  assert.deepEqual(await controller.getCapabilities(), { available: true, kind: 'web' });
  assert.equal(BrowserRecognition.instances.length, 0);
  const result = controller.recognize();
  const recognition = BrowserRecognition.instances[0];
  assert.equal(recognition.starts, 1); assert.equal(recognition.lang, 'es-PE');
  assert.equal(recognition.continuous, false); assert.equal(recognition.interimResults, false);
  recognition.onresult?.({ results: [{ isFinal: false, 0: { transcript: 'Not final' } }] });
  assert.equal(recognition.aborts, 0);
  recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: '  Plaza de Armas de Ica ' } }] });
  assert.deepEqual(await result, { status: 'recognized', transcript: 'Plaza de Armas de Ica' });
  assert.equal(recognition.aborts, 1); assert.equal(recognition.onresult, null); assert.equal(recognition.onerror, null); assert.equal(recognition.onend, null);
});

test('browser cancellation clears handlers before abort and denial does not auto-retry', async () => {
  const controller = browserController();
  const result = controller.recognize(); const recognition = BrowserRecognition.instances[BrowserRecognition.instances.length - 1];
  const stale = recognition.onresult!; controller.cancel();
  assert.deepEqual(await result, { status: 'cancelled' }); assert.equal(recognition.aborts, 1);
  stale({ results: [{ 0: { transcript: 'Late' }, isFinal: true }] });
  const denied = controller.recognize(); const denial = BrowserRecognition.instances[BrowserRecognition.instances.length - 1];
  denial.onerror?.({ error: 'not-allowed' });
  await assert.rejects(denied, { code: 'SPEECH_DENIED' }); assert.equal(denial.starts, 1);
  assert.match(speechSearchError({ code: 'SPEECH_DENIED' }), /permisos/);
  const silence = controller.recognize(); BrowserRecognition.instances[BrowserRecognition.instances.length - 1].onerror?.({ error: 'no-speech' });
  assert.deepEqual(await silence, { status: 'empty' });
  const ended = controller.recognize(); BrowserRecognition.instances[BrowserRecognition.instances.length - 1].onend?.();
  assert.deepEqual(await ended, { status: 'empty' });
});

const executablePath = [process.env.CIVIGO_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', chromium.executablePath()].find((path): path is string => Boolean(path && existsSync(path)));
async function speechHarness(available = true) {
  const replacements: Record<string, string> = {
    '@capacitor/core': `export const Capacitor = { getPlatform: () => 'android' }; export const registerPlugin = () => new Proxy({}, { get: (_, key) => (...args) => window.nativeSpeech[key](...args) });`,
    '@capacitor/preferences': `export const Preferences = { get: async () => ({ value: null }), set: async () => {} };`,
    './api': `export const api = async path => { window.searches.push(path); return []; }; export const post = async () => ({}); export const del = async () => {}; export const distance = () => 0; export const errorMessage = error => error.message;`,
    'services/api': `export const errorMessage = error => error.message;`,
  };
  const bundle = await build({
    stdin: { contents: `import React, { useState } from 'react'; import { createRoot } from 'react-dom/client'; import { DestinationExplorer } from './src/components/navigation/DestinationExplorer';
      window.searches = []; window.requests = []; window.cancelledSpeech = [];
      window.nativeSpeech = { getCapabilities: async () => ({ available: ${available} }), recognize: options => new Promise((resolve, reject) => window.requests.push({ ...options, resolve, reject })), cancel: async options => { window.cancelledSpeech.push(options.requestId); } };
      function Test() { const [open, setOpen] = useState(true), [suspended, setSuspended] = useState(false), [owner, setOwner] = useState(7); window.setOpen = setOpen; window.setSuspended = setSuspended; window.setOwner = setOwner;
        return <><button onClick={() => setOpen(true)}>Abrir búsqueda</button><DestinationExplorer open={open} suspended={suspended} ownerId={owner} onClose={() => setOpen(false)} onChooseDestination={() => { throw new Error('Voice must not start a route'); }} /></>; }
      createRoot(document.getElementById('root')).render(<Test />);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'error', loader: { '.css': 'empty' },
    plugins: [{ name: 'speech-environment', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => { const key = Object.keys(replacements).find(key => args.path.endsWith(key)); if (key) return { path: key, namespace: 'fixture' }; });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: replacements[args.path], loader: 'tsx' }));
    } }],
  });
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 740 } }); page.setDefaultTimeout(3000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return { browser, page, errors };
}

test('real destination dialog retains Android speech through system pause but invalidates closed/account/edited text', { skip: !executablePath && 'Requires local Chromium', timeout: 15000 }, async () => {
  const { browser, page, errors } = await speechHarness();
  try {
    const mic = () => page.getByRole('button', { name: 'Buscar destino por voz', exact: true });
    const input = () => page.getByRole('searchbox', { name: 'Buscar lugares en Ica' });
    await mic().waitFor(); assert.equal(await page.evaluate(() => (window as any).requests.length), 0);
    await mic().click(); await page.waitForFunction(() => (window as any).requests.length === 1);
    await page.evaluate(() => (window as any).setSuspended(true)); await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => (window as any).cancelledSpeech.length), 0);
    await page.evaluate(() => (window as any).requests[0].resolve({ transcript: '  Plaza\n de Armas de Ica  ' }));
    await page.waitForTimeout(450); assert.equal(await page.evaluate(() => (window as any).searches.length), 0, 'no HTTP search while background/system Activity is in front');
    await page.evaluate(() => (window as any).setSuspended(false)); await input().waitFor();
    assert.equal(await input().inputValue(), 'Plaza de Armas de Ica');
    await page.waitForFunction(() => (window as any).searches.length === 1);
    assert.match(await page.evaluate(() => (window as any).searches[0]), /Plaza/);

    await mic().click(); await page.waitForFunction(() => (window as any).requests.length === 2);
    await page.getByRole('button', { name: 'Cerrar búsqueda', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir búsqueda', exact: true }).click();
    await page.evaluate(() => (window as any).requests[1].resolve({ transcript: 'Closed private request' }));
    await page.waitForTimeout(25); assert.equal(await input().inputValue(), 'Plaza de Armas de Ica');

    await mic().click(); await page.waitForFunction(() => (window as any).requests.length === 3);
    await page.evaluate(() => (window as any).setOwner(8)); await mic().waitFor();
    await page.evaluate(() => (window as any).requests[2].resolve({ transcript: 'Previous account private address' }));
    await page.waitForTimeout(25); assert.equal(await input().inputValue(), '');

    await mic().click(); await page.waitForFunction(() => (window as any).requests.length === 4);
    await input().fill('Destino escrito por el usuario');
    await page.evaluate(() => (window as any).requests[3].resolve({ transcript: 'Must not overwrite typing' }));
    await page.waitForTimeout(25); assert.equal(await input().inputValue(), 'Destino escrito por el usuario');
    assert.equal(await page.evaluate(() => (window as any).cancelledSpeech.length), 3);
    await mic().click(); await page.waitForFunction(() => (window as any).requests.length === 5);
    await page.evaluate(() => (window as any).requests[4].resolve({ cancelled: true }));
    await mic().waitFor(); assert.equal(await page.getByRole('alert').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('destination dialog does not offer fake voice or request permissions without an available recognizer', { skip: !executablePath && 'Requires local Chromium', timeout: 10000 }, async () => {
  const { browser, page, errors } = await speechHarness(false);
  try {
    await page.getByRole('searchbox', { name: 'Buscar lugares en Ica' }).waitFor();
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole('button', { name: 'Buscar destino por voz', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => (window as any).requests.length), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
