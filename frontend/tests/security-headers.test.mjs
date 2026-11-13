import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {webSecurityHeaders}=loadTs('lib/security-headers.ts');
test('web headers prevent framing and unsafe object/base URLs while reporting provider CSP',()=>{
  const headers=Object.fromEntries(webSecurityHeaders(true).map(h=>[h.key,h.value]));
  assert.equal(headers['X-Frame-Options'],'DENY');
  assert.match(headers['Content-Security-Policy'],/frame-ancestors 'none'/);
  assert.doesNotMatch(headers['Content-Security-Policy'],/script-src/);
  assert.match(headers['Content-Security-Policy-Report-Only'],/worker-src 'self' blob:/);
  assert.match(headers['Permissions-Policy'],/geolocation=\(self\)/);
  assert.match(headers['Permissions-Policy'],/microphone=\(self\)/);
  assert.ok(headers['Strict-Transport-Security']);
  assert.equal(webSecurityHeaders(false).some(h=>h.key==='Strict-Transport-Security'),false);
});
