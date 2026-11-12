import test from 'node:test';import assert from 'node:assert/strict';import {loadTs} from './helpers/ts-module.mjs';
const {nearbyMapBusinesses}=loadTs('lib/map-businesses.ts');
const {rememberBusinessSelection,consumeBusinessSelection}=loadTs('lib/map-businesses.ts');
test('a 3D business selection consumes only its matching map click, not subsequent POIs',()=>{const map={};rememberBusinessSelection(map,{x:100,y:200},10);assert.equal(consumeBusinessSelection(map,{x:100,y:200},11),true);assert.equal(consumeBusinessSelection(map,{x:100,y:200},12),false);rememberBusinessSelection(map,{x:100,y:200},20);assert.equal(consumeBusinessSelection(map,{x:180,y:200},21),false);rememberBusinessSelection(map,{x:100,y:200},20);assert.equal(consumeBusinessSelection(map,{x:100,y:200},1000),false);});
test('3D business symbols require explicit real records and stay bounded to the visible area',()=>{
  const center={latitud:-14.06,longitud:-75.73};const records=Array.from({length:30},(_,i)=>({id:i+1,nombre:'Business '+i,latitud:center.latitud+.0001*i,longitud:center.longitud,demo:false}));
  const items=[...records,{...records[0],id:99,demo:true},{...records[0],id:100,demo:undefined},{...records[0],id:101,activo:false},{...records[0],id:102,latitud:NaN},{...records[0],id:103,longitud:-76.2},records[0]];
  const result=nearbyMapBusinesses(items,center);assert.equal(result.length,12);assert.equal(new Set(result.map(b=>b.id)).size,12);assert.equal(result[0].id,1);assert.ok(result.every(b=>b.demo===false&&b.id<31));
});
