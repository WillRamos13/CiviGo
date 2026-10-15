import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { NativeHttpError, requestNativeApi } from '../src/services/nativeHttp';

const url = 'https://api.example.invalid/api/users/login';
const response = (overrides: Partial<HttpResponse> = {}): HttpResponse => ({ status: 200, data: { ok: true }, headers: {}, url, ...overrides });

test('native API passes HTTPS, time limits and redirect denial to the actual native transport', async () => {
  const result = await requestNativeApi(url, { method: 'POST', timeoutMs: 90000, headers: { 'Content-Type': 'application/json' }, body: '{"correo":"fixture@example.invalid"}' }, async options => {
    assert.equal(options.url, url);
    assert.equal(options.disableRedirects, true);
    assert.equal(options.connectTimeout, 15000);
    assert.equal(options.readTimeout, 90000);
    assert.equal(options.responseType, 'json');
    assert.equal(options.method, 'POST');
    assert.equal(options.data, '{"correo":"fixture@example.invalid"}');
    assert.equal(options.headers?.Cookie, undefined);
    return response();
  });
  assert.deepEqual(result, { status: 200, ok: true, data: { ok: true } });
});

test('native request rejects cleartext, credentials, redirects and malformed responses', async () => {
  let sent = 0;
  const send = async () => { sent++; return response(); };
  for (const target of ['not-a-url', url.replace('https:', 'http:'), url.replace('https://', 'https://user:secret@'), url + '#secret'])
    await assert.rejects(requestNativeApi(target, { timeoutMs: 1000 }, send), { code: 'INVALID_API_URL' });
  assert.equal(sent, 0);
  for (const timeoutMs of [0, -1, NaN, Infinity, 300001])
    await assert.rejects(requestNativeApi(url, { timeoutMs }, send), { code: 'INVALID_REQUEST' });
  assert.equal(sent, 0);
  for (const changed of [response({ status: 302 }), response({ url: 'https://other.invalid/collect' })])
    await assert.rejects(requestNativeApi(url, { timeoutMs: 1000 }, async () => changed), { code: 'API_REDIRECT_BLOCKED' });
  await assert.rejects(requestNativeApi(url, { timeoutMs: 1000 }, async () => response({ status: 0 })), NativeHttpError);
  await assert.rejects(requestNativeApi(url, { timeoutMs: 1000 }, async () => response({ url: '' })), { code: 'INVALID_RESPONSE' });
});

test('malformed native 401 preserves its status for the shared session invalidation', async () => {
  const result = await requestNativeApi(url, { timeoutMs: 1000 }, async () => response({ status: 401, data: '<html>denied</html>' }));
  assert.deepEqual(result, { status: 401, ok: false, data: null });
  assert.deepEqual(await requestNativeApi(url, { timeoutMs: 1000 }, async () => response({ status: 204, data: undefined })), { status: 204, ok: true, data: null });
});

test('native multipart preserves exact bytes and private fields, with a bounded sanitized filename', async () => {
  const bytes = Uint8Array.from([0, 255, 195, 169, 13, 10, 42]);
  const form = new FormData();
  form.append('archivo', new File([bytes], 'foto"\r\nInjected.png', { type: 'image/png' }));
  form.append('privado', 'true'); form.append('tipo', 'EVIDENCIA');
  await requestNativeApi(url, { body: form, method: 'POST', timeoutMs: 1000 }, async options => {
    assert.equal(options.dataType, 'formData');
    assert.match(options.headers?.['content-type'] ?? '', /^multipart\/form-data; boundary=----CiviGo[0-9a-f]{24}$/);
    const entries = options.data as { key: string; type: string; value: string; fileName?: string; contentType?: string }[];
    assert.deepEqual(Buffer.from(entries[0].value, 'base64'), Buffer.from(bytes));
    assert.equal(entries[0].contentType, 'image/png');
    assert.doesNotMatch(entries[0].fileName!, /["\r\n]/);
    assert.deepEqual(entries.slice(1), [{ key: 'privado', type: 'string', value: 'true' }, { key: 'tipo', type: 'string', value: 'EVIDENCIA' }]);
    return response();
  });
});

test('native uploads reject oversized files and pre-dispatch cancellation before sending', async () => {
  let sent = 0;
  const send = async () => { sent++; return response(); };
  const oversized = new FormData();
  oversized.append('archivo', new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'large.png'));
  await assert.rejects(requestNativeApi(url, { timeoutMs: 1000, body: oversized }, send), { code: 'INVALID_UPLOAD' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestNativeApi(url, { timeoutMs: 1000, signal: controller.signal }, send), { name: 'AbortError' });
  assert.equal(sent, 0);
});

test('aborting an in-flight native cookie mutation keeps its queue until the response settles', async () => {
  const controller = new AbortController();
  let release!: (value: HttpResponse) => void;
  let settled = false;
  const request = requestNativeApi(url, { method: 'POST', timeoutMs: 1000, signal: controller.signal }, () => new Promise(resolve => { release = resolve; }));
  const checked = assert.rejects(request, { name: 'AbortError' }).then(() => { settled = true; });
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'A newer login must not race the old Set-Cookie response.');
  release(response());
  await checked;
});
