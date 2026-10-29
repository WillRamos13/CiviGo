import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {NavigationAvatarPreferenceController,isNavigationAvatar,navigationAvatarRotation,navigationAvatarShapes,NAVIGATION_AVATARS}=loadTs('lib/navigation-avatar.ts');
test('web offers all native vehicle models and colors as local vector shapes',()=>{
 for(const id of NAVIGATION_AVATARS.map(row=>row.id))assert.ok(navigationAvatarShapes(id).length>0);
 assert.ok(isNavigationAvatar('sport:red'));assert.ok(!isNavigationAvatar('sport:javascript:alert(1)'));assert.ok(!isNavigationAvatar('https://external.invalid/image'));
 assert.equal(navigationAvatarRotation(90,30),60);assert.equal(navigationAvatarRotation(350,10),-20);
});
test('late account reads cannot overwrite the selection or another account preference',async()=>{
 let finish;const values=new Map([['civigo:navigation-avatar:v1:user:2','suv:silver']]);const driver={get:({key})=>new Promise(resolve=>{finish=()=>resolve({value:values.get(key)});}),set:async({key,value})=>values.set(key,value)};
 const controller=new NavigationAvatarPreferenceController(driver);controller.setOwner(1);const old=controller.load();await Promise.resolve();controller.setOwner(2);finish();assert.equal(await old,null);await controller.save('sedan:red');assert.equal(values.get('civigo:navigation-avatar:v1:user:2'),'sedan:red');assert.equal(values.has('civigo:navigation-avatar:v1:user:1'),false);
});
