const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { backendUrl, requestOrigin, validateRequest, validateUpload, uploadId, publicUrl, senderAllowed, bundlePath, RENDERER_URL, MAX_FILE_BYTES } = require('../electron/policy.cjs');

test('backend HTTPS y origen: localhost HTTP sólo en desarrollo, sin credenciales ni rutas', () => {
  assert.equal(backendUrl('https://example.test/'), 'https://example.test');
  assert.equal(backendUrl('http://127.0.0.1:3001', true), 'http://127.0.0.1:3001');
  assert.equal(requestOrigin('https://civigo.online'), 'https://civigo.online');
  for (const value of ['http://example.test', 'http://localhost:3001', 'file:///etc/passwd', 'https://a:b@example.test', 'https://example.test/api', 'https://example.test/?key=value', 'https://example.test/#x', null]) {
    assert.throws(() => backendUrl(value));
  }
  assert.throws(() => backendUrl('http://169.254.169.254', true));
});

test('IPC admite sólo endpoints y métodos concretos del panel administrativo', () => {
  for (const route of ['/admin', '/admin/catalog', '/admin/users', '/admin/incidents', '/admin/integrations', '/catalog', '/users/me']) assert.equal(validateRequest({ route }).method, 'GET');
  assert.equal(validateRequest({ route: '/admin/incidents/25/review', method: 'POST', body: '{"decision":"VALIDAR"}' }).method, 'POST');
  assert.equal(validateRequest({ route: '/admin/config', method: 'PATCH', body: '{}' }).method, 'PATCH');
  assert.equal(validateRequest({ route: '/admin/users', method: 'POST', body: '{"correoVerificado":true,"motivoVerificacion":"Comprobación administrativa"}' }).method, 'POST');
  for (const route of ['/admin/users/1', '/users/register', '/admin/users/bulk']) assert.throws(() => validateRequest({ route, method: 'POST', body: '{}' }));
  assert.equal(validateRequest({ route: '/history/import/commit', method: 'POST', body: '{}' }).method, 'POST');
  for (const route of ['https://evil.test', '/admin/../users/login', '/admin//users', '/admin/users?limit=1', '/admin/%75sers', '/admin\\users', '/users/login', '/users/register', '/admin/phone-verifications', '/admin/users/0']) assert.throws(() => validateRequest({ route }));
  assert.throws(() => validateRequest({ route: '/admin/users', method: 'DELETE' }));
  assert.throws(() => validateRequest({ route: '/admin/users', body: '{}' }));
  for (const body of ['null', '[]', '{invalid}', '"text"', ' '.repeat(3 * 1024 * 1024 + 1)]) assert.throws(() => validateRequest({ route: '/admin/config', method: 'PATCH', body }));
});

test('los archivos se limitan a 15 MB y a tipos de adjuntos aceptados por el backend', () => {
  const file = { name: 'prueba.pdf', mimeType: 'application/pdf', tipo: 'IDENTIDAD', privado: true, bytes: new Uint8Array([1, 2]) };
  const value = validateUpload(file);
  assert.deepEqual(value.bytes, file.bytes);
  assert.notEqual(value.bytes, file.bytes);
  assert.equal(validateUpload({ ...file, tipo: 'PUBLICO', privado: false }).tipo, 'PUBLICO');
  for (const patch of [{ name: '../prueba.pdf' }, { mimeType: 'application/javascript' }, { tipo: 'REPORTE' }, { privado: 'true' }, { bytes: [] }, { bytes: new Uint8Array() }, { bytes: new Uint8Array(MAX_FILE_BYTES + 1) }]) assert.throws(() => validateUpload({ ...file, ...patch }));
  assert.equal(uploadId('file-id_1'), 'file-id_1');
  for (const value of ['../file', 'x?secret', '', 'http://evil']) assert.throws(() => uploadId(value));
});

test('los enlaces públicos son una lista limitada y nunca aceptan URLs arbitrarias', () => {
  assert.equal(publicUrl('/mapa'), 'https://civigo.online/mapa');
  assert.equal(publicUrl('/incidentes/12'), 'https://civigo.online/incidentes/12');
  for (const value of ['https://evil.test', '/gestion', '/admin', '/mapa?redirect=https://evil.test', '/incidentes/0', '/mapa/../admin']) assert.throws(() => publicUrl(value));
});

test('sólo el frame principal del bundle local puede invocar IPC', () => {
  const mainFrame = { url: RENDERER_URL };
  const contents = { mainFrame };
  const window = { webContents: contents, isDestroyed: () => false };
  assert.equal(senderAllowed({ sender: contents, senderFrame: mainFrame }, window), true);
  assert.equal(senderAllowed({ sender: {}, senderFrame: mainFrame }, window), false);
  assert.equal(senderAllowed({ sender: contents, senderFrame: { url: RENDERER_URL } }, window), false);
  mainFrame.url = 'https://civigo.online';
  assert.equal(senderAllowed({ sender: contents, senderFrame: mainFrame }, window), false);
  assert.equal(senderAllowed({ sender: contents }, { ...window, isDestroyed: () => true }), false);
});

test('el protocolo local no sirve archivos fuera del bundle', () => {
  const root = path.resolve('fixture-dist');
  assert.equal(bundlePath(root, RENDERER_URL), path.join(root, 'index.html'));
  assert.equal(bundlePath(root, 'civigo://app/assets/main.js'), path.join(root, 'assets', 'main.js'));
  for (const value of ['file:///index.html', 'civigo://other/index.html', 'civigo://app/assets/%2e%2e%2f%2e%2e%2fsecret.txt', 'civigo://app/%5c..%5csecret.txt', 'civigo://app/index.html?key=secret', 'civigo://app/%00', 'civigo://app/%zz']) assert.throws(() => bundlePath(root, value));
});
