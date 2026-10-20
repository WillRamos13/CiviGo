import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindIncidentMarkerZoom, INCIDENT_MARKER_MIN_ZOOM, incidentTypeKey, filterMapIncidents,
  syncTrafficLayer, TRAFFIC_SOURCE_ID, TRAFFIC_LAYER_ID } from '../src/services/mapLayers';
import type { Incidente } from '../src/types';

test('marker zoom threshold is immediate, stable and detaches only its own listener', () => {
  let zoom = 13.5;
  const classes = new Set<string>(['user-gps-marker']);
  const handlers = new Map<string, Set<() => void>>();
  let toggles = 0;
  const observed: boolean[] = [];
  const map: any = {
    getZoom: () => zoom,
    getContainer: () => ({ classList: {
      toggle: (name: string, visible: boolean) => { toggles++; visible ? classes.add(name) : classes.delete(name); },
      remove: (name: string) => classes.delete(name),
    } }),
    on: (event: string, fn: () => void) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(fn); },
    off: (event: string, fn: () => void) => handlers.get(event)?.delete(fn),
  };
  const unrelated = () => {};
  map.on('zoom', unrelated);
  const stop = bindIncidentMarkerZoom(map, visible => observed.push(visible));
  assert.equal(INCIDENT_MARKER_MIN_ZOOM, 14);
  assert.equal(classes.has('incident-markers-visible'), false);
  zoom = 13.99; handlers.get('zoom')!.forEach(fn => fn());
  assert.equal(toggles, 1, 'camera frames within the same range do not trigger DOM changes');
  zoom = 14; handlers.get('zoom')!.forEach(fn => fn());
  assert.equal(classes.has('incident-markers-visible'), true);
  zoom = 9; handlers.get('zoom')!.forEach(fn => fn());
  assert.equal(classes.has('incident-markers-visible'), false);
  assert.deepEqual(observed, [false, true, false]);
  stop();
  assert.equal(handlers.get('zoom')!.size, 1);
  assert.ok(handlers.get('zoom')!.has(unrelated));
  assert.ok(classes.has('user-gps-marker'), 'GPS and other markers are not hidden');
});

test('type filter normalizes labels and never mutates the complete incident snapshot', () => {
  const incidents = [
    { id: 1, tipo: 'Persona sospechosa', tipoSlug: 'persona-sospechosa' },
    { id: 2, tipo: 'Vehículo averiado' },
    { id: 3, tipo: 'vehiculo averiado' },
  ] as Incidente[];
  assert.equal(incidentTypeKey(incidents[1]), 'vehiculo-averiado');
  assert.deepEqual(filterMapIncidents(incidents, 'vehiculo-averiado').map(i => i.id), [2, 3]);
  assert.equal(filterMapIncidents(incidents, ''), incidents);
  assert.equal(incidents.length, 3);
});

function fakeMap() {
  const sources = new Map<string, any>(), layers = new Map<string, any>();
  return { sources, layers,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: any) => sources.set(id, { ...spec, updates: 0, setTiles(tiles: string[]) { this.tiles = tiles; this.updates++; } }),
    getLayer: (id: string) => layers.get(id),
    addLayer: (spec: any, before: string) => layers.set(spec.id, { ...spec, before, layout: {} }),
    getStyle: () => ({ layers: [{ id: 'street-label', type: 'symbol', layout: { 'text-field': 'name' } }] }),
    setLayoutProperty: (id: string, name: string, value: unknown) => { layers.get(id).layout[name] = value; },
  };
}

test('traffic creates a bounded raster below labels, toggles and refreshes without replacing the layer', () => {
  const map = fakeMap();
  const url = 'https://civigo.online/api/navigation/traffic/tiles/flow/{z}/{x}/{y}.png?v=1';
  const bounds: [number, number, number, number] = [-76.3, -15, -75.1, -13.3];
  syncTrafficLayer(map as any, false, url, bounds);
  assert.equal(map.sources.size, 0);
  syncTrafficLayer(map as any, true, url, bounds);
  const source = map.sources.get(TRAFFIC_SOURCE_ID), layer = map.layers.get(TRAFFIC_LAYER_ID);
  assert.deepEqual(source.bounds, bounds);
  assert.deepEqual(source.tiles, [url]);
  assert.equal(source.attribution, '© TomTom');
  assert.equal(source.minzoom, 5);
  assert.equal(source.maxzoom, 18);
  assert.equal(layer.before, 'street-label');
  assert.equal(layer.layout.visibility, 'visible');
  syncTrafficLayer(map as any, true, url, bounds);
  assert.equal(source.updates, 0);
  syncTrafficLayer(map as any, false, url, bounds);
  assert.equal(layer.layout.visibility, 'none');
  syncTrafficLayer(map as any, true, url.replace('v=1', 'v=2'), bounds);
  assert.equal(source.updates, 1);
  assert.equal(map.layers.get(TRAFFIC_LAYER_ID), layer);
  assert.equal(layer.layout.visibility, 'visible');
  map.sources.clear(); map.layers.clear();
  syncTrafficLayer(map as any, true, url, bounds);
  assert.equal(map.sources.size, 1, 'state can be reapplied after a style reset');
});
