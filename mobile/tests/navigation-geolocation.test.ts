import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeolocationAccessPolicy, normalizeGeolocationError, watchWithGeolocationConsent } from '../src/services/geolocation-consent';
import { getCurrentDevicePosition, watchDevicePosition } from '../src/services/native';
import type { LocationFix } from '../src/types';

const fix: LocationFix = { latitud: -14.0678, longitud: -75.7286, accuracy: 10, timestamp: 100000 };

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
