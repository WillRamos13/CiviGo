import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REPORT_FILE_BYTES, reportVideoLimit, validateEvidenceFile, validateReportEvidence, submitReportWithEvidence, type ReportTransport } from '../src/services/reportEvidence';

const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const photo = () => new File([pngBytes], 'evidence.png', { type: 'image/png' });
const video = () => new File([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109])], 'video.mp4', { type: 'video/mp4' });
const rules = { fotoObligatoria: true, individual: true };

function decoder(t: TestContext, implementation = async () => ({ width: 1, height: 1, close() {} })) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: implementation });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'createImageBitmap', original);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  });
}

function ports(overrides: Partial<ReportTransport> = {}): ReportTransport {
  let id = 0;
  return {
    upload: async (file, privado) => ({ id: `attachment-${++id}`, nombre: file.name, mimeType: file.type, privado, url: '/api/uploads/file', tipo: 'PUBLICO' }),
    create: async () => ({ reporte: { id: 70 }, incidente: { id: 80 } }) as any,
    remove: async () => ({ eliminado: true }),
    ...overrides,
  };
}

test('mandatory photo rejects empty evidence and a video-only submission before uploads', async () => {
  let uploaded = 0;
  const transport = ports({ upload: async () => { uploaded++; throw new Error('Unexpected upload'); } });
  await assert.rejects(submitReportWithEvidence({}, [], rules, transport), /fotografía válida/);
  await assert.rejects(submitReportWithEvidence({}, [video()], rules, transport), /video no la reemplaza/);
  assert.equal(uploaded, 0);
});

test('file validation rejects empty, unsupported MIME, forged image content and oversized uploads', async () => {
  const ignoreDecode = async () => {};
  await assert.rejects(validateEvidenceFile(new File([], 'empty.png', { type: 'image/png' })), /vacío/);
  await assert.rejects(validateEvidenceFile(new File(['text'], 'danger.svg', { type: 'image/svg+xml' })), /Solo se admiten/);
  await assert.rejects(validateEvidenceFile(new File(['not a photo'], 'fake.png', { type: 'image/png' })), /no coincide/);
  await assert.rejects(validateEvidenceFile(new File([new Uint8Array(MAX_REPORT_FILE_BYTES + 1)], 'huge.png', { type: 'image/png' }), undefined, ignoreDecode), /límite de 15 MB/);
  const tooLargeVideo = new File([new Uint8Array(1024 * 1024 + 1)], 'large.mp4', { type: 'video/mp4' });
  await assert.rejects(validateEvidenceFile(tooLargeVideo, 1024 * 1024), /límite de 1 MB/);
  assert.equal(reportVideoLimit(30 * 1024 * 1024), MAX_REPORT_FILE_BYTES);
});

test('signature alone is insufficient when the browser cannot decode the photo', async (t) => {
  decoder(t, async () => { throw new Error('Corrupt image'); });
  await assert.rejects(validateEvidenceFile(photo()), /fotografía/);
});

test('a decoded image satisfies mandatory photography and the three-file ceiling remains enforced', async (t) => {
  let decodes = 0;
  decoder(t, async () => { decodes++; return { width: 1, height: 1, close() {} }; });
  await validateReportEvidence([photo(), video()], rules);
  assert.equal(decodes, 1);
  await assert.rejects(validateReportEvidence([photo(), photo(), photo(), photo()], rules), /tres archivos/);
});

test('actual submission transport sends private PUBLICO evidence and associates only returned attachment IDs', async (t) => {
  decoder(t);
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    const path = new URL(url, 'https://offline.test').pathname;
    calls.push(path);
    assert.equal(options.credentials, 'include');
    if (path.endsWith('/uploads')) {
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('privado'), 'true');
      assert.equal(options.body.get('tipo'), 'PUBLICO');
      assert.equal((options.body.get('archivo') as File).name, 'evidence.png');
      return Response.json({ id: 'server-issued-id', privado: true, mimeType: 'image/png' });
    }
    assert.equal(path, '/api/reports');
    assert.deepEqual(JSON.parse(String(options.body)), { tipo: 'robo', descripcion: 'Hecho observado', adjuntosIds: ['server-issued-id'] });
    return Response.json({ reporte: { id: 70 }, incidente: { id: 80 } });
  });
  const result = await submitReportWithEvidence({ tipo: 'robo', descripcion: 'Hecho observado' }, [photo()], rules);
  assert.equal(result.reporte.id, 70);
  assert.deepEqual(calls, ['/api/uploads', '/api/reports']);
});

test('non-individual report uploads remain public and successful submissions never delete evidence', async (t) => {
  decoder(t);
  let removed = 0;
  const transport = ports({
    upload: async (file, privado, tipo) => {
      assert.equal(privado, false);
      assert.equal(tipo, 'PUBLICO');
      return { id: 'public-photo', nombre: file.name, mimeType: file.type, privado, url: '/api/uploads/public-photo' };
    },
    remove: async () => { removed++; },
  });
  await submitReportWithEvidence({ tipo: 'bache' }, [photo()], { ...rules, individual: false }, transport);
  assert.equal(removed, 0);
});

test('partial upload failure cleans only previously issued IDs and never creates a report', async (t) => {
  decoder(t);
  const removed: string[] = [];
  let calls = 0;
  let created = false;
  const transport = ports({
    upload: async (file) => {
      if (++calls === 2) throw new Error('Upload failed');
      return { id: 'first-photo', nombre: file.name, mimeType: file.type, privado: true, url: null };
    },
    create: async () => { created = true; throw new Error('Unexpected create'); },
    remove: async (id) => { removed.push(id); },
  });
  await assert.rejects(submitReportWithEvidence({}, [photo(), photo()], rules, transport), /Upload failed/);
  assert.deepEqual(removed, ['first-photo']);
  assert.equal(created, false);
});

test('failed report creation awaits all cleanup and preserves the original failure if cleanup also fails', async (t) => {
  decoder(t);
  const removed: string[] = [];
  const transport = ports({
    create: async () => { throw new Error('Report rejected'); },
    remove: async (id) => { removed.push(id); throw new Error('Cleanup unavailable'); },
  });
  await assert.rejects(submitReportWithEvidence({}, [photo(), photo()], rules, transport), /Report rejected/);
  assert.deepEqual(removed, ['attachment-1', 'attachment-2']);
});

test('individual report refuses evidence whose private flag was not confirmed by the server', async (t) => {
  decoder(t);
  const removed: string[] = [];
  const transport = ports({
    upload: async (file) => ({ id: 'unprotected', nombre: file.name, mimeType: file.type, privado: false, url: '/api/uploads/unprotected' }),
    create: async () => { throw new Error('Unexpected create'); },
    remove: async (id) => { removed.push(id); },
  });
  await assert.rejects(submitReportWithEvidence({}, [photo()], rules, transport), /privacidad/);
  assert.deepEqual(removed, ['unprotected']);
});

test('account change while decoding cancels the report before any upload or POST', async (t) => {
  let release!: () => void;
  let entered!: () => void;
  const decoding = new Promise<void>((resolve) => { entered = resolve; });
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  decoder(t, async () => { entered(); await waiting; return { width: 1, height: 1, close() {} }; });
  let owner = 1;
  const controller = new AbortController();
  let mutations = 0;
  const transport = ports({
    upload: async () => { mutations++; throw new Error('Unexpected upload'); },
    create: async () => { mutations++; throw new Error('Unexpected POST'); },
    remove: async () => { mutations++; },
  });
  const submitted = submitReportWithEvidence({}, [photo()], rules, transport, {
    signal: controller.signal, isCurrent: () => owner === 1,
  });
  const rejected = assert.rejects(submitted, { name: 'AbortError' });
  await decoding;
  owner = 2;
  controller.abort();
  release();
  await rejected;
  assert.equal(mutations, 0);
});

test('account change during a later upload prevents report creation and skips cleanup with the new account', async (t) => {
  decoder(t);
  let release!: () => void;
  let entered!: () => void;
  const uploading = new Promise<void>((resolve) => { entered = resolve; });
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let owner = 1;
  let uploaded = 0;
  let created = 0;
  const removed: string[] = [];
  const controller = new AbortController();
  const transport = ports({
    upload: async (file, privado, tipo, options) => {
      assert.equal(options?.signal, controller.signal);
      const id = `owner-1-file-${++uploaded}`;
      if (uploaded === 2) { entered(); await waiting; }
      return { id, nombre: file.name, mimeType: file.type, privado, url: null, tipo };
    },
    create: async () => { created++; throw new Error('Unexpected POST with account 2'); },
    remove: async (id) => { removed.push(id); },
  });
  const submitted = submitReportWithEvidence({}, [photo(), photo()], rules, transport, {
    signal: controller.signal, isCurrent: () => owner === 1,
  });
  const rejected = assert.rejects(submitted, { name: 'AbortError' });
  await uploading;
  owner = 2;
  controller.abort();
  release();
  await rejected;
  assert.equal(uploaded, 2);
  assert.equal(created, 0);
  assert.deepEqual(removed, []);
});

test('owner guard independently cancels writes even if a transport ignores the AbortSignal', async (t) => {
  decoder(t);
  let owner = 1;
  let created = 0;
  let removed = 0;
  const transport = ports({
    upload: async (file) => { owner = 2; return { id: 'old-owner-photo', nombre: file.name, mimeType: file.type, privado: true, url: null }; },
    create: async () => { created++; throw new Error('Unexpected POST'); },
    remove: async () => { removed++; },
  });
  await assert.rejects(submitReportWithEvidence({}, [photo()], rules, transport, { isCurrent: () => owner === 1 }), { name: 'AbortError' });
  assert.equal(created, 0);
  assert.equal(removed, 0);
});
