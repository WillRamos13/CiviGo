import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {trafficAffectsRoute} = loadTs('lib/traffic.ts');
const route = {geometria: {type: 'LineString', coordinates: [[-75.73, -14.06], [-75.72, -14.06]]}};
const point = (longitude, latitude) => ({geometria: {type: 'Point', coordinates: [longitude, latitude]}});
const line = coordinates => ({geometria: {type: 'LineString', coordinates}});

test('Point incidents affect the route only within the requested distance', () => {
    assert.equal(trafficAffectsRoute(point(-75.725, -14.0605), route), true);
    assert.equal(trafficAffectsRoute(point(-75.725, -14.061), route), false);
    assert.equal(trafficAffectsRoute(point(-75.725, -14.0605), route, 40), false);
    assert.equal(trafficAffectsRoute(point(-75.725, -14.06), route, 0), true);
});

test('a traffic segment crossing the route affects it even when every vertex is distant', () => {
    const coordinates = [[-75.725, -14.065], [-75.725, -14.055]];
    for (const c of coordinates) assert.equal(trafficAffectsRoute(point(...c), route), false);
    assert.equal(trafficAffectsRoute(line(coordinates), route), true);
    assert.equal(trafficAffectsRoute(line([...coordinates].reverse()), route), true);
});

test('parallel traffic segments are distinguished by their actual separation', () => {
    assert.equal(trafficAffectsRoute(line([[-75.731, -14.0605], [-75.719, -14.0605]]), route), true);
    assert.equal(trafficAffectsRoute(line([[-75.731, -14.061], [-75.719, -14.061]]), route), false);
    assert.equal(trafficAffectsRoute(line([[-75.71, -14.06], [-75.709, -14.06]]), route), false);
    assert.equal(trafficAffectsRoute(line([[-75.731, -14.06], [-75.719, -14.06]]), route, 0), true);
});

test('route bends and repeated coordinates do not hide a crossing or create a false match', () => {
    const bent = {geometria: {type: 'LineString', coordinates: [[-75.73, -14.06], [-75.73, -14.06], [-75.72, -14.06], [-75.72, -14.05]]}};
    assert.equal(trafficAffectsRoute(line([[-75.725, -14.055], [-75.715, -14.055]]), bent), true);
    assert.equal(trafficAffectsRoute(line([[-75.725, -14.065], [-75.725, -14.065]]), bent), false);
    assert.equal(trafficAffectsRoute(line([[-75.725, -14.06], [-75.725, -14.06]]), bent), true);
});

test('missing routes or invalid geometry do not trigger traffic replanning', () => {
    assert.equal(trafficAffectsRoute(point(-75.725, -14.06), null), false);
    assert.equal(trafficAffectsRoute(line([]), route), false);
    assert.equal(trafficAffectsRoute(point(NaN, -14.06), route), false);
    assert.equal(trafficAffectsRoute(point(-75.725, -14.06), {...route, geometria: {...route.geometria, coordinates: []}}), false);
    assert.equal(trafficAffectsRoute(point(-75.725, -14.06), route, -1), false);
});
