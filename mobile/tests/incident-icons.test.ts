import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getIncidentIconPath} from '../src/services/incidentIcons';
test('Hurto has a dedicated bundled PNG with alpha instead of the generic alert badge',()=>{
    assert.equal(getIncidentIconPath('HURTO'),'/iconos/hurto.png');
    assert.equal(getIncidentIconPath(undefined,'Hurto'),'/iconos/hurto.png');
    const png=readFileSync('public/iconos/hurto.png');
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),256);assert.equal(png[25],6);
});
