import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {CitySelection,CITY_LANDMARKS,cityPosition}=loadTs('lib/city-scene.ts');
test('only one landmark lifts; rapid changes return the previous model before switching',()=>{
  const selection=new CitySelection();selection.select('plaza');for(let i=0;i<9;i++)selection.tick(.1);
  assert.equal(selection.active,'plaza');assert.ok(selection.progress>.5);
  selection.select('luren');assert.equal(selection.tick(.1).phase,'returning');
  assert.equal(selection.active,'plaza');selection.select('museo');
  for(let i=0;i<30;i++)selection.tick(.1);
  assert.equal(selection.active,'museo');assert.equal(selection.progress,1);
  selection.select(null);for(let i=0;i<30;i++)selection.tick(.1);
  assert.equal(selection.active,null);assert.equal(selection.progress,0);assert.equal(selection.phase,'overview');
});
test('closing during ascent always returns to the exact overview state',()=>{
  const s=new CitySelection();s.select('catedral');s.tick(.1);s.select(null);for(let i=0;i<20;i++)s.tick(.1);
  assert.equal(s.active,null);assert.equal(s.phase,'overview');assert.equal(s.progress,0);
  s.select('huacachina');s.tick(.1);s.reset();assert.equal(s.requested,null);
});
test('geographic anchors stay in Ica and use an identical projection for roads and landmarks',()=>{
  assert.equal(new Set(CITY_LANDMARKS.map(l=>l.id)).size,5);
  for(const l of CITY_LANDMARKS){assert.ok(l.latitud>-14.1&&l.latitud<-14.05);assert.ok(l.longitud>-75.78&&l.longitud<-75.71);assert.match(l.osmId,/^way\/\d+$/);}
  assert.deepEqual(cityPosition(-75.73,-14.06,[-75.73,-14.06]),[0,0]);
});
