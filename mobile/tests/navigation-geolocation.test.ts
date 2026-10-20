import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeolocationAccessPolicy, normalizeGeolocationError, watchWithGeolocationConsent } from '../src/services/geolocation-consent';
import { getCurrentDevicePosition, watchDevicePosition } from '../src/services/native';
import type { LocationFix } from '../src/types';
import { build } from 'esbuild';

const fix: LocationFix = { latitud: -14.0678, longitud: -75.7286, accuracy: 10, timestamp: 100000 };

test('GPS failures keep their retry semantics while displaying Spanish instructions', () => {
  for (const code of [3, 'OS-PLUG-GLOC-0010']) {
    const failure = normalizeGeolocationError({ code, message: 'Timeout expired' });
    assert.match(failure.message, /GPS tardó demasiado/);
    assert.equal(failure.code, code);
    const policy = new GeolocationAccessPolicy();
    policy.observeError(failure);
    assert.equal(policy.canWatchAutomatically(), true);
  }
  assert.match(normalizeGeolocationError({ code: 2, message: 'Position unavailable' }).message, /No se pudo obtener tu ubicación/);
  assert.match(normalizeGeolocationError({ code: 'OS-PLUG-GLOC-0007', message: 'Disabled' }).message, /Activa la ubicación/);
});

test('Android accuracy refusal stops its watcher and hiding/returning never reprompts automatically', () => {
  const policy = new GeolocationAccessPolicy();
  let starts = 0, stops = 0, successes = 0;
  let fail: (error: Error) => void = () => {};
  let deliver: (position: LocationFix) => void = () => {};
  const register = (onSuccess: (position: LocationFix) => void, onError: (error: Error) => void) => {
    starts++; fail = onError; deliver = onSuccess; return () => { stops++; };
  };
  const stop = watchWithGeolocationConsent(policy, register, () => successes++, () => {});
  fail(normalizeGeolocationError({ code: 'OS-PLUG-GLOC-0009', message: 'Request to enable location was denied.' }));
  assert.equal(stops, 1);
  deliver(fix);
  assert.equal(successes, 0, 'old native watcher cannot deliver fixes after refusal');
  stop();
  watchWithGeolocationConsent(policy, register, () => successes++, () => {});
  assert.equal(starts, 1, 'returning to the same map cannot reopen the Android accuracy dialog');
  policy.beginManualAttempt();
  assert.equal(policy.canWatchAutomatically(), false, 'manual request must not race a second automatic dialog');
  policy.finishManualAttempt();
  const resumed = watchWithGeolocationConsent(policy, register, () => successes++, () => {});
  assert.equal(starts, 2);
  deliver(fix);
  assert.equal(successes, 1);
  resumed();
  assert.equal(stops, 2);
});

test('temporary position unavailable and timeout errors stay retryable', () => {
  for (const code of ['OS-PLUG-GLOC-0002', 'OS-PLUG-GLOC-0010', 2, 3]) {
    const policy = new GeolocationAccessPolicy();
    let starts = 0, fail: (error: Error) => void = () => {};
    const register = (_success: (position: LocationFix) => void, onError: (error: Error) => void) => { starts++; fail = onError; return () => {}; };
    const stop = watchWithGeolocationConsent(policy, register, () => {}, () => {});
    fail(normalizeGeolocationError({ code, message: 'Temporary location failure' }));
    assert.equal(policy.canWatchAutomatically(), true, String(code));
    stop();
    watchWithGeolocationConsent(policy, register, () => {}, () => {})();
    assert.equal(starts, 2, 'page return can retry a temporary failure');
    policy.observeError({ code: 'OS-PLUG-GLOC-0009' });
    policy.beginManualAttempt();
    policy.observeError({ code });
    policy.finishManualAttempt();
    assert.equal(policy.canWatchAutomatically(), true, 'manual timeout must not preserve a previous denial forever');
  }
});

test('manual denial remains blocked while successful explicit retry permits navigation watching', () => {
  const policy = new GeolocationAccessPolicy();
  policy.observeError({ code: 1, message: 'User denied Geolocation' });
  assert.equal(policy.canWatchAutomatically(), false);
  policy.beginManualAttempt();
  policy.observeError({ code: 'OS-PLUG-GLOC-0003' });
  policy.finishManualAttempt();
  assert.equal(policy.canWatchAutomatically(), false);
  policy.beginManualAttempt();
  policy.finishManualAttempt();
  assert.equal(policy.canWatchAutomatically(), true);
  assert.equal(normalizeGeolocationError(new Error('Request to enable location was denied.')).code, 'OS-PLUG-GLOC-0009');
});

test('real browser adapter preserves PERMISSION_DENIED code and disposes a synchronous refusal', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const policy = new GeolocationAccessPolicy();
  let watches = 0, cleared = 0;
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
      watchPosition: (_success: unknown, failure: (error: unknown) => void) => { watches++; failure({ code: 1, message: 'Permission denied' }); return 4; },
      clearWatch: (id: number) => { assert.equal(id, 4); cleared++; },
      getCurrentPosition: (_success: unknown, failure: (error: unknown) => void) => { failure({ code: 1, message: 'Permission denied' }); },
    } } });
    const failures: Error[] = [];
    const stop = watchWithGeolocationConsent(policy, watchDevicePosition, () => {}, (error) => failures.push(error));
    assert.equal((failures[0] as any).code, 1);
    assert.equal(policy.canWatchAutomatically(), false);
    assert.equal(cleared, 1);
    stop();
    watchWithGeolocationConsent(policy, watchDevicePosition, () => {}, () => {})();
    assert.equal(watches, 1);
    await assert.rejects(() => getCurrentDevicePosition(), (error: any) => error.code === 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete (globalThis as any).navigator;
  }
});

test('una negativa que termina después de suspender impide volver a abrir el permiso automáticamente', () => {
  const policy = new GeolocationAccessPolicy();
  let fail!: (error: Error) => void, deliver!: (position: LocationFix) => void;
  let starts = 0, stops = 0, uiErrors = 0, positions = 0;
  const register = (success: (position: LocationFix) => void, error: (error: Error) => void) => {
    starts++; fail = error; deliver = success; return () => { stops++; };
  };
  const stop = watchWithGeolocationConsent(policy, register, () => { positions++; }, () => { uiErrors++; });
  stop();
  fail(normalizeGeolocationError({ code: 'OS-PLUG-GLOC-0009' }));
  deliver(fix);
  assert.equal(policy.canWatchAutomatically(), false);
  assert.equal(uiErrors, 0, 'la vista cerrada no recibe el error tardío');
  assert.equal(positions, 0, 'una vista cerrada no recibe posiciones');
  watchWithGeolocationConsent(policy, register, () => {}, () => {})();
  assert.equal(starts, 1); assert.equal(stops, 1);
});

test('reintentar manualmente invalida las negativas y posiciones de una observación anterior', () => {
  const policy = new GeolocationAccessPolicy();
  const failures: ((error: Error) => void)[] = [], deliveries: ((fix: LocationFix) => void)[] = [];
  let positions = 0, uiErrors = 0;
  const register = (success: (fix: LocationFix) => void, error: (error: Error) => void) => {
    failures.push(error); deliveries.push(success); return () => {};
  };
  const previous = watchWithGeolocationConsent(policy, register, () => { positions++; }, () => { uiErrors++; });
  previous(); policy.beginManualAttempt();
  failures[0](normalizeGeolocationError({ code: 'OS-PLUG-GLOC-0003' }));
  policy.finishManualAttempt();
  assert.equal(policy.canWatchAutomatically(), true, 'el resultado anterior no revoca el nuevo intento explícito');
  const current = watchWithGeolocationConsent(policy, register, () => { positions++; }, () => { uiErrors++; });
  failures[0](normalizeGeolocationError({ code: 'OS-PLUG-GLOC-0009' }));
  deliveries[0](fix); deliveries[1](fix);
  assert.equal(policy.canWatchAutomatically(), true); assert.equal(positions, 1); assert.equal(uiErrors, 0);
  failures[1](normalizeGeolocationError({ code: 'OS-PLUG-GLOC-0003' }));
  assert.equal(policy.canWatchAutomatically(), false, 'la negativa del nuevo intento sí se respeta');
  assert.equal(uiErrors, 1); current();
});

test('una negativa tardía también cierra la observación automática abierta al volver antes de recibirla', () => {
  const policy = new GeolocationAccessPolicy();
  const failures: ((error: Error) => void)[] = [];
  let cleanups = 0, errors = 0;
  const register = (_success: (fix: LocationFix) => void, failure: (error: Error) => void) => {
    failures.push(failure); return () => { cleanups++; };
  };
  const previous = watchWithGeolocationConsent(policy, register, () => {}, () => { errors++; }); previous();
  const resumed = watchWithGeolocationConsent(policy, register, () => {}, () => { errors++; });
  failures[0](normalizeGeolocationError({ code: 'OS-PLUG-GLOC-0009' }));
  assert.equal(policy.canWatchAutomatically(), false);
  assert.equal(cleanups, 2, 'se cierra también el observador creado antes de llegar la negativa');
  assert.equal(errors, 1, 'sólo la vista actual recibe la explicación de permiso');
  resumed(); assert.equal(cleanups, 2);
});

test('el adaptador web real recuerda una negativa tardía pero no entrega posiciones ni timeouts tras cerrar', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const policy = new GeolocationAccessPolicy();
  let nativeError!: (error: unknown) => void, nativeSuccess!: (fix: unknown) => void;
  let cleared = 0, uiErrors = 0, positions = 0;
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
      watchPosition: (success: (fix: unknown) => void, error: (error: unknown) => void) => { nativeSuccess = success; nativeError = error; return 8; },
      clearWatch: () => { cleared++; },
    } } });
    const stop = watchWithGeolocationConsent(policy, watchDevicePosition, () => { positions++; }, () => { uiErrors++; });
    stop();
    nativeError({ code: 3 });
    assert.equal(policy.canWatchAutomatically(), true, 'un timeout cerrado no se convierte en negativa');
    nativeError({ code: 1 });
    nativeSuccess({ timestamp: Date.now(), coords: { latitude: 0, longitude: 0, accuracy: 1 } });
    assert.equal(policy.canWatchAutomatically(), false);
    assert.equal(cleared, 1); assert.equal(uiErrors, 0); assert.equal(positions, 0);
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete (globalThis as any).navigator; }
});

test('el adaptador Android real captura una negativa después del ID temprano y clearWatch rechazado', async () => {
  let deliver!: (position: unknown, error?: unknown) => void;
  let watches = 0, clears = 0;
  const fixtureDriver = {
    watchPosition: async (_options: unknown, callback: typeof deliver) => { watches++; deliver = callback; return 'callback-before-settings'; },
    clearWatch: async () => { clears++; throw Object.assign(new Error('WatchId not found.'), { code: 'OS-PLUG-GLOC-0012' }); },
  };
  const replacements: Record<string, string> = {
    '@capacitor/core': 'export const Capacitor = { isNativePlatform: () => true };',
    '@capacitor/geolocation': 'export const Geolocation = fixtureDriver;',
    '@capacitor/app': 'export const App = { addListener: async () => ({ remove: async () => {} }) };',
    '@capacitor/preferences': 'export const Preferences = { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} };',
    '@capacitor/camera': 'export const Camera = {}; export const CameraResultType = {}; export const CameraSource = {};',
    '@capacitor/haptics': 'export const Haptics = {}; export const ImpactStyle = {}; export const NotificationType = {};',
    '@capacitor/network': 'export const Network = {};',
  };
  const bundled = await build({
    stdin: { contents: `export { watchDevicePosition } from './src/services/native';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'nativeGpsFixture', platform: 'browser', logLevel: 'error',
    plugins: [{ name: 'installed-native-gps-adapter', setup(builder) {
      builder.onResolve({ filter: /^@capacitor\// }, args => replacements[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: replacements[args.path], loader: 'js' }));
    } }],
  });
  const adapter = new Function('fixtureDriver', `${bundled.outputFiles[0].text}; return nativeGpsFixture;`)(fixtureDriver) as {
    watchDevicePosition: typeof watchDevicePosition;
  };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const policy = new GeolocationAccessPolicy();
  let positions = 0, errors = 0;
  const stop = watchWithGeolocationConsent(policy, adapter.watchDevicePosition, () => { positions++; }, () => { errors++; });
  await tick(); stop(); await tick();
  assert.equal(clears, 1, 'se usa la cancelación oficial; el SDK administra la blacklist del ID temprano');
  deliver(null, { code: 'OS-PLUG-GLOC-0009', message: 'Request to enable location was denied.' });
  deliver({ timestamp: Date.now(), coords: { latitude: 0, longitude: 0, accuracy: 5 } });
  assert.equal(policy.canWatchAutomatically(), false);
  assert.equal(positions, 0); assert.equal(errors, 0);
  watchWithGeolocationConsent(policy, adapter.watchDevicePosition, () => {}, () => {})();
  await tick(); assert.equal(watches, 1);
});
