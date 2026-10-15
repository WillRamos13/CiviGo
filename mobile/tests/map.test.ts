import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateIncidentMarker } from '../src/components/map/incidentMarker';
import { applyRoadRisk, type RoadGeometry } from '../src/services/roadMap';
import { getMapIncidents, getRecentIncidents, DEFAULT_ICA_BOUNDS, expandMapBounds } from '../src/services/mapData';
import type { Incidente } from '../src/types';

const incident: Incidente = { id: 7, tipo: 'Robo', tipoSlug: 'robo', descripcion: 'Aviso inicial', latitud: -14, longitud: -75, estado: 'ACTIVO', nivelRiesgo: 1, totalReportes: 1 };

test('existing marker updates position, icon, severity and click payload without HTML injection', () => {
  const image: any = { src: '', alt: '', onerror: null };
  const pill: any = { style: {}, textContent: '' };
  const attributes: Record<string, string> = {};
  const element: any = { title: '', dataset: {}, onclick: null, setAttribute: (name: string, value: string) => { attributes[name] = value; }, querySelector: (selector: string) => selector === 'img' ? image : pill };
  Object.defineProperty(element, 'innerHTML', { set: () => { throw new Error('HTML must never be injected'); } });
  let coordinates: any;
  let selected: any;
  const marker: any = { getElement: () => element, setLngLat: (value: unknown) => { coordinates = value; } };
  updateIncidentMarker(marker, incident, (value) => { selected = value; });
  element.onclick({ stopPropagation() {} });
  assert.equal(selected, incident);
  const updated = { ...incident, latitud: -14.1, longitud: -75.1, tipo: 'Bache', tipoSlug: 'bache', gravedad: 5, descripcion: '<img src=x onerror=alert(1)>' };
  updateIncidentMarker(marker, updated, (value) => { selected = value; });
  element.onclick({ stopPropagation() {} });
  assert.equal(selected, updated);
  assert.deepEqual(coordinates, [-75.1, -14.1]);
  assert.match(image.src, /bache\.png$/);
  assert.equal(image.alt, 'Bache');
  assert.equal(pill.style.backgroundColor, '#DC2626');
  assert.equal(attributes['aria-label'], 'Bache: <img src=x onerror=alert(1)>');
  assert.equal(pill.textContent, '');
  image.onerror();
  assert.equal(image.src, '/iconos/alerta.svg');
  assert.equal(image.onerror, null);
});

test('map snapshot loads all 550 incidents across three pages without the old 500 cap', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const items = Array.from({ length: 550 }, (_, index) => ({ ...incident, id: 550 - index }));
  try {
    globalThis.fetch = async (url) => {
      const value = String(url); calls.push(value);
      const after = new URL(value, 'http://local.test').searchParams.get('after');
      const start = after === null ? 0 : items.findIndex((item) => item.id < Number(after));
      const page = items.slice(start, start + 250);
      return new Response(JSON.stringify({ items: page, nextCursor: start + 250 < items.length ? page[page.length - 1].id : null }));
    };
    const result = await getMapIncidents(DEFAULT_ICA_BOUNDS);
    assert.equal(result.length, 550);
    assert.equal(new Set(result.map((item) => item.id)).size, 550);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((url) => url.includes('bbox=')));
    assert.ok(!calls[0].includes('latitud='));
  } finally { globalThis.fetch = original; }
});

test('panning preserves province bounds and all 550 incidents while refreshing changed data', async () => {
  const original = globalThis.fetch;
  const items = Array.from({ length: 550 }, (_, index) => ({ ...incident, id: 550 - index }));
  let refreshed = false;
  const requestedBounds: string[] = [];
  try {
    globalThis.fetch = async (url) => {
      const query = new URL(String(url), 'http://local.test').searchParams;
      requestedBounds.push(query.get('bbox')!);
      const after = query.get('after');
      const start = after === null ? 0 : items.findIndex((item) => item.id < Number(after));
      const page = items.slice(start, start + 250).map((item) => refreshed && item.id === 550 ? { ...item, descripcion: 'Datos renovados', gravedad: 5 } : item);
      return new Response(JSON.stringify({ items: page, nextCursor: start + 250 < items.length ? page[page.length - 1].id : null }));
    };
    const first = await getMapIncidents(DEFAULT_ICA_BOUNDS);
    assert.deepEqual(DEFAULT_ICA_BOUNDS, [-76.3, -15, -75.1, -13.3]);
    assert.equal(expandMapBounds(DEFAULT_ICA_BOUNDS, [-75.9, -14.5, -75.5, -14]), DEFAULT_ICA_BOUNDS);
    const expanded = expandMapBounds(DEFAULT_ICA_BOUNDS, [-76.5, -14.8, -76, -13.2]);
    assert.deepEqual(expanded, [-76.5, -15, -75.1, -13.2]);
    refreshed = true;
    const later = await getMapIncidents(expanded);
    assert.deepEqual(later.map((item) => item.id), first.map((item) => item.id));
    assert.equal(later[0].descripcion, 'Datos renovados');
    assert.equal(later[0].gravedad, 5);
    assert.equal(first[0].descripcion, 'Aviso inicial');
    assert.equal(expandMapBounds(expanded, [-75.9, -14.4, -75.5, -14.1]), expanded);
    assert.equal(requestedBounds[3], '-76.5,-15,-75.1,-13.2');
  } finally { globalThis.fetch = original; }
});

test('incomplete map pagination rejects instead of publishing a partial snapshot', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ items: [incident], nextCursor: 7 }));
    await assert.rejects(() => getMapIncidents(DEFAULT_ICA_BOUNDS), /paginación/);
  } finally { globalThis.fetch = original; }
});

test('recent section uses GPS contract and limits results to 10 within 1 km', async () => {
  const original = globalThis.fetch;
  let url = '';
  try {
    globalThis.fetch = async (input) => {
      url = String(input);
      return new Response(JSON.stringify([{ ...incident, id: 200, latitud: -13 }, ...Array.from({ length: 12 }, (_, index) => ({ ...incident, id: index + 1 }))]));
    };
    const result = await getRecentIncidents({ latitud: -14, longitud: -75 });
    assert.equal(result.length, 10);
    assert.equal(result.some((item) => item.id === 200), false);
    assert.match(url, /latitud=-14&longitud=-75/);
    assert.ok(!url.includes('bbox='));
  } finally { globalThis.fetch = original; }
});

test('road risk merges a new revision without mutating the last snapshot', () => {
  const geometry: RoadGeometry = { type: 'FeatureCollection', version: 'v1', features: [
    { type: 'Feature', id: 's1', properties: { id: 's1', puntos: 0, nivelRiesgo: 0, pendiente: false }, geometry: { type: 'LineString', coordinates: [[-75, -14], [-75.1, -14]] } },
    { type: 'Feature', id: 's2', properties: { id: 's2', puntos: 0, nivelRiesgo: 0, pendiente: false }, geometry: { type: 'LineString', coordinates: [[-75, -14], [-75.1, -14]] } },
  ] };
  const result = applyRoadRisk(geometry, { version: 'v1', revision: 'new', values: [['s1', 9, 4, true]] });
  assert.equal(result.features[0].properties?.nivelRiesgo, 4);
  assert.equal(geometry.features[0].properties.nivelRiesgo, 0);
  // Backend intentionally sends sparse risk values; omitted roads keep base properties.
  assert.equal(result.features[1].properties?.nivelRiesgo, 0);
  assert.throws(() => applyRoadRisk(geometry, { version: 'v1', revision: 'broken', values: [['s1', NaN, 8, true]] }), /incompletos/);
  assert.equal(result.features[0].properties?.nivelRiesgo, 4);
  assert.throws(() => applyRoadRisk(geometry, { version: 'v2', revision: 'new', values: [] }), /red vial cambió/);
});
