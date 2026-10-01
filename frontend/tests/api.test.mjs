import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/ts-module.mjs';
const {api, ApiError} = loadTs('lib/api.ts');
test('caller abort remains cancellation instead of a misleading network outage', async () => {
    const original = globalThis.fetch, controller = new AbortController();
    globalThis.fetch = async () => { controller.abort(); throw new DOMException('cancelled', 'AbortError'); };
    try { await assert.rejects(api('/synthetic', {signal: controller.signal}), error => error.name === 'AbortError' && !(error instanceof ApiError)); }
    finally { globalThis.fetch = original; }
});
test('abort during JSON reading cannot return incomplete successful data', async () => {
    const original = globalThis.fetch, controller = new AbortController();
    globalThis.fetch = async () => ({ok: true, json: async () => { controller.abort(); throw new DOMException('cancelled', 'AbortError'); }});
    try { await assert.rejects(api('/synthetic', {signal: controller.signal}), error => error.name === 'AbortError'); }
    finally { globalThis.fetch = original; }
});
test('real network failure keeps the readable connection error and zero status', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('synthetic network failure'); };
    try { await assert.rejects(api('/synthetic'), error => error instanceof ApiError && error.status === 0 && /conectar/.test(error.message)); }
    finally { globalThis.fetch = original; }
});
