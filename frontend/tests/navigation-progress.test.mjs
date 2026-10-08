import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {navigationProgress, formatMeters, watchRoutePosition} = loadTs('lib/navigation.ts');
const {isRoute} = loadTs('lib/route-cache.ts');
const route = {id: 'route', nombre: 'Más rápida', tipo: 'rapida', distancia: 2200, duracion: 600, puntosRiesgo: 2, nivelRiesgo: 1, advertencias: [], geometria: {type: 'LineString', coordinates: [[-75.73, -14.06], [-75.72, -14.06], [-75.72, -14.05]]}, destino: {longitud: -75.72, latitud: -14.05}, pasos: [
    {id: 'start', tipo: 'salida', maniobra: 'salida', instruccion: 'Avanza', distanciaAcumulada: 0, indiceInicio: 0, indiceFin: 1},
    {id: 'turn', tipo: 'izquierda', maniobra: 'izquierda', instruccion: 'Gira a la izquierda', distanciaAcumulada: 1080, indiceInicio: 1, indiceFin: 2},
    {id: 'arrive', tipo: 'llegada', maniobra: 'llegada', instruccion: 'Llegaste', distanciaAcumulada: 2200, indiceInicio: 2, indiceFin: 2},
]};
test('GPS projection advances instructions and ETA without counting GPS drift as travel', () => {
    const halfway = navigationProgress({latitud: -14.06, longitud: -75.725}, route);
    assert.equal(halfway.instruction, 'Gira a la izquierda'); assert.equal(halfway.maneuver, 'izquierda');
    assert.ok(halfway.distanceToTurn > 500 && halfway.distanceToTurn < 600);
    assert.ok(halfway.distanceRemaining < 1700 && halfway.distanceRemaining > 1600);
    assert.ok(halfway.secondsRemaining < 460 && halfway.secondsRemaining > 440);
    assert.ok(halfway.offRouteMeters < 1); assert.equal(halfway.heading, 90);
    const afterTurn = navigationProgress({latitud: -14.055, longitud: -75.72}, route);
    assert.equal(afterTurn.stepId, 'arrive'); assert.ok(afterTurn.distanceRemaining < halfway.distanceRemaining);
    const off = navigationProgress({latitud: -14.065, longitud: -75.725}, route);
    assert.ok(off.offRouteMeters > 500); assert.ok(Math.abs(off.progressMeters - halfway.progressMeters) < 1);
});
test('arrival follows original destination and heading falls back to road geometry', () => {
    const arrived = navigationProgress({latitud: -14.05, longitud: -75.72, heading: -1}, route);
    assert.equal(arrived.destinationMeters, 0); assert.equal(arrived.distanceRemaining, 0); assert.equal(arrived.secondsRemaining, 0);
    assert.equal(arrived.heading, 0); assert.equal(navigationProgress({latitud: -14.055, longitud: -75.72, heading: 12}, route).heading, 12);
    assert.equal(formatMeters(560), '560 m'); assert.equal(formatMeters(1570), '1.6 km');
});
test('new route caches accept fastest and reject malformed navigation steps', () => {
    assert.equal(isRoute(route), true); assert.equal(isRoute({...route, pasos: [null]}), false);
    assert.equal(isRoute({...route, pasos: [{...route.pasos[0], distanciaAcumulada: NaN}]}), false);
});
test('ETA subtracts traffic time by the current step instead of uniformly by meters', () => {
    const trafficRoute = {...route, duracion: 600, pasos: route.pasos.map((s, i) => ({...s, duracion: i === 0 ? 500 : i === 1 ? 100 : 0, duracionAcumulada: i === 0 ? 0 : i === 1 ? 500 : 600}))};
    const afterTurn = navigationProgress({latitud: -14.055, longitud: -75.72}, trafficRoute);
    assert.ok(afterTurn.secondsRemaining > 49 && afterTurn.secondsRemaining < 51);
});
test('GPS accuracy, heading, speed and timestamp reach navigation without inventing missing values', () => {
    let result; let callback;
    const stop = watchRoutePosition({watchPosition: fn => { callback = fn; return 1; }, clearWatch() {}}, fix => {result = fix;}, assert.fail);
    callback({coords: {latitude: -14.06, longitude: -75.72, accuracy: 18, heading: null, speed: 1.4}, timestamp: 1000});
    assert.deepEqual(result, {latitud: -14.06, longitud: -75.72, accuracy: 18, speed: 1.4, timestamp: 1000}); stop();
});
