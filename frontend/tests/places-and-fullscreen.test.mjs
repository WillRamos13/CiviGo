import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {lockScroll}=loadTs('lib/scroll-lock.ts');
const {PlacePreferencesController,parsePlacePreferences}=loadTs('lib/place-preferences.ts');
const place={nombre:'Plaza de Armas de Ica',latitud:-14.06778,longitud:-75.72869,fuente:'OpenStreetMap'};
test('fullscreen and place modal release scroll locks in either order and restore original scrolling',()=>{
    for(const reverse of [false,true]){
        const body={style:{overflow:'auto'}};
        const releases=[lockScroll(body),lockScroll(body)];if(reverse)releases.reverse();
        releases[0]();releases[0]();assert.equal(body.style.overflow,'hidden');releases[1]();assert.equal(body.style.overflow,'auto');
    }
});
test('web places keep actual metadata and isolate saved destinations and history per account',async()=>{
    const data=new Map(),driver={get:async({key})=>({value:data.get(key)??null}),set:async({key,value})=>{data.set(key,value);}};
    const controller=new PlacePreferencesController(driver);controller.setOwner(7);
    await controller.remember(place);await controller.save(place,'home');await controller.save(place);
    let state=await controller.load();assert.equal(state.recent.length,1);assert.equal(state.saved.length,2);assert.equal(state.saved[0].place.fuente,'OpenStreetMap');
    controller.setOwner(8);state=await controller.load();assert.deepEqual(state,{recent:[],saved:[]});
    controller.setOwner(null);assert.equal(await controller.load(),null);
    controller.setOwner(7);await controller.clearRecent();assert.equal((await controller.load()).recent.length,0);
    assert.deepEqual(parsePlacePreferences('{broken'),{recent:[],saved:[]});
});
test('a delayed place read cannot restore a previous account after switching owners',async()=>{
    let resolveRead;const controller=new PlacePreferencesController({get:()=>new Promise(resolve=>{resolveRead=resolve;}),set:async()=>{}});
    controller.setOwner(1);const pending=controller.load();await Promise.resolve();controller.setOwner(2);
    resolveRead({value:JSON.stringify({version:1,recent:[],saved:[{place,label:'home'}]})});assert.equal(await pending,null);
});
