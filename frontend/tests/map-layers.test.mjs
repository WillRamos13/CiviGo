import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { incidentAreaPoints, syncMapLayers, bindIncidentMarkerZoom, INCIDENT_MARKER_MIN_ZOOM, INCIDENT_AREA_PAINT } = loadTs('lib/map-layers.ts');

function fakeMap() {
    const sources = new Map(), layers = new Map();
    return {
        sources, layers,
        getSource: id => sources.get(id),
        addSource(id, spec) {
            assert.equal(sources.has(id), false, `duplicate source ${id}`);
            sources.set(id, { data: spec.data, setData(data) { this.data = data; } });
        },
        getLayer: id => layers.get(id),
        addLayer(spec, before) {
            assert.equal(layers.has(spec.id), false, `duplicate layer ${spec.id}`);
            layers.set(spec.id, { ...spec, layout: { ...spec.layout }, paint: { ...spec.paint }, before });
        },
        getStyle: () => ({ layers: [{ id: 'street-label', type: 'symbol', layout: { 'text-field': 'name' } }] }),
        setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; },
        setPaintProperty(id, key, value) { layers.get(id).paint[key] = value; },
        clearStyle() { sources.clear(); layers.clear(); },
    };
}
const incident = { id: 1, latitud: -14.0678, longitud: -75.7286, descripcion: 'Private synthetic text', totalReportes: 8, gravedad: 5 };
const route = { geometria: { type: 'LineString', coordinates: [[-75.7286, -14.0678], [-75.721, -14.0678]] } };
const state = { roads: { type: 'FeatureCollection', features: [] }, incidents: [incident], route,
    risk: true, events: true, zones: true, editor: false, brand: '#1554d8', routeOutline: '#fff' };

test('visual density counts distinct incidents and discards invalid positions without copying private fields', () => {
    const data = incidentAreaPoints([incident, incident, { ...incident, id: 2, latitud: NaN },
        { ...incident, id: 3, longitud: 181 }, { ...incident, id: 4, latitud: -91 }, { ...incident, id: 5, gravedad: null }]);
    assert.deepEqual(data.features.map(f => f.id), [1, 5]);
    assert.deepEqual(data.features[0].geometry.coordinates, [-75.7286, -14.0678]);
    assert.deepEqual(data.features[0].properties, {});
    assert.equal(incident.totalReportes, 8);
});

test('base style replacement restores latest route, incident points, colors and disabled layers', () => {
    const map = fakeMap();
    syncMapLayers(map, state);
    syncMapLayers(map, state);
    assert.equal(map.sources.size, 3);
    assert.equal(map.layers.size, 4);
    assert.equal(map.layers.get('civigo-incident-areas').before, 'street-label');
    map.clearStyle();
    const newerRoute = { geometria: { ...route.geometria, coordinates: [[-75.72, -14.06], [-75.71, -14.065]] } };
    syncMapLayers(map, { ...state, route: newerRoute, incidents: [{ ...incident, id: 9 }], risk: false,
        zones: false, brand: '#73a6ff', routeOutline: '#091320' });
    assert.deepEqual(map.sources.get('civigo-route').data.geometry, newerRoute.geometria);
    assert.equal(map.sources.get('civigo-incidents').data.features[0].id, 9);
    assert.equal(map.layers.get('civigo-incident-areas').layout.visibility, 'none');
    assert.equal(map.layers.get('civigo-roads-layer').layout.visibility, 'none');
    assert.equal(map.layers.get('civigo-route-line').paint['line-color'], '#73a6ff');
    assert.equal(map.layers.get('civigo-route-outline').paint['line-color'], '#091320');
    syncMapLayers(map, { ...state, route: null, incidents: [] });
    assert.deepEqual(map.sources.get('civigo-route').data.features, []);
    assert.deepEqual(map.sources.get('civigo-incidents').data.features, []);
});

test('hiding incidents also hides their areas; editor never displays incident density or street risk', () => {
    const map = fakeMap();
    syncMapLayers(map, { ...state, events: false });
    assert.equal(map.layers.get('civigo-incident-areas').layout.visibility, 'none');
    syncMapLayers(map, { ...state, editor: true });
    assert.deepEqual(map.sources.get('civigo-incidents').data.features, []);
    assert.equal(map.layers.get('civigo-incident-areas').layout.visibility, 'none');
    assert.equal(map.layers.get('civigo-roads-layer').layout.visibility, 'none');
});

function cameraValue(expression, zoom) {
    assert.equal(expression[0], 'interpolate');
    for (let i = 3; i < expression.length - 2; i += 2) {
        if (zoom <= expression[i + 2]) {
            const ratio = Math.max(0, (zoom - expression[i]) / (expression[i + 2] - expression[i]));
            return expression[i + 1] + ratio * (expression[i + 3] - expression[i + 1]);
        }
    }
    return expression.at(-1);
}

test('zooming out increases opacity and joins nearby visual footprints without changing incident weight', () => {
    const radius = INCIDENT_AREA_PAINT['heatmap-radius'], opacity = INCIDENT_AREA_PAINT['heatmap-opacity'];
    const separation = zoom => .003 / 360 * 512 * 2 ** zoom;
    assert.ok(separation(15) > 2 * cameraValue(radius, 15));
    assert.ok(separation(12) < 2 * cameraValue(radius, 12));
    assert.ok(cameraValue(opacity, 12) > cameraValue(opacity, 15));
    assert.equal(INCIDENT_AREA_PAINT['heatmap-weight'], 1);
});

test('zooming out reduces the footprint and intensity instead of covering the entire region', () => {
    const radius = INCIDENT_AREA_PAINT['heatmap-radius'];
    const intensity = INCIDENT_AREA_PAINT['heatmap-intensity'];
    assert.ok(cameraValue(radius, 9) <= 6);
    assert.ok(cameraValue(radius, 12) <= 12);
    assert.ok(cameraValue(radius, 9) < cameraValue(radius, 12));
    assert.ok(cameraValue(radius, 12) < cameraValue(radius, 15));
    assert.ok(cameraValue(intensity, 9) < cameraValue(intensity, 15));
});

test('incident icons follow the initial zoom and threshold crossings without retaining listeners', () => {
    let zoom = 10;
    const classes = new Set(), listeners = new Map();
    let changes = 0;
    const container = { classList: {
        toggle(name, visible) { changes++; if (visible) classes.add(name); else classes.delete(name); },
        remove(name) { classes.delete(name); },
    } };
    const map = {
        getContainer: () => container, getZoom: () => zoom,
        on(event, listener) { listeners.set(event, listener); },
        off(event, listener) { if (listeners.get(event) === listener) listeners.delete(event); },
    };
    const move = value => { zoom = value; listeners.get('zoom')?.(); };
    const stop = bindIncidentMarkerZoom(map);
    assert.equal(classes.has('incident-markers-visible'), false);
    move(INCIDENT_MARKER_MIN_ZOOM - .01);
    assert.equal(classes.has('incident-markers-visible'), false);
    assert.equal(changes, 1);
    move(INCIDENT_MARKER_MIN_ZOOM);
    assert.equal(classes.has('incident-markers-visible'), true);
    move(16);
    assert.equal(changes, 2);
    move(12);
    assert.equal(classes.has('incident-markers-visible'), false);
    stop();
    assert.equal(listeners.size, 0);
    move(18);
    assert.equal(classes.has('incident-markers-visible'), false);
    const stopNear = bindIncidentMarkerZoom(map);
    assert.equal(classes.has('incident-markers-visible'), true);
    stopNear();
    assert.equal(classes.has('incident-markers-visible'), false);
});
