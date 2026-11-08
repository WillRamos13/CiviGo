import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {parseSpotifyContent}=loadTs('lib/spotify-embed.ts');
const {analyticsPage,sanitizeAnalyticsProperties}=loadTs('lib/analytics-policy.ts');
const id='4uLU6hMCjMI75M1A2tKUQC';

test('Spotify accepts official content URLs and URIs, strips tracking and rejects foreign URLs',()=>{
  for(const type of ['track','album','playlist','episode','show']){
    const expected={uri:`spotify:${type}:${id}`,url:`https://open.spotify.com/${type}/${id}`};
    assert.deepEqual(parseSpotifyContent(`spotify:${type}:${id}`),expected);
    assert.deepEqual(parseSpotifyContent(`https://open.spotify.com/intl-es/${type}/${id}?si=private#tracking`),expected);
  }
  for(const input of ['',`http://open.spotify.com/track/${id}`,`https://evil.example/track/${id}`,`https://open.spotify.com.evil.example/track/${id}`,`https://user:secret@open.spotify.com/track/${id}`,`https://open.spotify.com/track/${id}/extra`,'javascript:alert(1)','spotify:track:short'])assert.equal(parseSpotifyContent(input),null,input);
});
test('analytics whitelist removes sensitive location, report, account and URL data',()=>{
  const value=sanitizeAnalyticsProperties({page:'/mapa?lat=-14&token=secret',email:'private@gmail.com',latitud:-14,longitude:-75,description:'private',action:'hero_map',transport:'driving',lcp_ms:350.1234,$current_url:'https://example.com/?secret=true',$referrer:'https://example.com/?secret=true',arbitrary:'private'});
  assert.equal(value.page,'/mapa');assert.equal(value.lcp_ms,350.12);assert.equal(value.action,'hero_map');assert.equal(value.transport,'driving');assert.equal(value.$current_url,'https://civigo.online/mapa');
  for(const key of ['email','latitud','longitude','description','$referrer','arbitrary'])assert.equal(key in value,false);
  const malicious=sanitizeAnalyticsProperties({page:'/reportes/123',action:'arbitrary private text',transport:'private',cls:NaN,duration_seconds:Infinity});
  assert.equal(malicious.page,'/otra');for(const key of ['action','transport','cls','duration_seconds'])assert.equal(key in malicious,false);
  assert.equal(analyticsPage('/perfil#secret'),'/perfil');assert.equal(analyticsPage('/usuario/private'),'/otra');
});
test('overlapping navigation instructions release music only after the last voice finishes',()=>{
  const previous=globalThis.window,events=[];
  globalThis.window={dispatchEvent:event=>events.push(event.detail)};
  try {
    const {beginRouteVoice}=loadTs('lib/route-audio.ts');
    const first=beginRouteVoice(),second=beginRouteVoice();
    first();first();assert.deepEqual(events,[true,true]);second();second();assert.deepEqual(events,[true,true,false]);
  } finally { if(previous===undefined)delete globalThis.window;else globalThis.window=previous; }
});
