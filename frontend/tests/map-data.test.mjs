import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { normalizeMapBounds, loadMapIncidents } = loadTs('lib/map-incidents.ts');
const { applyRoadRisk } = loadTs('lib/road-map.ts');

test('map bounds include the viewport at street zoom and handle repeated world coordinates', () => {
    const input = [-75.12312, -14.45622, -75.12310, -14.45620];
    const result = normalizeMapBounds(input);
    assert.ok(result[0] <= input[0] && result[1] <= input[1]);
    assert.ok(result[2] >= input[2] && result[3] >= input[3]);
    assert.ok(result[2] > result[0] && result[3] > result[1]);
    assert.deepEqual(normalizeMapBounds([170, -15, 190, -14]), [-180, -15, 180, -14]);
    assert.throws(() => normalizeMapBounds([NaN, -15, 20, -14]));
});

test('viewport query retrieves more than 500 incidents, deduplicates pages and preserves filters', async () => {
    const requested = [];
    const rows = Array.from({ length: 620 }, (_, i) => ({ id: 620 - i }));
    const result = await loadMapIncidents([-76, -15, -75, -14], async path => {
        const query = new URL(path, 'http://localhost').searchParams;
        requested.push(query);
        const after = Number(query.get('after') ?? 621);
        const items = rows.filter(row => row.id < after).slice(0, 250);
        return { items, nextCursor: items.at(-1).id > 1 ? items.at(-1).id : null };
    });
    assert.equal(result.length, 620);
    assert.equal(requested.length, 3);
    assert.ok(requested.every(query => query.get('bbox') === '-76,-15,-75,-14'));
    assert.deepEqual(result.map(row => row.id), rows.map(row => row.id));
});

test('invalid cursors stop pagination instead of looping and request failure never returns a partial map', async () => {
    let calls = 0;
    await assert.rejects(loadMapIncidents([-76, -15, -75, -14], async () => {
        calls++;
        return { items: [{ id: 10 }], nextCursor: 10 };
    }), /actualización/);
    assert.equal(calls, 2);
    await assert.rejects(loadMapIncidents([-76, -15, -75, -14], async () => { throw new Error('offline'); }), /offline/);
});

test('compact risk updates preserve static geometry and reset segments when incidents are resolved', () => {
    const feature = { type: 'Feature', id: 'road:1', geometry: { type: 'LineString', coordinates: [[1, 2], [2, 3]] }, properties: { puntos: 0, nivelRiesgo: 0, pendiente: false } };
    const geometry = { type: 'FeatureCollection', version: 'v1', features: [feature] };
    const danger = applyRoadRisk(geometry, { version: 'v1', revision: 'r1', values: [['road:1', 8, 2, true]] });
    assert.equal(danger.features[0].geometry, feature.geometry);
    assert.equal(danger.features[0].properties.nivelRiesgo, 2);
    assert.equal(feature.properties.nivelRiesgo, 0);
    const resolved = applyRoadRisk(geometry, { version: 'v1', revision: 'r2', values: [] });
    assert.equal(resolved.features[0].properties.nivelRiesgo, 0);
    assert.throws(() => applyRoadRisk(geometry, { version: 'v2', values: [] }), /red vial/);
});
