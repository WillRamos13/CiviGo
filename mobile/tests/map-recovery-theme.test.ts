import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapRecoveryController } from '../src/services/mapRecovery';
import { CiviGoMapTheme } from '../src/services/mapTheme';
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

test('dark cartography restores exact light paint and does not touch risk, traffic, sources or camera', () => {
  const layers = [
    { id: 'background', type: 'background' }, { id: 'water', type: 'fill' },
    { id: 'road-primary', type: 'line', 'source-layer': 'road' },
    { id: 'road-label', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
    { id: 'civigo-roads-layer', type: 'line' }, { id: 'tomtom-flow-layer', type: 'raster' },
    { id: 'route-completed-line', type: 'line' }, { id: 'route-line', type: 'line' }, { id: 'route-casing', type: 'line' },
  ];
  const originalRoad = ['match', ['get', 'class'], 'primary', '#ffffbb', '#ffffff'];
  const values = new Map<string, unknown>([['road-primary:line-color', originalRoad], ['water:fill-color', '#aadeff'], ['background:background-color', '#fefefe']]);
  const initial = new Map(values), writes: string[] = [];
  const map = { getStyle: () => ({ layers }), getLayer: (id: string) => layers.find(layer => layer.id === id),
    getPaintProperty: (id: string, prop: string) => values.get(`${id}:${prop}`),
    setPaintProperty: (id: string, prop: string, value: unknown) => { writes.push(`${id}:${prop}`); values.set(`${id}:${prop}`, value); },
  };
  const theme = new CiviGoMapTheme();
  theme.apply(map as any, true);
  assert.equal(values.get('road-primary:line-color'), '#344d60');
  assert.equal(values.get('route-line:line-color'), '#19c9ff');
  assert.equal(writes.some(key => /^(?:civigo-|tomtom-|route-completed)/.test(key)), false);
  theme.apply(map as any, false);
  for (const [key, value] of initial) assert.deepEqual(values.get(key), value);
  assert.equal(values.get('road-primary:line-color'), originalRoad);
  assert.equal(values.get('route-line:line-color'), '#1554d8');
  theme.apply(map as any, true); theme.apply(map as any, false);
  assert.equal(values.get('road-primary:line-color'), originalRoad);
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
