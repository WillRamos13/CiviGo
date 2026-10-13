import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {syncTrafficLayer, TRAFFIC_SOURCE_ID, TRAFFIC_LAYER_ID} = loadTs('lib/map-traffic-layers.ts');
const origin = 'https://civigo.example';
const url = `${origin}/api/navigation/traffic/tiles/flow/{z}/{x}/{y}.png`;

function fakeMap(styleLayers = [
    {id:'land',type:'background'}, {id:'road-icon',type:'symbol',layout:{'icon-image':'shield'}},
    {id:'street-label',type:'symbol',layout:{'text-field':'name'}},
]) {
    const sources = new Map(), layers = new Map();
    return {
        sources, layers,
        getSource: id => sources.get(id),
        addSource(id,spec) { assert.equal(sources.has(id),false); sources.set(id,{...spec, updates:0, setTiles(tiles) {this.tiles=tiles;this.updates++;}}); },
        getLayer: id => layers.get(id),
        addLayer(spec,before) { assert.equal(layers.has(spec.id),false); layers.set(spec.id,{...spec,layout:{...spec.layout},before}); },
        getStyle: () => ({layers:styleLayers}),
        setLayoutProperty(id,key,value) { layers.get(id).layout[key]=value; },
        resetStyle() { sources.clear(); layers.clear(); },
    };
}
test('traffic uses the supplied same-origin raster proxy below labels without secrets',()=>{
    const map=fakeMap();syncTrafficLayer(map,true,url);
    const source=map.sources.get(TRAFFIC_SOURCE_ID), layer=map.layers.get(TRAFFIC_LAYER_ID);
    assert.equal(source.type,'raster');assert.deepEqual(source.tiles,[url]);
    assert.equal(new URL(source.tiles[0]).origin,origin);
    assert.equal(new URL(source.tiles[0]).search,'');
    assert.equal(source.tileSize,256);assert.equal(source.minzoom,5);assert.equal(source.maxzoom,18);
    assert.equal(source.attribution,'© TomTom');assert.equal(layer.before,'street-label');
    assert.equal(layer.source,TRAFFIC_SOURCE_ID);assert.equal(layer.paint['raster-opacity'],.85);
    assert.equal(layer.layout.visibility,'visible');
});
test('disabled traffic never creates sources; switching off hides and reuses an existing layer',()=>{
    const map=fakeMap();syncTrafficLayer(map,false,url);
    assert.equal(map.sources.size,0);assert.equal(map.layers.size,0);
    syncTrafficLayer(map,true,url);syncTrafficLayer(map,true,url);
    assert.equal(map.sources.size,1);assert.equal(map.layers.size,1);
    syncTrafficLayer(map,false,url);assert.equal(map.layers.get(TRAFFIC_LAYER_ID).layout.visibility,'none');
    syncTrafficLayer(map,true,url);assert.equal(map.layers.get(TRAFFIC_LAYER_ID).layout.visibility,'visible');
});
test('style replacement restores traffic source and layer from current enabled state',()=>{
    const map=fakeMap();syncTrafficLayer(map,true,url);map.resetStyle();
    syncTrafficLayer(map,true,url);assert.equal(map.sources.size,1);assert.equal(map.layers.size,1);
    assert.equal(map.layers.get(TRAFFIC_LAYER_ID).layout.visibility,'visible');
    map.layers.clear();syncTrafficLayer(map,true,url);
    assert.equal(map.sources.size,1);assert.equal(map.layers.size,1);
    map.resetStyle();syncTrafficLayer(map,false,url);
    assert.equal(map.sources.size,0);assert.equal(map.layers.size,0);
});
test('a style without text labels still supports the traffic layer',()=>{
    const map=fakeMap([]);syncTrafficLayer(map,true,url);
    assert.equal(map.layers.get(TRAFFIC_LAYER_ID).before,undefined);
    assert.equal(map.layers.get(TRAFFIC_LAYER_ID).layout.visibility,'visible');
});

test('traffic source uses provincial bounds and refreshes tiles once per URL without replacing layers',()=>{
    const map=fakeMap(), bounds=[-75.9,-14.3,-75.5,-13.9];
    syncTrafficLayer(map,true,`${url}?v=1`,bounds);
    const source=map.sources.get(TRAFFIC_SOURCE_ID), layer=map.layers.get(TRAFFIC_LAYER_ID);
    assert.deepEqual(source.bounds,bounds);
    syncTrafficLayer(map,true,`${url}?v=1`,bounds);
    assert.equal(source.updates,0);
    syncTrafficLayer(map,true,`${url}?v=2`,bounds);
    assert.equal(source.updates,1);
    assert.deepEqual(source.tiles,[`${url}?v=2`]);
    assert.equal(map.layers.get(TRAFFIC_LAYER_ID),layer);
    syncTrafficLayer(map,false,`${url}?v=3`,bounds);
    assert.equal(source.updates,1);
    syncTrafficLayer(map,true,`${url}?v=3`,bounds);
    assert.equal(source.updates,2);
});
