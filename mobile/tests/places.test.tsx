import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanPlace, distanceToRoute, placeKey, placeMapUrl, placeShareText, placesNearRoute } from '../src/services/placeDiscovery';
import { PlacePreferencesController, parsePlacePreferences, type PlacePreferencesDriver } from '../src/services/placePreferences';
import { incidentDate, incidentRisk, incidentState, visibleNearbyIncidents } from '../src/services/nearbyIncidentPresentation';
import { NearbyIncidentCards } from '../src/components/incident/NearbyIncidentCards';
import { DestinationExplorer } from '../src/components/navigation/DestinationExplorer';
import type { Incidente } from '../src/types';

const plaza = { nombre: 'Plaza de Armas de Ica', descripcion: 'Centro de Ica', fuente: 'TomTom', latitud: -14.0678, longitud: -75.7286 };
const utp = { nombre: 'UTP Ica', latitud: -14.073, longitud: -75.737 };
const route = { geometria: { type: 'LineString' as const, coordinates: [[-75.7286, -14.0678], [-75.7286, -14.0578]] } };
const incident = (id: number, props: Partial<Incidente> = {}): Incidente => ({ id, tipo: 'Robo', estado: 'ACTIVO', nivelRiesgo: null, latitud: -14.0678, longitud: -75.7286, totalReportes: 1, ...props });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(next => { resolve = next; }); return { promise, resolve }; };
function memoryDriver(): PlacePreferencesDriver & { data: Map<string, string>; writes: string[] } {
  const data = new Map<string, string>(), writes: string[] = [];
  return { data, writes, get: async ({ key }) => ({ value: data.get(key) ?? null }), set: async ({ key, value }) => { writes.push(key); data.set(key, value); } };
}

test('place details retain only actual supported fields and reject malformed coordinates', () => {
  assert.deepEqual(cleanPlace({ ...plaza, rating: 5, phone: '+51999999999', html: '<script>' }), plaza);
  for (const bad of [{}, { ...plaza, latitud: 91 }, { ...plaza, longitud: Infinity }, { ...plaza, nombre: '' }]) assert.equal(cleanPlace(bad), null);
  assert.equal(placeKey({ ...plaza, nombre: '  PLAZA DE ARMAS DE ICA  ' }), placeKey(plaza));
  const url = new URL(placeMapUrl(plaza));
  assert.equal(url.origin, 'https://www.openstreetmap.org');
  assert.equal(url.searchParams.get('mlat'), String(plaza.latitud));
  assert.ok(placeShareText(plaza).includes(plaza.nombre));
  assert.ok(placeShareText(plaza).includes(plaza.descripcion));
  assert.throws(() => placeMapUrl({ ...plaza, longitud: NaN }), /válida/);
});

test('route proximity uses real line geometry and does not invent travel detours', () => {
  assert.ok(distanceToRoute(plaza, route)! < 1);
  const near = { nombre: 'Resultado cercano', latitud: -14.063, longitud: -75.7296 };
  const far = { nombre: 'Resultado lejano', latitud: -14.063, longitud: -75.75 };
  assert.ok(distanceToRoute(near, route)! > 100);
  assert.deepEqual(placesNearRoute([far, near, plaza], route), [plaza, near]);
  assert.equal(distanceToRoute(plaza, { geometria: { type: 'LineString', coordinates: [[0, 0], [NaN, 0]] } }), null);
  assert.deepEqual(placesNearRoute([plaza], route, Infinity), []);
  assert.equal('duracion' in near, false);
});

test('stored places validate structure, discard stale/future entries and cap personal data', () => {
  const now = Date.now();
  const parsed = parsePlacePreferences(JSON.stringify({ version: 1, recent: [
    { place: plaza, visitedAt: now - 1000 }, { place: plaza, visitedAt: now - 2000 },
    { place: utp, visitedAt: now - 91 * 86400000 }, { place: utp, visitedAt: now + 60000 },
    { place: { ...utp, latitud: 100 }, visitedAt: now },
  ], saved: [{ place: plaza, label: 'home' }, { place: utp, label: 'home' }, { place: utp, label: 'work' }, { place: plaza, label: 'not-a-label' }] }), now);
  assert.equal(parsed.recent.length, 1);
  assert.deepEqual(parsed.saved.map(item => item.label), ['home', 'work']);
  assert.equal(parsePlacePreferences('not json').saved.length, 0);
  assert.equal(parsePlacePreferences(JSON.stringify({ version: 2, saved: [{ place: plaza, label: 'home' }] })).saved.length, 0);
});

test('anonymous searches never write a personal history or saved destinations', async () => {
  const driver = memoryDriver(), controller = new PlacePreferencesController(driver);
  assert.equal(await controller.load(), null);
  assert.equal(await controller.remember(plaza), null);
  assert.equal(await controller.save(plaza, 'home'), null);
  for (const id of [NaN, -1, 0]) { controller.setOwner(id); assert.equal(await controller.save(plaza), null); }
  assert.deepEqual(driver.writes, []);
});

test('serialized personal mutations preserve recents and home/work without cross-account leaks', async () => {
  const driver = memoryDriver(), controller = new PlacePreferencesController(driver);
  controller.setOwner(7);
  await Promise.all([controller.remember(plaza), controller.save(utp, 'home'), controller.save(plaza, 'work')]);
  const first = await controller.load();
  assert.equal(first?.recent[0].place.nombre, plaza.nombre);
  assert.deepEqual(first?.saved.map(item => item.label), ['work', 'home']);
  await controller.save(plaza, 'home');
  const replaced = await controller.load();
  assert.equal(replaced?.saved.filter(item => item.label === 'home').length, 1);
  assert.equal(replaced?.saved.find(item => item.label === 'home')?.place.nombre, plaza.nombre);
  controller.setOwner(8);
  assert.deepEqual(await controller.load(), { recent: [], saved: [] });
  await controller.save(utp);
  assert.ok(driver.data.has('civigo:places:v1:user:7'));
  assert.ok(driver.data.has('civigo:places:v1:user:8'));
  await controller.remove(utp);
  assert.equal((await controller.load())?.saved.length, 0);
});

test('a delayed old-account history read cannot reach the next account', async () => {
  const pending = deferred<{ value: string | null }>();
  let reads = 0;
  const driver = memoryDriver();
  const delayed = { ...driver, get: async () => { reads++; return pending.promise; } };
  const controller = new PlacePreferencesController(delayed);
  controller.setOwner(7);
  const reading = controller.load();
  await Promise.resolve();
  assert.equal(reads, 1);
  controller.setOwner(8);
  pending.resolve({ value: JSON.stringify({ version: 1, recent: [{ place: plaza, visitedAt: Date.now() }], saved: [] }) });
  assert.equal(await reading, null);
});

test('queued history from an obsolete owner is cancelled before writing', async () => {
  const driver = memoryDriver(), controller = new PlacePreferencesController(driver);
  controller.setOwner(7);
  const saving = controller.remember(plaza);
  controller.setOwner(8);
  assert.equal(await saving, null);
  assert.deepEqual(driver.writes, []);
  await assert.rejects(controller.save({ ...plaza, latitud: Infinity }), /válido/);
});

test('nearby cards never invent safe risk, event date or an active state', () => {
  assert.equal(incidentRisk(incident(1)), null);
  for (const risk of [6, -1, 2.5, NaN]) assert.equal(incidentRisk(incident(1, { nivelRiesgo: risk })), null);
  assert.equal(incidentRisk(incident(1, { nivelRiesgo: 5 })), 5);
  assert.equal(incidentDate(incident(1, { fechaEvento: 'invalid', fechaPublicacion: '2026-10-20T08:00:00Z' })), '2026-10-20T08:00:00Z');
  assert.equal(incidentDate(incident(1)), null);
  assert.equal(incidentState(incident(1, { estado: '' })), null);
  const html = renderToStaticMarkup(<NearbyIncidentCards incidents={[incident(1, { descripcion: '<script>no</script>', estado: '' })]} onSelect={() => {}} />);
  assert.ok(html.includes('Riesgo por evaluar'));
  assert.ok(html.includes('Ver en mapa'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('Seguro'));
  assert.ok(!html.includes('Activo'));
  assert.ok(!html.includes('Sin fecha'));
});

test('nearby cards preserve order and only use up to ten available incidents within 1 km', () => {
  const items = Array.from({ length: 14 }, (_, index) => incident(index + 1));
  assert.equal(visibleNearbyIncidents(items, plaza).length, 10);
  assert.deepEqual(visibleNearbyIncidents([incident(4), incident(4), incident(2), incident(8, { latitud: -15 })], plaza).map(item => item.id), [4, 2]);
  const html = renderToStaticMarkup(<NearbyIncidentCards incidents={[incident(1, { nivelRiesgo: 3, distrito: 'Ica', fechaEvento: '2026-10-20T08:00:00Z' })]} updatedAt={new Date('2026-10-20T08:00:00Z')} onSelect={() => {}} />);
  for (const value of ['Nivel 3', 'Ica', 'Activo', 'Hasta 10', 'Consulta:', '/iconos/']) assert.ok(html.includes(value), value);
});

test('closed destination explorer renders no controls, search requests or external content', () => {
  const html = renderToStaticMarkup(<DestinationExplorer open={false} ownerId={null} onClose={() => {}} onChooseDestination={() => {}} />);
  assert.equal(html, '');
});
