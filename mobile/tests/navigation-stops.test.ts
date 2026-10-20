import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canContinueAfterStop, planAfterStop, planIntermediateStop } from '../src/services/navigationStops';
import { isRoute, type NavigationPlace } from '../src/services/navigation';
import type { Ruta } from '../src/types';

const active: Ruta = { id: 'direct', nombre: 'Ruta actual', tipo: 'segura', distancia: 1000, duracion: 100,
  geometria: { type: 'LineString', coordinates: [[0, 0], [.01, 0]] },
  puntosRiesgo: 0, nivelRiesgo: 0, advertencias: [], modo: 'driving',
  origen: { latitud: 0, longitud: 0 }, destino: { latitud: 0, longitud: .01 }, destinoNombre: 'Destino final real' };
const place: NavigationPlace = { nombre: 'Farmacia de prueba aislada', latitud: .001, longitud: .004, fuente: 'Fixture, no es negocio real' };
const current = () => ({ latitud: 0, longitud: 0, accuracy: 5, timestamp: Date.now() });
const choices = (distance: number, duration: number): Ruta[] => [{ ...active, id: 'fast', tipo: 'rapida', distancia: distance + 100, duracion: duration - 1 }, { ...active, id: `safe-${distance}`, distancia: distance, duracion: duration }];

test('a stop preview uses three actual routings, preserves criterion and final destination, and never writes history', async () => {
  const calls: unknown[][] = [], responses = [choices(500, 70), choices(700, 80), choices(1000, 100)];
  const controller = new AbortController(), fix = current();
  const original = JSON.stringify(active);
  const preview = await planIntermediateStop(fix, place, active, controller.signal, async (...args) => { calls.push(args); return responses.shift()!; });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].slice(0, 3), [fix, { latitud: place.latitud, longitud: place.longitud }, 'driving']);
  assert.deepEqual(calls[1].slice(0, 3), [{ latitud: place.latitud, longitud: place.longitud }, active.destino, 'driving']);
  assert.deepEqual(calls[2].slice(0, 3), [fix, active.destino, 'driving']);
  assert.ok(calls.every(call => call[3] === controller.signal));
  assert.equal(preview.combinedDistance, 1200); assert.equal(preview.combinedDuration, 150);
  assert.equal(preview.additionalDistance, 200); assert.equal(preview.additionalDuration, 50);
  assert.deepEqual(preview.firstLeg.paradaIntermedia, { nombre: place.nombre, latitud: place.latitud, longitud: place.longitud,
    destinoFinal: active.destino, destinoFinalNombre: active.destinoNombre });
  assert.equal(preview.firstLeg.tipo, 'segura'); assert.equal(preview.secondLeg.tipo, 'segura');
  assert.equal(preview.secondLeg.paradaIntermedia, undefined);
  assert.equal(JSON.stringify(active), original);
  assert.equal(isRoute(preview.firstLeg), true, 'a genuine prepared stop remains recoverable through the validated route contract');
});

test('replacing an intermediate stop keeps the original final destination rather than turning old stop into final', async () => {
  const withStop: Ruta = { ...active, destino: { latitud: .002, longitud: .002 }, destinoNombre: 'Parada anterior',
    paradaIntermedia: { nombre: 'Parada anterior', latitud: .002, longitud: .002, destinoFinal: active.destino!, destinoFinalNombre: active.destinoNombre } };
  const destinations: unknown[] = [];
  const preview = await planIntermediateStop(current(), place, withStop, new AbortController().signal, async (_from, to) => {
    destinations.push(to); return choices(100, 50);
  });
  assert.deepEqual(destinations[1], active.destino); assert.deepEqual(destinations[2], active.destino);
  assert.deepEqual(preview.firstLeg.paradaIntermedia?.destinoFinal, active.destino);
  assert.equal(preview.firstLeg.paradaIntermedia?.destinoFinalNombre, active.destinoNombre);
});

test('cancellation after a leg prevents remaining requests and a failed leg leaves the current route untouched', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(() => planIntermediateStop(current(), place, active, controller.signal, async () => {
    calls++; controller.abort(); return choices(100, 30);
  }), (error: Error) => error.name === 'AbortError');
  assert.equal(calls, 1);
  const original = JSON.stringify(active); calls = 0;
  await assert.rejects(() => planIntermediateStop(current(), place, active, new AbortController().signal, async () => {
    if (++calls === 2) throw new Error('Proveedor no disponible'); return choices(100, 30);
  }), /Proveedor no disponible/);
  assert.equal(JSON.stringify(active), original); assert.equal(calls, 2);
});

test('a stop cannot be planned with stale GPS or an invalid destination; no provider request is issued', async () => {
  let calls = 0; const planner = async () => { calls++; return choices(100, 20); };
  await assert.rejects(() => planIntermediateStop({ ...current(), timestamp: Date.now() - 40000 }, place, active, new AbortController().signal, planner), /GPS/);
  await assert.rejects(() => planIntermediateStop({ ...current(), timestamp: undefined }, place, active, new AbortController().signal, planner), /GPS/);
  await assert.rejects(() => planIntermediateStop(current(), place, { ...active, destino: undefined }, new AbortController().signal, planner), /destino final/);
  assert.equal(calls, 0);
});

test('continuation requires actual recent precise GPS within20m and uses that actual position for the final leg', async () => {
  const route: Ruta = { ...active, destino: { latitud: place.latitud, longitud: place.longitud }, destinoNombre: place.nombre,
    paradaIntermedia: { ...place, destinoFinal: active.destino!, destinoFinalNombre: active.destinoNombre } };
  const atStop = { latitud: place.latitud + .00001, longitud: place.longitud, accuracy: 5, timestamp: Date.now() };
  assert.equal(canContinueAfterStop(route, atStop), true);
  for (const fix of [current(), { ...atStop, accuracy: 80 }, { ...atStop, timestamp: Date.now() - 40000 }, { ...atStop, accuracy: undefined }, { ...atStop, timestamp: undefined }]) {
    assert.equal(canContinueAfterStop(route, fix), false);
  }
  let calledOrigin: unknown;
  const finalLeg = await planAfterStop(atStop, route, new AbortController().signal, async (from, to, mode) => {
    calledOrigin = from; assert.deepEqual(to, active.destino); assert.equal(mode, 'driving'); return choices(700, 80);
  });
  assert.deepEqual(calledOrigin, atStop);
  assert.equal(finalLeg.paradaIntermedia, undefined);
  assert.equal(finalLeg.destinoNombre, active.destinoNombre);
  assert.deepEqual(finalLeg.destino, active.destino);
});

test('untrusted persisted stop metadata cannot pass route validation', () => {
  const valid = { nombre: 'Parada', latitud: .001, longitud: .002, destinoFinal: active.destino };
  assert.equal(isRoute({ ...active, paradaIntermedia: valid }), true);
  for (const bad of [null, { ...valid, nombre: '' }, { ...valid, latitud: 200 }, { ...valid, destinoFinal: null }, { ...valid, destinoFinalNombre: 5 }]) {
    assert.equal(isRoute({ ...active, paradaIntermedia: bad }), false);
  }
});

test('the default stop planner exercises the existing navigation POST contract for all three legs', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { path: string; body: any }[] = [];
  try {
    globalThis.fetch = async (input, options) => {
      const body = JSON.parse(String(options?.body));
      requests.push({ path: new URL(String(input)).pathname, body });
      assert.equal(options?.method, 'POST');
      const response: Ruta = { ...active, id: `leg-${requests.length}`, modo: body.modo,
        geometria: { type: 'LineString', coordinates: [[body.origen.longitud, body.origen.latitud], [body.destino.longitud, body.destino.latitud]] },
        distancia: requests.length * 100, duracion: requests.length * 30 };
      return new Response(JSON.stringify({ rutas: [response] }));
    };
    const preview = await planIntermediateStop(current(), place, active, new AbortController().signal);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(request => request.path === '/api/navigation/plan'));
    assert.equal(preview.combinedDistance, 300);
    assert.equal(preview.combinedDuration, 90);
    assert.equal(requests.some(request => request.path.includes('/history')), false);
  } finally { globalThis.fetch = originalFetch; }
});
