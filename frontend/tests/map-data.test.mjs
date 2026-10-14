import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { ICA_MAP_BOUNDS, normalizeMapBounds, expandMapBounds, mapQueryBounds, mergeMapIncidents, loadMapIncidents } = loadTs('lib/map-incidents.ts');
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

test('street viewport changes keep the whole province and visited areas in the same request coverage', () => {
    const province = [...ICA_MAP_BOUNDS];
    assert.equal(expandMapBounds(province, [-75.741, -14.11, -75.72, -14.08]), province);
    assert.equal(expandMapBounds(province, [-75.735, -14.07, -75.72, -14.06]), province);
    const westernVisit = expandMapBounds(province, [-76.52, -14.2, -76.4, -14.1]);
    assert.ok(westernVisit[0] <= -76.52);
    assert.ok(westernVisit[2] >= province[2] && westernVisit[1] <= province[1] && westernVisit[3] >= province[3]);
    assert.equal(expandMapBounds(westernVisit, [-75.741, -14.11, -75.72, -14.08]), westernVisit);
    const route = mapQueryBounds(westernVisit, [[-76.6, -15.2], [-75.73, -14.08], [NaN, -14]]);
    assert.ok(route[0] <= -76.602 && route[1] <= -15.202);
    assert.ok(route[2] >= province[2] && route[3] >= province[3]);
    assert.equal(mapQueryBounds(route, []), route);
});

test('complete provincial refresh loads 550 and removes unpublished rows instead of restoring stale nearby copies', async () => {
    let rows = Array.from({length:550},(_,index)=>({id:550-index,latitud:-14.09,longitud:-75.735,gravedad:2}));
    const request = async path => {
        const after = Number(new URL(path,'http://localhost').searchParams.get('after')) || Infinity;
        const eligible = rows.filter(item => item.id < after), items = eligible.slice(0,250);
        return {items,nextCursor:eligible.length>items.length?items.at(-1).id:null};
    };
    const first = await loadMapIncidents(ICA_MAP_BOUNDS,request);
    assert.equal(first.length,550);
    const staleNearby = first.filter(item => [550,549].includes(item.id));
    rows = rows.filter(item => item.id !== 549).map(item => item.id===550?{...item,gravedad:5}:item);
    const refreshed = await loadMapIncidents(ICA_MAP_BOUNDS,request);
    const merged = mergeMapIncidents(refreshed,staleNearby,ICA_MAP_BOUNDS);
    assert.equal(merged.length,549);
    assert.equal(merged.find(item=>item.id===550).gravedad,5);
    assert.equal(merged.some(item=>item.id===549),false);
    const outside={id:900,longitud:-77,latitud:-14};
    assert.equal(mergeMapIncidents(refreshed,[outside],ICA_MAP_BOUNDS).at(-1),outside);
    assert.equal(mergeMapIncidents([],staleNearby,null).length,2);
});

test('aborted pagination cannot publish stale results even if a transport ignores its abort signal', async () => {
    let finishOld;
    const controller = new AbortController();
    const oldRead = loadMapIncidents(ICA_MAP_BOUNDS,()=>new Promise(resolve=>{finishOld=resolve;}),controller.signal);
    controller.abort();
    const fresh = await loadMapIncidents(ICA_MAP_BOUNDS,async()=>({items:[{id:999}],nextCursor:null}));
    assert.deepEqual(fresh,[{id:999}]);
    finishOld({items:[{id:100}],nextCursor:100});
    await assert.rejects(oldRead,{name:'AbortError'});
    let calls=0;
    await assert.rejects(loadMapIncidents(ICA_MAP_BOUNDS,async()=>{calls++;return{items:[],nextCursor:null};},controller.signal),{name:'AbortError'});
    assert.equal(calls,0);
});

test('a failed second page never returns a smaller partial provincial snapshot', async () => {
    const rows=Array.from({length:550},(_,index)=>({id:550-index}));let calls=0;
    await assert.rejects(loadMapIncidents(ICA_MAP_BOUNDS,async()=>{
        if(++calls===1)return{items:rows.slice(0,250),nextCursor:301};
        throw new Error('La segunda página no respondió');
    }),/segunda página/);
    assert.equal(calls,2);
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
