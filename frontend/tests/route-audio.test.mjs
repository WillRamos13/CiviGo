import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {beginRouteVoice,registerRouteAudioGuard}=loadTs('lib/route-audio.ts');
test('voice waits for confirmed music pause and fails closed without confirmation',async()=>{
  const events=[];globalThis.window={dispatchEvent:event=>events.push(event.detail)};globalThis.CustomEvent=class{constructor(type,value){this.type=type;this.detail=value.detail;}};
  let resolve;const stop=registerRouteAudioGuard(()=>new Promise(r=>resolve=r));const release=beginRouteVoice();let ready=false;void release.ready.then(()=>ready=true);await Promise.resolve();assert.equal(ready,false);resolve(false);assert.equal(await release.ready,false);release();release();assert.deepEqual(events,[true,false]);stop();assert.equal(await beginRouteVoice().ready,true);
  delete globalThis.window;
});
