import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {watchMapPosition} = loadTs('lib/map-location.ts');
const sample = {coords: {latitude: -14.06, longitude: -75.72, accuracy: 9, speed: 1, heading: 90}, timestamp: 100};

test('browsing GPS delivers real fixes and clears its watcher exactly once on cleanup', () => {
    let callback, options;
    const fixes = [], stopped = [];
    const geo = {watchPosition: (ok, _fail, settings) => {callback = ok; options = settings; return 21;}, clearWatch: id => stopped.push(id)};
    const stop = watchMapPosition(geo, point => fixes.push(point), () => assert.fail('unexpected error'));
    callback(sample);
    stop(); stop(); callback(sample);
    assert.deepEqual(fixes, [{latitud: -14.06, longitud: -75.72, accuracy: 9, speed: 1, heading: 90, timestamp: 100}]);
    assert.deepEqual(stopped, [21]);
    assert.equal(options.enableHighAccuracy, true);
    assert.equal(options.maximumAge, 10000);
});

test('denied GPS stops watching and late samples cannot restore a revoked location', () => {
    let callback, failure;
    const errors = [], stopped = [];
    const geo = {watchPosition: (ok, fail) => {callback = ok; failure = fail; return 22;}, clearWatch: id => stopped.push(id)};
    watchMapPosition(geo, () => assert.fail('fix after revocation'), error => errors.push(error));
    failure({code: 1}); callback(sample); failure({code: 2});
    assert.equal(errors.length, 1);
    assert.equal(errors[0].status, 'denied');
    assert.match(errors[0].message, /1 km/);
    assert.deepEqual(stopped, [22]);
});

test('invalid fixes, unavailable GPS and synchronous browser failure produce actionable errors', () => {
    const errors = [], stopped = [];
    watchMapPosition(undefined, () => assert.fail('no provider'), error => errors.push(error));
    watchMapPosition({watchPosition: ok => {ok({...sample, coords: {...sample.coords, latitude: NaN}}); return 23;}, clearWatch: id => stopped.push(id)}, () => assert.fail('invalid fix'), error => errors.push(error));
    watchMapPosition({watchPosition: (_ok, fail) => {fail({code: 3}); return 24;}, clearWatch: id => stopped.push(id)}, () => assert.fail('unavailable GPS'), error => errors.push(error));
    assert.equal(errors.length, 3);
    assert.ok(errors.every(error => error.status === 'unavailable'));
    assert.match(errors[1].message, /inválida/);
    assert.deepEqual(stopped, [23, 24]);
});
