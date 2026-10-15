import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAuthenticatedMedia, createAuthenticatedMediaResource, stopMediaPlayback, MAX_MEDIA_BYTES, type MediaTransport } from '../src/services/authenticatedMedia';
import { OperationScope } from '../src/services/operationScope';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const request = { url: '/api/uploads/private-file', mimeType: 'image/png', privado: true };
const begin = () => new OperationScope(() => 'owner-A').begin();
const web: MediaTransport = {
  native: false,
  fetch: async () => new Response(png, { headers: { 'Content-Type': 'image/png' } }),
  nativeGet: async () => { throw new Error('Unexpected native call'); },
};

test('browser authenticated media uses credentials, cancellation, no redirects and bounded binary data', async () => {
  const operation = begin();
  const blob = await fetchAuthenticatedMedia(request, operation, { ...web, fetch: async (url, options) => {
    assert.equal(url, 'http://localhost/api/uploads/private-file');
    assert.equal(options.credentials, 'include');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, { Accept: 'image/png' });
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.length) } });
  } });
  assert.equal(blob.type, 'image/png');
  assert.equal(blob.size, png.length);
});

test('native binary media uses Capacitor HTTP cookie jar without reading cookie headers', async () => {
  const headers = { 'Content-Type': 'image/png', 'Content-Length': String(png.length) };
  Object.defineProperty(headers, 'Set-Cookie', { enumerable: true, get() { throw new Error('Cookie headers must not be read'); } });
  const blob = await fetchAuthenticatedMedia(request, begin(), { ...web, native: true, nativeGet: async (options) => {
    assert.equal(options.responseType, 'arraybuffer');
    assert.equal(options.disableRedirects, true);
    assert.equal(options.webFetchExtra?.credentials, 'include');
    assert.ok(options.webFetchExtra?.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, { Accept: 'image/png' });
    return { status: 200, headers, data: png.toString('base64'), url: options.url };
  } });
  assert.equal(blob.size, png.length);
});

test('media rejects external URLs, MIME mismatch, oversized headers and forged content before creating object URLs', async () => {
  let reads = 0;
  await assert.rejects(fetchAuthenticatedMedia({ ...request, url: 'https://evil.test/api/uploads/private-file' }, begin(), { ...web,
    fetch: async () => { reads++; throw new Error('Unexpected read'); },
  }), /dirección/);
  assert.equal(reads, 0);
  await assert.rejects(fetchAuthenticatedMedia(request, begin(), { ...web,
    fetch: async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }),
  }), /formato/);
  await assert.rejects(fetchAuthenticatedMedia(request, begin(), { ...web,
    fetch: async () => new Response(png, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(MAX_MEDIA_BYTES + 1) } }),
  }), /15 MB/);
  await assert.rejects(fetchAuthenticatedMedia(request, begin(), { ...web,
    fetch: async () => new Response('fake image', { headers: { 'Content-Type': 'image/png' } }),
  }), /contenido/);
  await assert.rejects(fetchAuthenticatedMedia({ ...request, mimeType: 'image/svg+xml' }, begin(), web), /formato/);
});

test('native media rejects redirects and access errors without accepting a signed URL', async () => {
  const native: MediaTransport = { ...web, native: true, nativeGet: async () => ({ status: 200, headers: { 'Content-Type': 'image/png' }, data: png.toString('base64'), url: 'https://storage.example.test/file?signature=private' }) };
  await assert.rejects(fetchAuthenticatedMedia(request, begin(), native), /dirección/);
  await assert.rejects(fetchAuthenticatedMedia(request, begin(), { ...native,
    nativeGet: async (options) => ({ status: 403, headers: {}, data: {}, url: options.url }),
  }), /acceso/);
});

test('media resource creates only a Blob URL and revokes it once on account change or unmount', async () => {
  let identity = 'owner-A';
  const scope = new OperationScope(() => identity);
  const revoked: string[] = [];
  const resource = await createAuthenticatedMediaResource(request, scope.begin(), web, {
    createObjectURL: (blob) => { assert.ok(blob instanceof Blob); return 'blob:private-resource'; },
    revokeObjectURL: (url) => { revoked.push(url); },
  });
  assert.equal(resource.url, 'blob:private-resource');
  identity = 'owner-B';
  scope.cancel();
  resource.dispose();
  assert.deepEqual(revoked, ['blob:private-resource']);
});

test('late native responses after logout are discarded without generating an object URL', async () => {
  let identity = 'owner-A';
  const scope = new OperationScope(() => identity);
  let release!: (value: any) => void;
  let urls = 0;
  const waiting = new Promise<any>((resolve) => { release = resolve; });
  const loaded = createAuthenticatedMediaResource(request, scope.begin(), { ...web, native: true, nativeGet: () => waiting }, {
    createObjectURL: () => { urls++; return 'blob:unexpected'; },
    revokeObjectURL: () => { throw new Error('No URL should exist'); },
  });
  const rejected = assert.rejects(loaded, { name: 'AbortError' });
  identity = 'owner-B';
  scope.cancel();
  release({ status: 200, headers: { 'Content-Type': 'image/png' }, data: png.toString('base64'), url: 'http://localhost/api/uploads/private-file' });
  await rejected;
  assert.equal(urls, 0);
});

test('detaching a video stops playback and releases its Blob source', () => {
  const actions: string[] = [];
  stopMediaPlayback({ pause: () => actions.push('pause'), removeAttribute: (name) => actions.push(`remove:${name}`), load: () => actions.push('load') });
  assert.deepEqual(actions, ['pause', 'remove:src', 'load']);
  stopMediaPlayback(null);
});
