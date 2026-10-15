import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackHandlers, handleAppBack } from '../src/services/backNavigation';
import { ThemeController } from '../src/services/theme';
import { getIncidentDetail } from '../src/services/incidentDetails';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('Back remains functional in WebViews without Array.at', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'at')!;
  const handlers = new BackHandlers(), calls: string[] = [];
  let top = false, dismissed = false;
  try {
    Object.defineProperty(Array.prototype, 'at', { ...descriptor, value: undefined });
    const entry = handlers.register(() => calls.push('dialog'));
    top = entry.isTop();
    dismissed = handlers.dismissTop();
    entry.remove();
    handlers.dismissTop();
  } finally { Object.defineProperty(Array.prototype, 'at', descriptor); }
  assert.equal(top, true);
  assert.equal(dismissed, true);
  assert.deepEqual(calls, ['dialog']);
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('Android Back closes the top dialog, then screen, tab and finally minimizes', () => {
  const handlers = new BackHandlers(), calls: string[] = [];
  const actions = { previousView: () => calls.push('view'), mapTab: () => calls.push('map'), minimize: () => calls.push('minimize') };
  const outer = handlers.register(() => calls.push('outer'));
  const inner = handlers.register(() => calls.push('inner'));
  assert.equal(outer.isTop(), false);
  handleAppBack({ inSubview: true, inOtherTab: true }, actions, handlers);
  inner.remove(); inner.remove();
  handleAppBack({ inSubview: true, inOtherTab: true }, actions, handlers);
  outer.remove();
  handleAppBack({ inSubview: true, inOtherTab: true }, actions, handlers);
  handleAppBack({ inSubview: false, inOtherTab: true }, actions, handlers);
  handleAppBack({ inSubview: false, inOtherTab: false }, actions, handlers);
  assert.deepEqual(calls, ['inner', 'outer', 'view', 'map', 'minimize']);
});

test('a delayed saved theme cannot reverse a newer user selection', async () => {
  const saved = deferred<string | null>(), themes: string[] = [], writes: string[] = [];
  const controller = new ThemeController('light', { get: () => saved.promise, set: async (_key, value) => { writes.push(value); } }, theme => themes.push(theme));
  const stop = controller.initialize();
  controller.toggle();
  saved.resolve('light');
  await tick();
  assert.deepEqual(themes, ['dark']);
  assert.deepEqual(writes, ['dark']);
  stop();
});

test('theme writes finish in selection order even if the first preference write is slow', async () => {
  const pending = deferred<void>(), writes: string[] = [];
  const controller = new ThemeController('light', { get: async () => null, set: async (_key, value) => { writes.push(value); if (writes.length === 1) await pending.promise; } }, () => {});
  controller.initialize();
  controller.toggle(); controller.toggle();
  await tick();
  assert.deepEqual(writes, ['dark']);
  pending.resolve(); await tick();
  assert.deepEqual(writes, ['dark', 'light']);
});

test('blocked preference storage and disposed initialization do not break the theme', async () => {
  const pending = deferred<string | null>(), themes: string[] = [];
  const disposed = new ThemeController('light', { get: () => pending.promise, set: async () => {} }, theme => themes.push(theme));
  const stop = disposed.initialize(); stop(); pending.resolve('dark'); await tick();
  assert.deepEqual(themes, []);
  const blocked = new ThemeController('light', { get: async () => { throw new Error('Storage blocked'); }, set: async () => { throw new Error('Quota exceeded'); } }, theme => themes.push(theme));
  blocked.initialize(); blocked.toggle(); await tick();
  assert.deepEqual(themes, ['dark']);
});

test('opening an alert uses the existing incident endpoint, validates its ID and preserves cancellation', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const incident = { id: 501, tipo: 'Bache', estado: 'ACTIVO', latitud: -14.07, longitud: -75.73, adjuntos: [] };
  try {
    globalThis.fetch = async input => { calls.push(String(input)); return Response.json(incident); };
    assert.equal((await getIncidentDetail(501)).id, 501);
    assert.equal(new URL(calls[0]).pathname, '/api/incidents/501');
    await assert.rejects(getIncidentDetail(-1), /no es válido/);
    assert.equal(calls.length, 1);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(getIncidentDetail(501, controller.signal), { name: 'AbortError' });
    assert.equal(calls.length, 1);
    globalThis.fetch = async () => Response.json({ ...incident, id: 502 });
    await assert.rejects(getIncidentDetail(501), /detalle válido/);
    globalThis.fetch = async () => Response.json({ ...incident, adjuntos: {} });
    await assert.rejects(getIncidentDetail(501), /detalle válido/);
  } finally { globalThis.fetch = original; }
});
