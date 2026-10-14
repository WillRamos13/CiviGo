import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';
const { resetMapOrientation } = loadTs('lib/map-camera.ts');

test('orientation resets bearing and pitch while preserving center, zoom and GPS state', () => {
    let following=true;
    const view={center:[-75.73545,-14.0887],zoom:16,bearing:125,pitch:35};
    const gps={latitud:-14.089,longitud:-75.735,accuracy:8};
    const beforeGps={...gps},calls=[];
    const map={easeTo(options){calls.push(options);Object.assign(view,options);}};
    assert.equal(resetMapOrientation(map,()=>{following=false;}),true);
    assert.deepEqual(view.center,[-75.73545,-14.0887]);
    assert.equal(view.zoom,16);
    assert.equal(view.bearing,0);assert.equal(view.pitch,0);assert.equal(following,false);
    assert.deepEqual(calls,[{bearing:0,pitch:0,duration:450}]);assert.deepEqual(gps,beforeGps);
});

test('unavailable cartography leaves camera following unchanged', () => {
    let stopped=false;
    assert.equal(resetMapOrientation(null,()=>{stopped=true;}),false);
    assert.equal(stopped,false);
});
