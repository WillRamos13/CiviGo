import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {spotifyAuthorization,consumeSpotifyTransaction,SPOTIFY_TRANSACTION_KEY,spotifyRedirect,spotifyPlayback,SpotifyAccount}=loadTs('lib/spotify-account.ts');
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const id='a'.repeat(32);
test('Spotify PKCE uses S256, minimal scopes, strict redirect and a one-time transaction',async()=>{
  const storage=memory(),url=new URL(await spotifyAuthorization(id,'https://civigo.online',storage,false,1000));
  assert.equal(url.origin,'https://accounts.spotify.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('scope'),'user-read-playback-state');
  const tx=JSON.parse(storage.getItem(SPOTIFY_TRANSACTION_KEY));assert.equal(tx.verifier.length,64);assert.ok(!url.href.includes(tx.verifier));
  const callback=tx.redirectUri+'?state='+tx.state+'&code=authorized';assert.equal(consumeSpotifyTransaction(callback,storage,2000).code,'authorized');
  assert.throws(()=>consumeSpotifyTransaction(callback,storage,2000));assert.throws(()=>spotifyRedirect('http://localhost:3000'));
});
test('Spotify rejects mismatched, old and foreign-origin callbacks and consumes failed transactions',async()=>{
  for(const variant of ['state','expired','origin']){const storage=memory();await spotifyAuthorization(id,'https://civigo.online',storage,false,1000);const tx=JSON.parse(storage.getItem(SPOTIFY_TRANSACTION_KEY));const url=new URL(tx.redirectUri);url.searchParams.set('state',variant==='state'?'wrong':tx.state);url.searchParams.set('code','code');if(variant==='origin')url.hostname='attacker.invalid';assert.throws(()=>consumeSpotifyTransaction(url.href,storage,variant==='expired'?1000000:2000));assert.equal(storage.getItem(SPOTIFY_TRANSACTION_KEY),null);}
});
test('Spotify metadata does not accept external artwork or javascript links',()=>{
  const value=spotifyPlayback({is_playing:true,item:{name:'Track',artists:[{name:'Artist'}],album:{images:[{url:'https://attacker.invalid/pixel'}]},external_urls:{spotify:'javascript:alert(1)'}}});assert.equal(value.image,null);assert.equal(value.url,null);assert.equal(value.artists,'Artist');
});
test('Spotify late token responses cannot reconnect a disconnected session',async()=>{
  let resolveToken;const account=new SpotifyAccount(()=>new Promise(resolve=>{resolveToken=resolve;}));
  const pending=account.complete({clientId:id,code:'c',verifier:'a'.repeat(64),state:'s',createdAt:0,redirectUri:'https://civigo.online/integraciones/spotify'});account.disconnect();resolveToken(new Response(JSON.stringify({access_token:'test-token',token_type:'Bearer',refresh_token:'test-refresh',expires_in:3600})));await pending;assert.equal(account.getSnapshot().connected,false);
});
test('Spotify obeys Retry-After and never retries an ambiguous player command',async()=>{
  const calls=[];let now=1000;const account=new SpotifyAccount(async(url,options)=>{calls.push([url,options]);if(url.includes('/api/token'))return new Response(JSON.stringify({access_token:'token',token_type:'Bearer',expires_in:3600}));return new Response('',{status:429,headers:{'Retry-After':'30'}});},()=>now);
  await account.complete({clientId:id,code:'c',verifier:'a'.repeat(64),state:'s',createdAt:0,redirectUri:'https://civigo.online/integraciones/spotify'});
  assert.equal(calls.length,2);await account.read();await account.control('next');assert.equal(calls.length,2);now+=31000;await account.control('next');assert.equal(calls.length,3);
});
