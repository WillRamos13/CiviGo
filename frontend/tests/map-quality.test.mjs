import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {gpsProblem}=loadTs('lib/gps-quality.ts');
const {formatDuration}=loadTs('lib/duration.ts');
const {parseAppearance,mapLightPreset}=loadTs('lib/map-appearance.ts');
const {watchRoutePosition}=loadTs('lib/navigation.ts');
test('GPS rejects Poland, poor precision, old/future fixes and jumps while accepting a nearby recovery',()=>{
 const now=Date.now(),valid={latitud:-14.0678,longitud:-75.7286,accuracy:5,timestamp:now};
 assert.equal(gpsProblem(valid,null,now),null);
 for(const point of [{...valid,latitud:50.6,longitud:20.3},{...valid,accuracy:500},{...valid,accuracy:NaN},{...valid,timestamp:now-31000},{...valid,timestamp:now+7000},{...valid,longitud:-75.9,timestamp:now+1000}])assert.ok(gpsProblem(point,valid,now+1000));
 assert.equal(gpsProblem({...valid,latitud:-14.0679,timestamp:now+1000},valid,now+1000),null);
 let deliver;const fixes=[],waiting=[];
 const stop=watchRoutePosition({watchPosition:ok=>(deliver=ok,1),clearWatch(){}},p=>fixes.push(p),assert.fail,message=>waiting.push(message));
 deliver({coords:{latitude:50.6,longitude:20.3,accuracy:5},timestamp:now});
 deliver({coords:{latitude:valid.latitud,longitude:valid.longitud,accuracy:NaN},timestamp:now});
 deliver({coords:{latitude:valid.latitud,longitude:valid.longitud,accuracy:5},timestamp:now});
 assert.equal(waiting.length,2);assert.equal(fixes.length,1);stop();
});
test('route duration uses hours at the hour boundary and never displays NaN',()=>{
 assert.equal(formatDuration(330*60),'5 h 30 min');assert.equal(formatDuration(3600),'1 h');assert.equal(formatDuration(61),'2 min');assert.equal(formatDuration(NaN),'—');
});
test('appearance validates persisted preferences and automatic lighting follows Lima time',()=>{
 assert.deepEqual(parseAppearance({mode:'hacked',light:'unknown'}),{mode:'2d',light:'day'});
 assert.deepEqual(parseAppearance({mode:'3d',light:'dusk'}),{mode:'3d',light:'dusk'});
 for(const [time,light] of [['2026-10-28T10:30:00Z','dawn'],['2026-10-28T17:00:00Z','day'],['2026-10-28T23:00:00Z','dusk'],['2026-10-29T03:00:00Z','night']])assert.equal(mapLightPreset('auto',new Date(time)),light);
});
