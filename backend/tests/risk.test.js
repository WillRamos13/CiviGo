"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {levelFromPoints,ageWeight,incidentRisk,scoreSegments,confirmationWeight}=require("../src/lib/risk");
test("Los intervalos de riesgo preservan decimales y reservan nivel cero para cero puntos",()=>{
  for(const [p,n] of [[0,0],[.001,1],[5,1],[5.000001,2],[10,2],[10.1,3],[15.01,4],[20,4],[20.01,5],[100,5]])assert.equal(levelFromPoints(p),n);
});
test("El envejecimiento usa meses calendario desde el hecho, con 10% hasta tres años",()=>{
  const date="2023-01-31T12:00:00Z";
  for(const [now,weight] of [["2023-04-30T12:00:00Z",1],["2023-05-01",.75],["2023-08-01",.5],["2024-02-01",.25],["2025-02-01",.1],["2026-01-31T12:00:00Z",.1],["2026-02-01",0]])assert.equal(ageWeight(date,new Date(now)),weight);
});
test("La gravedad es la base, y las confirmaciones cambian la validación sin inventar gravedad",()=>{
  const now=new Date("2026-10-01T12:00:00Z");const base={id:1,estado:"ACTIVO",publicado:true,nivelRiesgo:4,evaluacion:"IA",validacion:.5,fechaEvento:now,fechaCreacion:now};
  assert.equal(incidentRisk(base,now).points,2);assert.equal(confirmationWeight(3),1);assert.equal(confirmationWeight(1,true),1);
  assert.equal(incidentRisk({...base,validacion:1,evaluacion:"AGENTE"},now).points,4);
  assert.equal(incidentRisk({...base,estado:"PENDIENTE",evaluacion:"PENDIENTE",nivelRiesgo:null},now).pending,true);
  assert.equal(incidentRisk({...base,publicado:false,evaluacion:"PENDIENTE"},now).pending,false);
});
test("Robo individual pierde peso a los tres días y se retira a los siete sin pruebas; las recibidas esperan revisión",()=>{
  const base={estado:"ACTIVO",publicado:true,nivelRiesgo:4,evaluacion:"IA",validacion:.5,individual:true,fechaCreacion:"2026-09-24T12:00:00Z"};
  assert.equal(incidentRisk(base,new Date("2026-09-27T12:00:00Z")).points,1);
  assert.equal(incidentRisk(base,new Date("2026-10-01T11:59:59Z")).points,1);
  assert.equal(incidentRisk(base,new Date("2026-10-01T12:00:00Z")).points,0);
  assert.equal(incidentRisk(base,new Date("2026-10-02T12:00:00Z")).points,0);
  assert.equal(incidentRisk({...base,pruebasRecibidas:true},new Date("2026-10-02T12:00:00Z")).points,2);
  assert.equal(incidentRisk({...base,fechaPublicacion:"2026-10-02T10:00:00Z"},new Date("2026-10-02T12:00:00Z")).points,2);
});
test("Incendio resuelto no genera riesgo histórico; delito validado conserva el historial",()=>{
  const incident={estado:"RESUELTO",publicado:true,nivelRiesgo:4,evaluacion:"AGENTE",validacion:1,fechaEvento:"2026-09-01"};const now=new Date("2026-10-01");
  assert.equal(incidentRisk(incident,now).points,0);assert.equal(incidentRisk({...incident,historico:true},now).points,4);
});
test("Cada incidente suma una vez en su tramo y 15% solamente en los conectados directamente",()=>{
  const segments=[{id:"a",start:"1",end:"2",coordinates:[[0,0],[.001,0]]},{id:"b",start:"2",end:"3",coordinates:[[.001,0],[.002,0]]},{id:"c",start:"3",end:"4",coordinates:[[.002,0],[.003,0]]},{id:"bridge",start:"5",end:"6",coordinates:[[.0005,-.001],[.0005,.001]]}];
  const incident={id:1,latitud:0,longitud:.0002,nivelRiesgo:4,validacion:1,estado:"ACTIVO",evaluacion:"AGENTE"};
  const scores=scoreSegments(segments,[incident,incident]);assert.equal(scores[0].points,4);assert.equal(scores[1].points,.6);assert.equal(scores[2].points,0);assert.equal(scores[3].points,0);
});
