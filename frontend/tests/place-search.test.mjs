import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';

const {normalizePlaceQuery, parsePlaceResults, startPlaceSearch} = loadTs('lib/place-search.ts');
const plaza = {nombre:'Plaza de Armas de Ica',latitud:-14.0639,longitud:-75.7285,descripcion:'Centro de Ica, Perú'};
const flush = async () => {for (let index=0;index<5;index++) await Promise.resolve();};

test('place results preserve a point of interest and its address while rejecting invalid records and duplicates', () => {
    const result = parsePlaceResults([
        {...plaza,nombre:' Plaza  de Armas de Ica ',descripcion:' Centro de Ica, Perú ',fuente:'tomtom'},
        {...plaza,nombre:'plaza de armas de ica'},
        {...plaza,latitud:'-14.0639'}, {...plaza,longitud:181},
        {...plaza,nombre:'  '}, null, {nombre:'sin posición'},
        {...plaza,nombre:'Otra plaza',descripcion:42},
    ]);
    assert.deepEqual(result,[plaza,{nombre:'Otra plaza',latitud:plaza.latitud,longitud:plaza.longitud}]);
    assert.equal(normalizePlaceQuery('  plaza   de  armas de ica  '),'plaza de armas de ica');
    assert.throws(()=>parsePlaceResults({results:[plaza]}),/datos incompletos/);
    assert.deepEqual(parsePlaceResults([]),[]);
});

test('a short trimmed query sends no search and an eligible query waits the full debounce', async context => {
    context.mock.timers.enable({apis:['setTimeout']});
    const calls=[], states=[];
    const request=async (query,signal)=>{calls.push({query,signal});return [plaza];};
    startPlaceSearch('  ab  ',request,state=>states.push(state));
    context.mock.timers.tick(500); await flush();
    assert.equal(calls.length,0);
    const stop=startPlaceSearch('  plaza   de armas de ica ',request,state=>states.push(state));
    context.mock.timers.tick(349); await flush();
    assert.equal(calls.length,0);
    context.mock.timers.tick(1); await flush();
    assert.equal(calls.length,1);
    assert.equal(calls[0].query,'plaza de armas de ica');
    assert.deepEqual(states.map(state=>state.status),['loading','ready']);
    assert.deepEqual(states[1].results,[plaza]);
    stop();
    assert.equal(calls[0].signal.aborted,true);
});

test('a cancelled debounce sends nothing and a late previous response never replaces the latest search', async context => {
    context.mock.timers.enable({apis:['setTimeout']});
    const calls=[], states=[];
    const cancelled=startPlaceSearch('cancelada',async()=>{assert.fail('cancelled request');},state=>states.push(state));
    cancelled(); context.mock.timers.tick(350); await flush();
    assert.deepEqual(states,[]);
    let resolvePrevious;
    const stopPrevious=startPlaceSearch('anterior',(query,signal)=>{
        calls.push({query,signal});return new Promise(resolve=>{resolvePrevious=resolve;});
    },state=>states.push(state));
    context.mock.timers.tick(350); await flush();
    stopPrevious();
    const stopLatest=startPlaceSearch('plaza de armas',async(query,signal)=>{calls.push({query,signal});return [plaza];},state=>states.push(state));
    context.mock.timers.tick(350); await flush();
    resolvePrevious([{...plaza,nombre:'Respuesta obsoleta'}]); await flush();
    assert.equal(calls[0].signal.aborted,true);
    assert.deepEqual(states.map(state=>`${state.query}:${state.status}`),['anterior:loading','plaza de armas:loading','plaza de armas:ready']);
    assert.deepEqual(states.at(-1).results,[plaza]);
    stopLatest();
});

test('a failed service is distinct from an empty search and aborting a request never produces an error message', async context => {
    context.mock.timers.enable({apis:['setTimeout']});
    const states=[];
    startPlaceSearch('vacía',async()=>[],state=>states.push(state));
    context.mock.timers.tick(350); await flush();
    assert.equal(states.at(-1).status,'ready');
    assert.deepEqual(states.at(-1).results,[]);
    startPlaceSearch('error',()=>{throw new Error('Sin conexión. Inténtalo de nuevo.');},state=>states.push(state));
    context.mock.timers.tick(350); await flush();
    assert.equal(states.at(-1).status,'error');
    assert.match(states.at(-1).error,/Sin conexión/);
    let reject;
    const stop=startPlaceSearch('abortada',()=>new Promise((_resolve,fail)=>{reject=fail;}),state=>states.push(state));
    context.mock.timers.tick(350); await flush();
    const count=states.length;
    stop(); reject(new DOMException('Solicitud cancelada','AbortError')); await flush();
    assert.equal(states.length,count);
});
