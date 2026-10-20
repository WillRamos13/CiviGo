import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {routeTimeSource,reliableSpeed}=loadTs('lib/navigation-presentation.ts');
const {CiviGoMapTheme}=loadTs('lib/map-theme.ts');
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
test('dark theme preserves owned risk/traffic colors and restores exact light paint without replacing style',()=>{
  const layers=[{id:'background',type:'background'},{id:'road-main',type:'line'},{id:'civigo-risk-line',type:'line'},{id:'tomtom-flow',type:'raster'},{id:'civigo-route-line',type:'line'}];
  const values=new Map([['background:background-color','#eeeeee'],['road-main:line-color',['case',true,'red','green']],['civigo-risk-line:line-color','original-risk']]);
  const map={getStyle:()=>({layers}),getLayer:id=>layers.find(l=>l.id===id),getPaintProperty:(id,key)=>values.get(`${id}:${key}`),setPaintProperty:(id,key,value)=>values.set(`${id}:${key}`,value)};
  const original=values.get('road-main:line-color'),theme=new CiviGoMapTheme();theme.apply(map,true);
  assert.equal(values.get('civigo-risk-line:line-color'),'original-risk');assert.equal(values.get('civigo-route-line:line-color'),'#19c9ff');
  theme.apply(map,false);assert.equal(values.get('road-main:line-color'),original);assert.equal(values.get('background:background-color'),'#eeeeee');
});
