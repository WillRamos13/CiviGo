import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NavigationService, AutoRerouteGuard, isRoute, isPosition, isUsableFix, isNavigationAccountCurrent, getRouteProgress, routeWarnings, onFavoritesChanged } from '../src/services/navigation';
import { RoutePlanner } from '../src/components/navigation/RoutePlanner';
import type { Ruta, RouteStep } from '../src/types';

const step = (id: string, distance: number, instruction: string, duration: number): RouteStep => ({
  id, tipo: id, maniobra: id, instruccion: instruction, calle: '', distancia: 111, duracion: 60,
  distanciaAcumulada: distance, duracionAcumulada: duration, coordenadas: [0, 0], indiceInicio: 0, indiceFin: 1,
  geometria: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] },
});
const route: Ruta = {
  id: 'test-route', nombre: 'Ruta aislada', tipo: 'segura', distancia: 222, duracion: 120,
  geometria: { type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.002, 0]] },
  puntosRiesgo: 0, nivelRiesgo: 0, advertencias: ['Precaución en el cruce'], riesgoConocido: false,
  pasos: [step('salida', 0, 'Continúa por la calle', 0), step('derecha', 111, 'Gira a la derecha', 60), { ...step('llegada', 222, 'Comprueba el acceso', 120), distancia: 0, duracion: 0 }],
};

test('rejects corrupt route geometry and unbounded coordinates', () => {
  assert.equal(isRoute(route), true);
  for (const bad of [NaN, Infinity, -1]) assert.equal(isRoute({ ...route, distancia: bad }), false);
  assert.equal(isRoute({ ...route, geometria: { type: 'LineString', coordinates: [] } }), false);
  assert.equal(isRoute({ ...route, geometria: { type: 'LineString', coordinates: [[181, 0], [0, 0]] } }), false);
  assert.equal(isPosition({ latitud: 0, longitud: 0 }), true);
  assert.equal(isPosition({ latitud: 91, longitud: 0 }), false);
});

test('GPS progress advances next instruction and remaining distance/time', () => {
  const first = getRouteProgress(route, { latitud: 0, longitud: 0.0005 });
  assert.equal(first.step?.id, 'salida');
  assert.equal(first.nextStep?.id, 'derecha');
  assert.ok(first.distanceToNext > 50 && first.distanceToNext < 60);
  const later = getRouteProgress(route, { latitud: 0, longitud: 0.0015 });
  assert.equal(later.step?.id, 'derecha');
  assert.ok(later.remainingDistance < first.remainingDistance);
  assert.ok(later.remainingDuration < first.remainingDuration);
  assert.equal(getRouteProgress(route, { latitud: 0, longitud: 0.002 }).arrived, true);
});

test('stale, inaccurate and off-route GPS never produce arrival', () => {
  const now = 100000;
  assert.equal(isUsableFix({ latitud: 0, longitud: 0, timestamp: now - 31000 }, now), false);
  assert.equal(isUsableFix({ latitud: 0, longitud: 0, accuracy: 300 }, now), false);
  const offRoute = getRouteProgress(route, { latitud: 0.02, longitud: 0.002 });
  assert.equal(offRoute.offRoute, true);
  assert.equal(offRoute.arrived, false);
  assert.equal(offRoute.remainingDistance, route.distancia);
  assert.equal(getRouteProgress(route, { latitud: 0.0004, longitud: 0.002 }).arrived, false);
});

test('automatic reroute requires sustained precise fixes and enforces cooldown', () => {
  const guard = new AutoRerouteGuard();
  const fix = (timestamp: number, accuracy = 10) => ({ latitud: 0.002, longitud: 0.001, timestamp, accuracy });
  assert.equal(guard.shouldReroute(fix(100000), true, 100000), false);
  assert.equal(guard.shouldReroute(fix(100000), true, 108000), false, 'single stale sample cannot trigger');
  assert.equal(guard.shouldReroute(fix(104000), true, 104000), false);
  assert.equal(guard.shouldReroute(fix(108000), true, 108000), true);
  assert.equal(guard.shouldReroute(fix(110000), true, 110000), false, 'cooldown');
  assert.equal(guard.shouldReroute(fix(128000), true, 128000), true);
  assert.equal(guard.shouldReroute(fix(150000, 90), true, 150000), false, 'inaccurate GPS resets evidence');
  assert.equal(guard.shouldReroute(fix(154000), true, 154000), false);
  assert.equal(guard.shouldReroute(fix(158000), false, 158000), false, 'returning to route resets evidence');
  assert.equal(guard.shouldReroute(fix(162000), true, 162000), false);
  assert.equal(guard.shouldReroute(fix(166000), true, 166000), false);
  assert.equal(guard.shouldReroute(fix(170000), true, 170000, false), false, 'offline/busy does not request');
  assert.equal(guard.shouldReroute(fix(174000), true, 174000, true), true);
});

test('compact guidance includes next maneuver, actual GPS speed availability, ETA source and exit', () => {
  const html = renderToStaticMarkup(React.createElement(RoutePlanner, {
    currentPosition: { latitud: 0, longitud: 0.0005 }, activeRoute: route,
    onSelectRoute: () => {}, isNavigating: true, compact: true,
  }));
  for (const text of ['Indicaciones del recorrido', 'gn-compact-summary', 'Gira a la derecha', 'gn-compact-maneuver', 'restantes', 'Llegada', 'Velocidad GPS no disponible', 'sin tráfico en vivo', 'aria-label="Salir de navegación"']) assert.ok(html.includes(text), text);
  for (const text of ['gn-turn-row', 'Recalcular', 'Silenciar voz', 'Condiciones del recorrido', 'Precaución en el cruce', 'Riesgo sin verificar', 'spotify-shortcut', 'aria-label="Centrar"']) assert.ok(!html.includes(text), text);
  assert.equal((html.match(/<button\b/g) || []).length, 1);
});

test('expanded guidance retains turns, voice, recalculation, conditions and finish', () => {
  const html = renderToStaticMarkup(React.createElement(RoutePlanner, {
    currentPosition: { latitud: 0, longitud: 0.0005 }, activeRoute: route,
    onSelectRoute: () => {}, isNavigating: true, compact: false,
  }));
  for (const text of ['Gira a la derecha', 'siguiente indicación', 'restantes', 'Llegada aprox.', 'Finalizar', 'Precaución en el cruce', 'Riesgo sin verificar', 'Sin tráfico en vivo', 'Recalcular', 'Silenciar voz']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('gn-compact-summary'));
});

test('compact navigation preserves short accessible GPS and emergency states without live ETA', () => {
  const html = renderToStaticMarkup(React.createElement(RoutePlanner, {
    currentPosition: null, activeRoute: { ...route, advertencias: ['Hay una emergencia en este recorrido.'] },
    onSelectRoute: () => {}, isNavigating: true, compact: true,
  }));
  for (const text of ['GPS pendiente', 'Alerta en la ruta', 'Última estimación', 'role="alert"', 'aria-label="GPS sin señal reciente']) assert.ok(html.includes(text), text);
  for (const text of ['Llegada ', 'gn-turn-row', 'Condiciones del recorrido', 'GPS activo']) assert.ok(!html.includes(text), text);
});

test('missing risk and live traffic remain explicit instead of claiming safe conditions', () => {
  const warnings = routeWarnings({ ...route, copiaGuardada: true });
  assert.ok(warnings.some((value) => value.includes('Riesgo sin verificar')));
  assert.ok(warnings.some((value) => value.includes('Sin tráfico en vivo')));
  assert.ok(warnings.some((value) => value.includes('Copia guardada')));
});

test('real navigation service sends explicit mode and forwards cancellation to fetch', async () => {
  const original = globalThis.fetch;
  let requested: any;
  try {
    globalThis.fetch = async (_url, options) => { requested = options; return new Response(JSON.stringify({ rutas: [route] }), { status: 200 }); };
    const controller = new AbortController();
    const result = await NavigationService.planRoute({ latitud: 0, longitud: 0 }, { latitud: 0, longitud: 0.002 }, 'cycling', controller.signal);
    assert.equal(JSON.parse(requested.body).modo, 'cycling');
    assert.ok(requested.signal instanceof AbortSignal);
    assert.equal(result[0].id, route.id);
    controller.abort();
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('must not call network'); };
    await assert.rejects(() => NavigationService.planRoute({ latitud: 0, longitud: 0 }, { latitud: 0, longitud: 1 }, 'walking', controller.signal));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('late response from an aborted plan cannot replace a newer result', async () => {
  const original = globalThis.fetch;
  let resolveOld: (response: Response) => void = () => {};
  let count = 0;
  try {
    globalThis.fetch = async () => {
      count++;
      if (count === 1) return new Promise<Response>((resolve) => { resolveOld = resolve; });
      return new Response(JSON.stringify({ rutas: [{ ...route, id: 'new-route' }] }));
    };
    const oldController = new AbortController();
    const oldPlan = NavigationService.planRoute({ latitud: 0, longitud: 0 }, { latitud: 0, longitud: 1 }, 'walking', oldController.signal);
    const oldRejected = assert.rejects(oldPlan, (error: Error) => error.name === 'AbortError');
    oldController.abort();
    const latest = await NavigationService.planRoute({ latitud: 0, longitud: 0 }, { latitud: 0, longitud: 2 }, 'driving');
    resolveOld(new Response(JSON.stringify({ rutas: [route] })));
    await oldRejected;
    assert.equal(latest[0].id, 'new-route');
    globalThis.fetch = async () => new Response(JSON.stringify({ rutas: [{ ...route, pasos: {} }] }));
    await assert.rejects(() => NavigationService.planRoute({ latitud: 0, longitud: 0 }, { latitud: 0, longitud: 1 }), /ruta incompleta/);
  } finally { globalThis.fetch = original; }
});

test('route planning rejects a transport mismatch and driving traffic attached to a walking estimate', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ rutas: [{ ...route, modo: 'driving' }] }));
    await assert.rejects(() => NavigationService.planRoute({ latitud: 0, longitud: 0 }, { latitud: 0, longitud: .002 }, 'walking'), /ruta incompleta/);
    globalThis.fetch = async () => new Response(JSON.stringify({ rutas: [{ ...route, trafico: {
      disponible: true, fuente: 'TOMTOM', actualizadoEn: new Date().toISOString(), demoraSegundos: 5, motivo: 'Tráfico vehicular',
    } }] }));
    await assert.rejects(() => NavigationService.planRoute({ latitud: 0, longitud: 0 }, { latitud: 0, longitud: .002 }, 'walking'), /ruta incompleta/);
  } finally { globalThis.fetch = original; }
});

test('place search calls the real backend contract, encodes query and rejects corrupt results', async () => {
  const original = globalThis.fetch;
  let requested = '';
  let count = 0;
  try {
    globalThis.fetch = async (input) => { requested = String(input); count++; return new Response(JSON.stringify([{ nombre: 'Hospital Ica', latitud: -14.07, longitud: -75.73, fuente: 'OpenStreetMap' }])); };
    assert.deepEqual(await NavigationService.searchPlaces('Ic'), []);
    assert.equal(count, 0);
    const places = await NavigationService.searchPlaces('Calle A & B');
    assert.equal(places[0].nombre, 'Hospital Ica');
    const requestUrl = new URL(requested, 'http://local.test');
    assert.equal(requestUrl.pathname, '/api/navigation/places');
    assert.equal(requestUrl.search, '?q=Calle+A+%26+B');
    globalThis.fetch = async () => new Response(JSON.stringify([{ nombre: 'Dato roto', latitud: 200, longitud: -75 }]));
    await assert.rejects(() => NavigationService.searchPlaces('Hospital'), /lugares incompletos/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => NavigationService.searchPlaces('Hospital', controller.signal), (error: Error) => error.name === 'AbortError');
  } finally { globalThis.fetch = original; }
});

test('planner includes searchable destination and coordinate fallback controls', () => {
  const html = renderToStaticMarkup(React.createElement(RoutePlanner, { activeRoute: null, onSelectRoute: () => {} }));
  for (const text of ['Buscar destino en Ica', 'gn-search-launch', 'Usar coordenadas del destino', 'route-latitude', 'route-longitude', 'Accesos locales en Ica']) assert.ok(html.includes(text), text);
  for (const text of ['gn-origin', 'Mi ubicación actual', '>Origen<']) assert.ok(!html.includes(text), text);
});

test('retained navigation belongs to the same authorized account across views', () => {
  const user = { id: 1, bloqueado: false };
  assert.equal(isNavigationAccountCurrent(1, user), true, 'the same account can resume its retained map');
  assert.equal(isNavigationAccountCurrent(1, { ...user, id: 2 }), false, 'account B cannot resume or recalculate route A');
  assert.equal(isNavigationAccountCurrent(1, { ...user, bloqueado: true }), false, 'revoked access cannot keep navigation active');
  assert.equal(isNavigationAccountCurrent(1, null), false, 'sign out removes access immediately');
  assert.equal(isNavigationAccountCurrent(undefined, user), false, 'an invalidated route cannot attach itself to a new session');
});

test('confirmed favorite mutations notify retained views; failures and disposed views do not', async () => {
  const original = globalThis.fetch;
  let changes = 0;
  const unsubscribe = onFavoritesChanged(() => { changes++; });
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ id: 1, datos: route }));
    await NavigationService.addFavorite('Destino', [], route, { latitud: 0, longitud: 0 }, { latitud: 0, longitud: 0.002 }, 'walking');
    assert.equal(changes, 1, 'a successful save invalidates the other view');
    await NavigationService.removeFavorite(1);
    assert.equal(changes, 2, 'deleting from profile also invalidates the retained map');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'No permitido' }), { status: 403 });
    await assert.rejects(() => NavigationService.removeFavorite(1), /No permitido/);
    assert.equal(changes, 2, 'a failed mutation cannot announce a new snapshot');
    unsubscribe();
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }));
    await NavigationService.removeFavorite(1);
    assert.equal(changes, 2, 'unmounted views must not receive notifications');
  } finally { unsubscribe(); globalThis.fetch = original; }
});
