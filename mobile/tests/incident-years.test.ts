import test from 'node:test';
import assert from 'node:assert/strict';
import {incidentYear,incidentYearOptions,filterIncidentsByYears,toggleIncidentYear} from '../src/services/incidentYears';
import {visibleNearbyIncidents} from '../src/services/nearbyIncidentPresentation';
import type {Incidente} from '../src/types';
test('nearby cards apply the year filter before the limit of ten',()=>{
 const rows=Array.from({length:24},(_,i)=>({id:i+1,tipo:'Hurto',latitud:-14.067,longitud:-75.728,estado:'ACTIVO',nivelRiesgo:null,totalReportes:0,fechaEvento:i<12?'2024-06-01':'2023-06-01'} as Incidente));
 const recent=visibleNearbyIncidents(filterIncidentsByYears(rows,['2024']),{latitud:-14.067,longitud:-75.728});
 assert.equal(recent.length,10);assert.ok(recent.every(row=>incidentYear(row)==='2024'));
});
test('incident years use event date in Peru, preserve date-only sources and label missing dates',()=>{
 assert.equal(incidentYear({fechaEvento:'2024-01-01T02:00:00Z'}),'2023');
 assert.equal(incidentYear({fechaEvento:'2024-01-01'}),'2024');
 assert.equal(incidentYear({fechaCreacion:'2026-05-04T12:00:00Z'}),'2026');
 for(const value of [undefined,'not-a-date','2024-02-31']) assert.equal(incidentYear({fechaEvento:value}),'sin-fecha');
});
test('multiple years combine, all and none differ, and dates and input arrays stay intact',()=>{
 const rows=[{id:1,fechaEvento:'2024-06-01'},{id:2,fechaEvento:'2023-06-01'},{id:3,fechaEvento:'2022-01-01'},{id:4}];
 assert.equal(filterIncidentsByYears(rows,null),rows);
 assert.deepEqual(filterIncidentsByYears(rows,['2024','2023']).map(r=>r.id),[1,2]);
 assert.deepEqual(filterIncidentsByYears(rows,[]),[]);
 assert.deepEqual(filterIncidentsByYears(rows,['sin-fecha']).map(r=>r.id),[4]);
 const options=incidentYearOptions(rows,['2021']);assert.deepEqual(options,['2024','2023','2022','2021','sin-fecha']);
 assert.deepEqual(toggleIncidentYear(null,'2024',options),options.slice(1));
 assert.deepEqual(toggleIncidentYear([],'2024',options),['2024']);
});
