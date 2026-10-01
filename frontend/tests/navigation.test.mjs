import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {parseRouteCache, readRouteCache, isRoute, isPosition} = loadTs('lib/route-cache.ts');
const {nearRoute, isRouteWarning, watchRoutePosition} = loadTs('lib/navigation.ts');
const route = {id: 'synthetic-route', nombre: 'Recorrido sintético', tipo: 'corta', distancia: 300, duracion: 90, puntosRiesgo: 0, nivelRiesgo: 0, advertencias: [], geometria: {type: 'LineString', coordinates: [[-75.73, -14.06], [-75.72, -14.06]]}};
const cached = {ruta: route, fecha: '2026-10-01T10:00:00Z', modo: 'walking'};
test('corrupt or structurally invalid route cache is safely discarded', () => {
    for (const raw of ['{broken', '{}', '[null]', JSON.stringify([{...cached, ruta: {...route, geometria: {type: 'LineString', coordinates: []}}}]), JSON.stringify([{...cached, fecha: 'bad-date'}])]) assert.deepEqual(parseRouteCache(raw), []);
    assert.equal(isRoute({...route, duracion: Infinity}), false);
    assert.equal(isRoute({...route, nivelRiesgo: 9}), false);
    assert.equal(isPosition({latitud: 100, longitud: -75}), false);
});
test('valid cache survives invalid neighboring entries and enforces account limits', () => {
    const values = [null, cached, {...cached, ruta: {...route, id: 'second'}}];
    const raw = JSON.stringify(values);
    assert.equal(parseRouteCache(raw, 1).length, 1);
    assert.equal(parseRouteCache(raw, 20).length, 2);
    const accounts = new Map([['civigo:rutas:1', raw], ['civigo:rutas:2', '[]']]);
    assert.equal(readRouteCache({getItem: key => accounts.get(key)}, 1, false).length, 1);
    assert.deepEqual(readRouteCache({getItem: key => accounts.get(key)}, 2, true), []);
    assert.deepEqual(readRouteCache({getItem: () => { throw new Error('storage blocked'); }}, 1, true), []);
});
test('warning uses current incidents; historical import and resolved incidents do not alert', () => {
    const incident = {estado: 'ACTIVO', fuente: 'CIUDADANO', historico: true, gravedad: 4, nivelRiesgo: 4};
    assert.equal(isRouteWarning(incident), true);
    assert.equal(isRouteWarning({...incident, estado: 'RESUELTO'}), false);
    assert.equal(isRouteWarning({...incident, fuente: 'DATACRIM'}), false);
    assert.equal(isRouteWarning({...incident, gravedad: null, nivelRiesgo: null, emergencia: true}), true);
    assert.equal(nearRoute({latitud: -14.06, longitud: -75.725}, route), true);
    assert.equal(nearRoute({latitud: -14.08, longitud: -75.725}, route), false);
});
test('GPS cleanup ignores late samples and stops the browser watch exactly once', () => {
    let success; const updates = [], stopped = [];
    const geo = {watchPosition: callback => { success = callback; return 7; }, clearWatch: id => stopped.push(id)};
    const stop = watchRoutePosition(geo, point => updates.push(point), () => assert.fail('unexpected GPS error'));
    success({coords: {latitude: -14.06, longitude: -75.725}}); stop(); stop();
    success({coords: {latitude: -14.065, longitude: -75.725}});
    assert.equal(updates.length, 1); assert.deepEqual(stopped, [7]);
});
test('denied, missing or invalid GPS stops tracking and reports the actual failure', () => {
    let success, failure; const messages = [], stopped = [];
    const geo = {watchPosition: (ok, fail) => { success = ok; failure = fail; return 8; }, clearWatch: id => stopped.push(id)};
    watchRoutePosition(geo, () => assert.fail('GPS sample after failure'), message => messages.push(message));
    failure({code: 1}); success({coords: {latitude: -14.06, longitude: -75.725}});
    assert.match(messages[0], /rechazado/); assert.deepEqual(stopped, [8]);
    watchRoutePosition(undefined, () => assert.fail('no GPS provider'), message => messages.push(message));
    assert.match(messages[1], /no permite/);
    watchRoutePosition(geo, () => assert.fail('invalid sample'), message => messages.push(message));
    success({coords: {latitude: NaN, longitude: -75.725}});
    assert.match(messages[2], /inválida/);
});
