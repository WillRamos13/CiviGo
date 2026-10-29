import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getIncidentIconPath} from '../src/services/incidentIcons';
for(const name of ['hurto','extorsion','amenazas','humo','pelea','animal-peligroso'])test(name+' usa una insignia propia local sin fondo',()=>{const path='/incident-symbols/'+name+'.svg';assert.equal(getIncidentIconPath(name.toUpperCase()),path);const svg=readFileSync('public'+path,'utf8');assert.match(svg,/<svg/);assert.doesNotMatch(svg,/<(?:script|image|foreignObject)|href=|onload=/i);});
test('insignias normalizan acentos y familias históricas',()=>{assert.equal(getIncidentIconPath('Extorsión'),'/incident-symbols/extorsion.svg');assert.equal(getIncidentIconPath('hurto-agravado'),'/incident-symbols/hurto.svg');});
