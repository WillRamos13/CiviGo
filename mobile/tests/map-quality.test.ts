import test from 'node:test';
import assert from 'node:assert/strict';
import {gpsProblem} from '../src/services/gpsQuality';
import {mapLightPreset,parseAppearance} from '../src/services/mapAppearance';
test('native GPS rejects foreign, stale and imprecise fixes without rejecting Ica recovery',()=>{
 const now=Date.now(),point={latitud:-14.0678,longitud:-75.7286,timestamp:now,accuracy:5};
 assert.equal(gpsProblem(point,null,now),null);
 for(const bad of [{...point,latitud:50.6,longitud:20.3},{...point,accuracy:150},{...point,timestamp:now-60000},{...point,latitud:-14.2,timestamp:now+1000}])assert.ok(gpsProblem(bad,point,now+1000));
 assert.equal(gpsProblem({...point,latitud:-14.0679,timestamp:now+1000},point,now+1000),null);
});
test('native appearance defaults to 2D/day and automatic lighting uses Ica timezone',()=>{
 assert.deepEqual(parseAppearance({}),{mode:'2d',light:'day'});
 assert.deepEqual(parseAppearance({mode:'3d',light:'night'}),{mode:'3d',light:'night'});
 assert.equal(mapLightPreset('auto',new Date('2026-10-28T23:00:00Z')),'dusk');
});
