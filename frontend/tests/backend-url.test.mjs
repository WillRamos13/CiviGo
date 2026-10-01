import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/ts-module.mjs';

const { resolveBackendUrl } = loadTs('lib/backend-url.ts');
const vercel = BACKEND_URL => ({ VERCEL: '1', BACKEND_URL });

test('Vercel rejects a missing backend before generating a localhost rewrite', () => {
    for (const value of [undefined, '', '   ']) {
        assert.throws(() => resolveBackendUrl(vercel(value)), error => /BACKEND_URL/.test(error.message)
            && /Vercel/.test(error.message) && /HTTPS/.test(error.message) && /Railway/.test(error.message));
    }
});

test('Vercel rejects internal hosts and all IP forms without requiring a DNS lookup', () => {
    const values = [
        'http://civigo-api.up.railway.app', 'https://localhost', 'https://LOCALHOST.',
        'https://api.localhost', 'https://backend', 'https://backend:4000',
        'https://civigo.railway.internal', 'https://api.local', 'https://api.localdomain',
        'https://api.lan', 'https://api.home.arpa', 'https://api.test',
        'https://127.0.0.1', 'https://127.1', 'https://2130706433', 'https://0x7f000001',
        'https://10.0.0.3', 'https://172.16.0.1', 'https://192.168.1.4',
        'https://169.254.169.254', 'https://8.8.8.8',
        'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[2001:4860:4860::8888]',
        'https://api..civigo.online', 'https://api_.civigo.online',
    ];
    for (const value of values) assert.throws(() => resolveBackendUrl(vercel(value)), /BACKEND_URL/);
});

test('Vercel requires a bare public origin so /api is appended exactly once', () => {
    for (const suffix of ['/api', '/api/', '/api/..', '/./', '//', '/v1', '/%61pi', '?', '?token=synthetic', '#', '#api']) {
        assert.throws(() => resolveBackendUrl(vercel(`https://civigo-api.up.railway.app${suffix}`)), /BACKEND_URL/);
    }
    for (const value of [
        'https://user:synthetic-password@civigo-api.up.railway.app',
        'https://@civigo-api.up.railway.app',
        'https://civigo-api.up.railway.app\\api',
        'civigo-api.up.railway.app', '//civigo-api.up.railway.app',
    ]) assert.throws(() => resolveBackendUrl(vercel(value)), /BACKEND_URL/);
    const origin = resolveBackendUrl(vercel('https://civigo-api.up.railway.app/'));
    assert.equal(`${origin}/api/:path*`, 'https://civigo-api.up.railway.app/api/:path*');
});

test('configuration failures never echo credentials, query tokens or malformed supplied text', () => {
    const sentinel = 'synthetic-secret-do-not-log';
    for (const value of [`https://user:${sentinel}@api.civigo.online`, `https://api.civigo.online?token=${sentinel}`, sentinel]) {
        assert.throws(() => resolveBackendUrl(vercel(value)), error => {
            assert.equal(error.message.includes(sentinel), false);
            assert.equal(error.stack.includes(sentinel), false);
            assert.equal(error.cause, undefined);
            return /Configura BACKEND_URL/.test(error.message);
        });
    }
});

test('public Railway and custom HTTPS domains normalize into an origin without trailing slash', () => {
    for (const [value, expected] of [
        ['https://civigo-api-production.up.railway.app/', 'https://civigo-api-production.up.railway.app'],
        ['  HTTPS://API.CIVIGO.ONLINE:443/  ', 'https://api.civigo.online'],
        ['https://api.civigo.online./', 'https://api.civigo.online'],
        ['https://api.civigo.online:8443', 'https://api.civigo.online:8443'],
    ]) assert.equal(resolveBackendUrl(vercel(value)), expected);
});

test('local development and Compose retain their existing backend configuration outside Vercel', () => {
    for (const VERCEL of [undefined, '', '0', 'true']) {
        assert.equal(resolveBackendUrl({ VERCEL }), 'http://127.0.0.1:4000');
        assert.equal(resolveBackendUrl({ VERCEL, BACKEND_URL: 'http://localhost:4000/' }), 'http://localhost:4000');
        assert.equal(resolveBackendUrl({ VERCEL, BACKEND_URL: 'http://backend:4000' }), 'http://backend:4000');
        assert.equal(resolveBackendUrl({ VERCEL, BACKEND_URL: 'http://127.0.0.1:4000' }), 'http://127.0.0.1:4000');
    }
});
