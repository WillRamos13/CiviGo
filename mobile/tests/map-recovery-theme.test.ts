import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapRecoveryController } from '../src/services/mapRecovery';

import { ThemeController } from '../src/services/theme';

test('WebGL recovery waits in foreground, restores in place and never fires a stale rebuild', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: string[] = [];
  const recovery = new MapRecoveryController({ lost: () => calls.push('lost'), restored: () => calls.push('restored'), rebuild: () => calls.push('rebuild') }, 15000);
  recovery.contextLost(); recovery.contextLost();
  t.mock.timers.tick(10000); recovery.setForeground(false);
  t.mock.timers.tick(180000); assert.deepEqual(calls, ['lost']);
  recovery.setForeground(true); t.mock.timers.tick(10000);
  recovery.contextRestored(); t.mock.timers.tick(30000);
  assert.deepEqual(calls, ['lost', 'restored']);
  recovery.contextLost(); t.mock.timers.tick(15000); t.mock.timers.tick(60000);
  assert.deepEqual(calls, ['lost', 'restored', 'lost', 'rebuild']);
  recovery.dispose(); recovery.contextRestored(); recovery.contextLost();
  t.mock.timers.tick(60000); assert.equal(calls.length, 4);
});

test('disposing a lost map cancels pending recovery before a React replacement mounts', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let rebuilds = 0;
  const recovery = new MapRecoveryController({ lost() {}, restored() {}, rebuild() { rebuilds++; } }, 1000);
  recovery.contextLost(); recovery.dispose();
  t.mock.timers.tick(60000); assert.equal(rebuilds, 0);
});

test('automatic theme follows system changes until an explicit choice and removes its listener', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let dark = false, listener: (() => void) | null = null, removed = false;
  const writes: string[] = [], updates: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => ({ matches: dark,
    addEventListener: (_event: string, value: () => void) => { listener = value; },
    removeEventListener: () => { listener = null; removed = true; },
  }) } });
  try {
    const controller = new ThemeController('light', { get: async () => 'system', set: async (_key, value) => { writes.push(value); } }, (theme, preference) => updates.push(`${theme}:${preference}`));
    const stop = controller.initialize(); await new Promise(resolve => setTimeout(resolve, 0));
    dark = true; (listener as (() => void) | null)?.();
    assert.equal(updates.at(-1), 'dark:system');
    controller.setPreference('light'); dark = false; (listener as (() => void) | null)?.();
    dark = true; (listener as (() => void) | null)?.();
    assert.equal(updates.at(-1), 'light:light');
    controller.setPreference('system'); assert.equal(updates.at(-1), 'dark:system');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(writes, ['light', 'system']); stop(); assert.equal(removed, true);
  } finally { if (before) Object.defineProperty(globalThis, 'window', before); else Reflect.deleteProperty(globalThis, 'window'); }
});
