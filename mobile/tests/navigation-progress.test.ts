import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNavigationRouteLines, getRouteProgress, RouteProgressTracker } from '../src/services/navigationProgress';
import { NavigationSpeedFilter } from '../src/services/navigationSpeed';
import { routeArrivalLabel, routeEstimateSource } from '../src/services/navigationPresentation';
import { isRoute } from '../src/services/navigation';
import type { LocationFix, Ruta } from '../src/types';

const route: Ruta = { id: 'straight', nombre: 'Fixture aislada', tipo: 'rapida', distancia: 1112, duracion: 120,
  geometria: { type: 'LineString', coordinates: [[0, 0], [.002, 0], [.004, 0], [.006, 0], [.008, 0], [.01, 0]] },
  puntosRiesgo: 0, nivelRiesgo: 0, advertencias: [], modo: 'driving', fuente: 'OpenStreetMap' };
const fix = (longitude: number, timestamp: number, extra: Partial<LocationFix> = {}): LocationFix => ({
  longitud: longitude, latitud: 0, accuracy: 5, timestamp, ...extra,
});

test('route projection splits completed and pending lines without mutating source geometry', () => {
  const original = JSON.stringify(route);
  const tracker = new RouteProgressTracker();
  const first = tracker.update(route, fix(.003, 100000), 100000);
  const lines = getNavigationRouteLines(route, first);
  assert.ok(first.coveredDistance > 330 && first.coveredDistance < 335);
  assert.equal(first.projection?.segmentIndex, 1);
  assert.deepEqual(lines.completed?.coordinates, [[0, 0], [.002, 0], [.003, 0]]);
  assert.deepEqual(lines.pending?.coordinates[0], [.003, 0]);
  assert.deepEqual(lines.pending?.coordinates.at(-1), [.01, 0]);
  assert.equal(JSON.stringify(route), original);
  lines.pending!.coordinates[0][0] = 90;
  assert.equal(JSON.stringify(route), original, 'consumer changes cannot mutate source');
});

test('consecutive precise fixes advance distance and duration while small GPS reversal does not erase progress', () => {
  const tracker = new RouteProgressTracker();
  const a = tracker.update(route, fix(.003, 100000), 100000);
  const b = tracker.update(route, fix(.004, 105000), 105000);
  const jitter = tracker.update(route, fix(.00394, 106000), 106000);
  assert.ok(b.coveredDistance > a.coveredDistance);
  assert.ok(b.remainingDuration < a.remainingDuration);
  assert.equal(jitter.coveredDistance, b.coveredDistance);
  assert.equal(jitter.offRoute, false);
});

test('stale or imprecise GPS freezes completed road, while a real deviation is reported', () => {
  const tracker = new RouteProgressTracker();
  const good = tracker.update(route, fix(.004, 100000), 100000);
  for (const unusable of [fix(.008, 100000), fix(.008, 140000, { accuracy: 75 })]) {
    const next = tracker.update(route, unusable, 140000);
    assert.equal(next.hasFix, false); assert.equal(next.coveredDistance, good.coveredDistance);
    assert.equal(next.arrived, false);
  }
  const offRoute = tracker.update(route, fix(.005, 145000, { latitud: .002 }), 145000);
  assert.equal(offRoute.offRoute, true);
  assert.equal(offRoute.coveredDistance, good.coveredDistance);
  const returned = tracker.update(route, fix(.006, 150000), 150000);
  assert.equal(returned.offRoute, false);
  assert.ok(returned.coveredDistance > good.coveredDistance);
});

test('an impossible GPS jump and out-of-order sample cannot skip the route or declare arrival', () => {
  const tracker = new RouteProgressTracker();
  const a = tracker.update(route, fix(.001, 100000), 100000);
  const jump = tracker.update(route, fix(.01, 101000), 101000);
  assert.equal(jump.coveredDistance, a.coveredDistance);
  assert.equal(jump.accepted, false); assert.equal(jump.arrived, false);
  const old = tracker.update(route, fix(.009, 99000), 101000);
  assert.equal(old.hasFix, false); assert.equal(old.coveredDistance, a.coveredDistance);
});

test('backwards travel is treated as deviation, rather than moving the blue completion backwards', () => {
  const tracker = new RouteProgressTracker();
  const a = tracker.update(route, fix(.006, 100000), 100000);
  const reverse = tracker.update(route, fix(.004, 110000), 110000);
  assert.equal(reverse.offRoute, true);
  assert.equal(reverse.coveredDistance, a.coveredDistance);
});

test('self-intersections choose the continuous occurrence rather than a later lap', () => {
  const loop: Ruta = { ...route, distancia: 5000, geometria: { type: 'LineString', coordinates:
    [[0, 0], [.01, 0], [.01, .01], [0, .01], [0, 0], [.02, 0]] } };
  const tracker = new RouteProgressTracker();
  const start = tracker.update(loop, fix(.0001, 100000), 100000);
  assert.ok(start.projectedGeometryDistance < 20);
  const next = tracker.update(loop, fix(.0002, 101000), 101000);
  assert.ok(next.projectedGeometryDistance < 30);
});

test('restored progress is retained without GPS, and a new route geometry starts a new journey', () => {
  const tracker = new RouteProgressTracker(); tracker.seed(route, 600);
  assert.equal(tracker.update(route, null).coveredDistance, 600);
  assert.equal(tracker.update(route, fix(.002, 100000), 100000).coveredDistance, 600);
  const recalculated = { ...route, id: 'new-plan' };
  assert.equal(tracker.update(recalculated, null).coveredDistance, 0);
  tracker.reset(); assert.equal(tracker.update(route, null).coveredDistance, 0);
});

test('line splitting handles start, exact vertices, duplicate points and completion', () => {
  const start = getNavigationRouteLines(route, getRouteProgress(route, null));
  assert.equal(start.completed, null); assert.equal(start.pending?.coordinates.length, 6);
  const vertex = getNavigationRouteLines(route, getRouteProgress(route, { latitud: 0, longitud: .004 }));
  assert.deepEqual(vertex.completed?.coordinates.at(-1), [.004, 0]);
  assert.equal(vertex.pending?.coordinates.filter(point => point[0] === .004).length, 1);
  const end = getNavigationRouteLines(route, getRouteProgress(route, { latitud: 0, longitud: .01 }));
  assert.equal(end.pending, null); assert.deepEqual(end.completed?.coordinates, route.geometria.coordinates);
  const duplicate: Ruta = { ...route, geometria: { type: 'LineString', coordinates: [[0, 0], [0, 0], [.01, 0]] } };
  assert.ok(Number.isFinite(getRouteProgress(duplicate, { latitud: 0, longitud: .005 }).remainingDistance));
});

test('GPS speed uses meters/second, supports real zero, and never infers a legal limit', () => {
  const speed = new NavigationSpeedFilter();
  assert.deepEqual(speed.update(fix(0, 100000, { speed: 10 }), 100000), { kmh: 36, available: true });
  speed.reset();
  assert.deepEqual(speed.update(fix(0, 100000, { speed: 0 }), 100000), { kmh: 0, available: true });
  assert.equal('limit' in speed.update(fix(0, 100000, { speed: 0 }), 100000), false);
});

test('GPS speed rejects unavailable, stale, poor, impossible and abrupt measurements', () => {
  for (const sample of [fix(0, 100000), fix(0, 100000, { speed: -1 }), fix(0, 100000, { speed: NaN }),
    fix(0, 100000, { speed: 120 }), fix(0, 100000, { speed: 10, accuracy: 80 }),
    fix(0, 90000, { speed: 10 }), fix(0, 110000, { speed: 10 })]) {
    assert.deepEqual(new NavigationSpeedFilter().update(sample, 100000), { kmh: null, available: false });
  }
  const speed = new NavigationSpeedFilter();
  speed.update(fix(0, 100000, { speed: 10 }), 100000);
  assert.equal(speed.update(fix(0, 101000, { speed: 60 }), 101000).available, false);
  assert.equal(speed.update(fix(0, 101000, { speed: 60 }), 101001).available, false, 'duplicate rejected sample stays unavailable');
  assert.ok(speed.update(fix(0, 102000, { speed: 11 }), 102000).available);
  assert.equal(speed.update(fix(0, 102000, { speed: 11 }), 111000).available, false);
});

test('speed median filters small jitter and reset removes values of the previous journey', () => {
  const speed = new NavigationSpeedFilter();
  [10, 11, 9, 10, 12].forEach((value, index) => speed.update(fix(0, 100000 + index * 1000, { speed: value }), 100000 + index * 1000));
  assert.deepEqual(speed.update(fix(0, 104000, { speed: 12 }), 104000), { kmh: 36, available: true });
  speed.reset(); assert.equal(speed.update(null).available, false);
});

test('ETA source distinguishes actual fresh TomTom traffic, outdated traffic and theoretical local estimate', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const traffic: Ruta = { ...route, actualizadoEn: '2026-10-20T11:59:00Z',
    trafico: { disponible: true, fuente: 'TOMTOM', actualizadoEn: '2026-10-20T11:59:00Z', demoraSegundos: 10, motivo: 'Duración del proveedor.' } };
  assert.equal(routeEstimateSource(traffic, now).live, true);
  assert.equal(routeEstimateSource(traffic, now + 600000).stale, true);
  assert.equal(routeEstimateSource(traffic, now + 600000).live, false);
  assert.ok(routeEstimateSource(route, now).label.includes('OpenStreetMap'));
  assert.ok(routeEstimateSource(route, now).label.includes('sin tráfico en vivo'));
  const oldLocal = { ...route, actualizadoEn: '2026-10-20T11:00:00Z' };
  assert.equal(routeEstimateSource(oldLocal, now).stale, true);
  assert.ok(routeEstimateSource(oldLocal, now).label.includes('datos antiguos'));
  assert.ok(routeEstimateSource({ ...oldLocal, copiaGuardada: true }, now).label.includes('recorrido guardado'));
  const missingDate = { ...traffic, trafico: { ...traffic.trafico!, actualizadoEn: null } };
  assert.equal(routeEstimateSource(missingDate, now).live, false);
  assert.ok(routeEstimateSource(missingDate, now).label.includes('sin verificar'));
  assert.equal(routeEstimateSource({ ...traffic, copiaGuardada: true }, now).live, false);
  const missingProvider = { ...traffic, trafico: { ...traffic.trafico!, fuente: null } };
  assert.equal(routeEstimateSource(missingProvider, now).live, false);
  assert.ok(routeEstimateSource(missingProvider, now).label.includes('fuente sin verificar'));
});

test('planning respects server arrival while navigation derives ETA from its actual remaining duration', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const planned = { ...route, duracion: 120, llegadaEstimada: '2026-10-20T12:03:00Z' };
  const format = (time: number) => new Date(time).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });
  assert.equal(routeArrivalLabel(planned, 120, now), format(now + 180000));
  assert.equal(routeArrivalLabel(planned, 60, now, true), format(now + 60000));
  assert.equal(routeArrivalLabel(planned, NaN, now, true), null);
});

test('malformed traffic metadata is rejected at the actual route contract boundary', () => {
  for (const trafico of [{ disponible: 'yes' }, { disponible: true, fuente: 'TOMTOM', actualizadoEn: null, demoraSegundos: -2, motivo: '' }]) {
    assert.equal(isRoute({ ...route, trafico }), false);
  }
});
