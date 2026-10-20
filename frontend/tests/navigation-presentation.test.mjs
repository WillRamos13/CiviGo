import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {routeTimeSource,reliableSpeed}=loadTs('lib/navigation-presentation.ts');

const now=Date.parse('2026-10-20T12:00:00Z');
test('time source distinguishes saved, unknown, local, fresh and stale traffic',()=>{
  assert.match(routeTimeSource({},now),/del recorrido/);
  assert.match(routeTimeSource({estimacion:{fuente:'OPENSTREETMAP'}},now),/OpenStreetMap · Sin tráfico/);
  assert.match(routeTimeSource({copiaGuardada:true,trafico:{disponible:true}},now),/guardada/);
  assert.match(routeTimeSource({trafico:{disponible:true,fuente:'TOMTOM',actualizadoEn:new Date(now-2000).toISOString()}},now),/TomTom · Con tráfico/);
  assert.match(routeTimeSource({trafico:{disponible:true,fuente:'TOMTOM',actualizadoEn:new Date(now-700000).toISOString()}},now),/sin actualización/);
});
test('GPS speed is hidden for missing, stale, inaccurate and impossible fixes',()=>{
  const fix={speed:10,accuracy:5,timestamp:now};
  assert.equal(reliableSpeed(fix,now),36);assert.equal(reliableSpeed({...fix,speed:0},now),0);
  for(const item of [null,{}, {...fix,timestamp:now-10001},{...fix,timestamp:now+1001},{...fix,accuracy:100},{...fix,speed:100},{...fix,speed:null},{...fix,speed:-1}]) assert.equal(reliableSpeed(item,now),null);
});
