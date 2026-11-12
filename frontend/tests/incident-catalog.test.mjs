import test from 'node:test';import assert from 'node:assert/strict';import {loadTs} from './helpers/ts-module.mjs';
const {incidentPresentation,INCIDENT_PRESENTATIONS}=loadTs('lib/incident-catalog.ts');
const {buildIncidentFilterGroups,filterIncidentsByType}=loadTs('lib/incident-filters.ts');
test('known incident families get explicit categories without rewriting historical types or severity',()=>{
  const incident={id:1,tipo:'Hurto de celular',tipoSlug:'hurto-de-celular',nivelRiesgo:null};const before=JSON.stringify(incident);
  const groups=buildIncidentFilterGroups(null,[incident]);assert.equal(groups[0].key,'seguridad');assert.equal(groups[0].types[0].key,'hurto-de-celular');assert.equal(filterIncidentsByType([incident],'hurto-de-celular').length,1);assert.equal(JSON.stringify(incident),before);assert.equal(incidentPresentation('extorsión').subcategory,'Delitos');assert.equal(incidentPresentation('desconocido'),null);
});
test('catalog presentation covers every existing supported type and future service and earthquake symbols',()=>{assert.equal(Object.keys(INCIDENT_PRESENTATIONS).length,24);for(const meta of Object.values(INCIDENT_PRESENTATIONS)){assert.match(meta.color,/^#[0-9a-f]{6}$/i);assert.ok(meta.description.length>20);assert.ok(meta.category&&meta.subcategory);}});
