import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppActivityStore } from '../src/services/appLifecycle';

test('varias vistas comparten un único listener nativo y lo liberan al cerrar la última', () => {
  let starts = 0, stops = 0, visibilityStarts = 0, visibilityStops = 0;
  const store = new AppActivityStore({ visible: () => true,
    subscribeVisibility: () => { visibilityStarts++; return () => { visibilityStops++; }; },
    subscribeNative: () => { starts++; return () => { stops++; }; } });
  const a = store.subscribe(() => {}), b = store.subscribe(() => {});
  assert.equal(starts, 1); assert.equal(visibilityStarts, 1);
  a(); assert.equal(stops, 0); b(); assert.equal(stops, 1); assert.equal(visibilityStops, 1);
});
test('fondo, pantalla bloqueada y retorno producen un cambio por transición', () => {
  let visible = true, visibility!: () => void, native!: (active: boolean) => void;
  const states: boolean[] = [];
  const store = new AppActivityStore({ visible: () => visible,
    subscribeVisibility: fn => { visibility = fn; return () => {}; }, subscribeNative: fn => { native = fn; return () => {}; } });
  const stop = store.subscribe(() => states.push(store.getSnapshot()));
  visible = false; visibility(); native(false); native(false);
  visible = true; visibility(); assert.equal(store.getSnapshot(), false);
  native(true); assert.equal(store.getSnapshot(), true);
  visible = false; visibility(); visible = true; visibility();
  assert.deepEqual(states, [false, true, false, true]); stop();
});
test('ciclos repetidos sin suscriptores no acumulan listeners', () => {
  let handles = 0;
  const store = new AppActivityStore({ visible: () => true, subscribeVisibility: () => () => {},
    subscribeNative: () => { handles++; return () => { handles--; }; } });
  for (let i = 0; i < 25; i++) { const stop = store.subscribe(() => {}); assert.equal(handles, 1); stop(); assert.equal(handles, 0); }
});
