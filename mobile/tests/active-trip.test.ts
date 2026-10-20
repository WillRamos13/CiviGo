import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActiveTripController, ACTIVE_TRIP_MAX_AGE, parseActiveTrip, type TripStorage } from '../src/services/activeTrip';
import type { Ruta } from '../src/types';

const now = 1_000_000;
const route: Ruta = { id: 'a', nombre: 'Prueba', tipo: 'rapida', distancia: 1000, duracion: 600,
  geometria: { type: 'LineString', coordinates: [[-75.72, -14.06], [-75.73, -14.07]] },
  destino: { latitud: -14.07, longitud: -75.73 }, modo: 'driving', advertencias: [], puntosRiesgo: 0, nivelRiesgo: 0 };
function storage() {
  const data = new Map<string, string>();
  return { data, async get(key: string) { return data.get(key) ?? null; },
    async set(key: string, value: string) { data.set(key, value); }, async remove(key: string) { data.delete(key); } };
}
test('recupera geometría, destino, transporte y progreso reales sin guardar GPS ni credenciales', async () => {
  const driver = storage(), first = new ActiveTripController(driver);
  first.setOwner(42); assert.equal(await first.save(route, 350, now - 60000, now), true);
  const second = new ActiveTripController(driver); second.setOwner(42);
  const restored = await second.load(now + 1000);
  assert.equal(restored?.covered, 350); assert.equal(restored?.route.modo, 'driving');
  assert.deepEqual(restored?.route.destino, route.destino); assert.deepEqual(restored?.route.geometria, route.geometria);
  assert.equal('position' in restored!, false); assert.equal('token' in restored!, false);
});
test('el checkpoint sólo guarda contrato de ruta y elimina metadatos del sensor y campos ajenos', async () => {
  const driver = storage(), controller = new ActiveTripController(driver); controller.setOwner(42);
  const input = { ...route, token: 'never-store', position: { speed: 20 }, origen: {latitud:-14.06,longitud:-75.72,speed:12,heading:90,timestamp:now} };
  await controller.save(input, 20, now, now);
  const saved = (await controller.load(now))!.route;
  assert.deepEqual(saved.origen, {latitud:-14.06,longitud:-75.72});
  assert.equal('token' in saved, false); assert.equal('position' in saved, false);
});
test('rechaza datos expirados, futuros, otra cuenta y geometría corrupta', async () => {
  const driver = storage(), controller = new ActiveTripController(driver); controller.setOwner(42);
  await controller.save(route, 350, now - 1000, now);
  const raw = [...driver.data.values()][0], original = JSON.parse(raw);
  assert.equal(parseActiveTrip(raw, 7, now), null);
  assert.equal(parseActiveTrip(raw, 42, now + ACTIVE_TRIP_MAX_AGE + 1), null);
  assert.equal(parseActiveTrip(raw, 42, now - 10000), null);
  for (const modified of [{ ...original, covered: 1001 }, { ...original, version: 2 },
    { ...original, route: { ...route, destino: null } }, { ...original, route: { ...route, modo: 'airplane' } },
    { ...original, route: { ...route, geometria: { type: 'LineString', coordinates: [[-75, -14], [999, -14]] } } }]) {
    assert.equal(parseActiveTrip(JSON.stringify(modified), 42, now), null);
  }
  assert.equal(parseActiveTrip('{broken', 42, now), null);
});
test('invalidación por cambio de cuenta descarta una lectura tardía', async () => {
  let resolve!: (value: string | null) => void;
  const driver = { get: () => new Promise<string | null>(yes => { resolve = yes; }), set: async () => {}, remove: async () => {} };
  const controller = new ActiveTripController(driver); controller.setOwner(42);
  const loading = controller.load(now); await new Promise(yes => setTimeout(yes, 0));
  controller.setOwner(7);
  resolve(JSON.stringify({ version: 1, ownerId: 42, savedAt: now, startedAt: now, covered: 0, route }));
  assert.equal(await loading, null);
});
test('finalizar elimina después de escrituras en vuelo y no permite resucitar el viaje', async () => {
  const data = new Map<string, string>(); let release!: () => void;
  const driver: TripStorage = { get: async key => data.get(key) ?? null,
    set: async (key, value) => { await new Promise<void>(yes => { release = yes; }); data.set(key, value); },
    remove: async key => { data.delete(key); } };
  const controller = new ActiveTripController(driver); controller.setOwner(42);
  const saving = controller.save(route, 10, now, now); await new Promise(yes => setTimeout(yes, 0));
  const clear = controller.clear(); release(); await saving; await clear;
  assert.equal(data.size, 0); assert.equal(await controller.load(now), null);
});
test('sin cuenta no guarda ni lee y se rechaza un snapshot excesivo', async () => {
  const driver = storage(), controller = new ActiveTripController(driver);
  assert.equal(await controller.save(route, 0, now, now), false); assert.equal(await controller.load(now), null);
  assert.equal(driver.data.size, 0);
  controller.setOwner(42);
  await assert.rejects(controller.save({ ...route, destinoNombre: 'x'.repeat(750001) }, 0, now, now));
});
test('un snapshot inválido se limpia sin borrar otro usuario', async () => {
  const driver = storage(); driver.data.set('civigo:active-trip:v1:user:42', '{}'); driver.data.set('other', 'safe');
  const controller = new ActiveTripController(driver); controller.setOwner(42);
  assert.equal(await controller.load(now), null); assert.equal(driver.data.size, 1); assert.equal(driver.data.get('other'), 'safe');
});
