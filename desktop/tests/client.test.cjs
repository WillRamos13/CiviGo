const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { ApiClient, privateCookie } = require('../electron/client.cjs');
const { MAX_FILE_BYTES } = require('../electron/policy.cjs');
const TOKEN = 'a'.repeat(64);
const administrator = { id: 1, nickname: 'admin-fixture', rol: 'ADMIN', correoVerificado: true, bloqueado: false };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const cookieHeader = (secure = false) => `civigo_session=${TOKEN}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}Expires=${new Date(Date.now() + 86400000).toUTCString()}`;
function fixture(custom = async () => json({ resultado: 'ok' })) {
  const calls = []; let user = { ...administrator };
  const client = new ApiClient({ baseUrl: 'https://api.example.test', origin: 'https://civigo.online', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/users/login')) return json({ usuario: user }, 200, { 'Set-Cookie': cookieHeader(true) });
    if (url.endsWith('/users/me')) return json({ usuario: user });
    if (url.endsWith('/users/logout')) return json({ ok: true });
    return custom(url, options);
  } });
  return { client, calls, user: value => { user = value; } };
}
const credentials = { correo: 'admin@example.test', password: 'fixture-only-never-real' };

test('cookie de sesión requiere HttpOnly, Secure sobre HTTPS, valor exacto y expiración válida', () => {
  assert.equal(privateCookie(new Headers({ 'Set-Cookie': cookieHeader(true) }), true).header, `civigo_session=${TOKEN}`);
  for (const value of [`civigo_session=${TOKEN}; Path=/; Secure`, `civigo_session=${TOKEN}; Path=/; HttpOnly`, 'civigo_session=invalid; Path=/; HttpOnly; Secure', `civigo_session=${TOKEN}; Path=/api; HttpOnly; Secure`, `civigo_session=${TOKEN}; Path=/; HttpOnly; Secure; Expires=Mon, 01 Jan 2001 00:00:00 GMT`]) assert.throws(() => privateCookie(new Headers({ 'Set-Cookie': value }), true));
});

test('login ADMIN envía Origin, mantiene cookie en main y devuelve únicamente usuario', async () => {
  const { client, calls } = fixture();
  assert.deepEqual(await client.login(credentials), administrator);
  assert.equal(client.authenticated(), true);
  assert.equal(calls[0].options.headers.Origin, 'https://civigo.online');
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(calls[1].options.headers.Cookie, `civigo_session=${TOKEN}`);
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(JSON.stringify(client).includes(TOKEN), false);
  assert.equal(JSON.stringify(await client.request({ route: '/admin' })).includes(TOKEN), false);
  await client.logout();
});

test('sin sesión, los endpoints privados y adjuntos no hacen ninguna solicitud', async () => {
  const { client, calls } = fixture();
  await assert.rejects(client.request({ route: '/admin/users' }), error => error.status === 401);
  await assert.rejects(client.attachment('file_1'), error => error.status === 401);
  assert.equal(calls.length, 0);
});

test('ciudadanos, agentes y administradores bloqueados no acceden al escritorio', async () => {
  for (const user of [{ ...administrator, rol: 'USUARIO' }, { ...administrator, rol: 'AGENTE' }, { ...administrator, bloqueado: true }]) {
    const item = fixture(); item.user(user);
    await assert.rejects(item.client.login(credentials), error => error.status === 403);
    assert.equal(item.client.authenticated(), false);
    assert.equal(item.calls.some(call => call.url.endsWith('/users/logout')), true);
  }
});

test('revocar rol entre login y /me invalida la sesión antes de mostrar el panel', async () => {
  const client = new ApiClient({ baseUrl: 'https://api.example.test', origin: 'https://civigo.online', fetchImpl: async url => url.endsWith('/login') ? json({ usuario: administrator }, 200, { 'Set-Cookie': cookieHeader(true) }) : json({ usuario: { ...administrator, rol: 'USUARIO' } }) });
  await assert.rejects(client.login(credentials), error => error.status === 403);
  assert.equal(client.authenticated(), false);
});

test('un 401 del servidor borra la cookie y la autorización', async () => {
  const { client } = fixture(async () => json({ error: 'Sesión vencida' }, 401));
  await client.login(credentials);
  await assert.rejects(client.request({ route: '/admin/users' }), error => error.status === 401);
  assert.equal(client.authenticated(), false);
  assert.equal(await client.me(), null);
});

test('logout olvida la sesión aunque Railway no responda y cambia su generación', async () => {
  const item = fixture(); await item.client.login(credentials);
  const generation = item.client.generation();
  item.client.fetch = async () => { throw new Error('offline'); };
  await item.client.logout();
  assert.equal(item.client.authenticated(), false);
  assert.ok(item.client.generation() > generation);
  assert.equal(await item.client.me(), null);
});

test('una respuesta antigua no puede volver a entregar datos después del logout', async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const { client } = fixture(() => pending);
  await client.login(credentials);
  const request = client.request({ route: '/admin/users' });
  const rejected = assert.rejects(request, error => error.status === 401);
  await client.logout();
  resolve(json([{ correo: 'private@example.test' }]));
  await rejected;
  assert.equal(client.authenticated(), false);
});

test('cancelar ocho lecturas de pestañas libera el cupo sin cancelar mutaciones', async () => {
  const signals = []; let hold = true;
  const { client } = fixture(async (_url, options) => {
    signals.push(options.signal);
    if (!hold) return json({ resultado: 'ok' });
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  await client.login(credentials);
  const requests = Array.from({ length: 8 }, (_, index) => client.request({ route: '/admin/users', requestId: 'read_' + index }));
  const results = Promise.allSettled(requests);
  await assert.rejects(client.request({ route: '/admin' }), error => error.status === 429);
  for (let index = 0; index < 8; index++) client.cancelRead('read_' + index);
  assert.equal((await results).every(result => result.status === 'rejected'), true);
  assert.equal(signals.every(signal => signal.aborted), true);
  hold = false;
  assert.deepEqual(await client.request({ route: '/admin/users', requestId: 'read_next' }), { resultado: 'ok' });
  await assert.rejects(client.request({ route: '/admin/config', method: 'PATCH', body: '{}', requestId: 'mutation' }), error => error.status === 400);
  await client.logout();
});

test('el main rechaza respuestas desmesuradas y oculta detalles internos del servidor', async () => {
  const huge = fixture(async () => json({}, 200, { 'Content-Length': String(11 * 1024 * 1024) }));
  await huge.client.login(credentials);
  await assert.rejects(huge.client.request({ route: '/admin/users' }), error => error.status === 502);
  const failure = fixture(async () => json({ error: 'postgresql://password-secret@db/private' }, 500));
  await failure.client.login(credentials);
  await assert.rejects(failure.client.request({ route: '/admin' }), error => error.status === 500 && !error.message.includes('password-secret'));
  await huge.client.logout(); await failure.client.logout();
});

test('adjuntos privados pasan por main con cookie; los nombres no pueden guardar ejecutables', async () => {
  const { client, calls } = fixture(async () => new Response(Buffer.from('%PDF-fixture'), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="malicious.exe"' } }));
  await client.login(credentials);
  const file = await client.attachment('private_file');
  assert.equal(file.name, 'malicious.pdf'); assert.equal(file.mimeType, 'application/pdf');
  assert.equal(file.bytes.toString(), '%PDF-fixture');
  assert.equal(calls.at(-1).options.headers.Cookie, `civigo_session=${TOKEN}`);
  file.bytes.fill(0);
  await client.logout();
});

test('descargas rechazan MIME ejecutable y tamaño mayor a 15 MB', async () => {
  for (const headers of [{ 'Content-Type': 'application/x-msdownload' }, { 'Content-Type': 'application/pdf', 'Content-Length': String(MAX_FILE_BYTES + 1) }]) {
    const { client } = fixture(async () => new Response('file', { headers }));
    await client.login(credentials);
    await assert.rejects(client.attachment('private_file'), error => error.status === 502);
    await client.logout();
  }
});

test('un GIF válido ya almacenado en backend también se puede descargar', async () => {
  const { client } = fixture(async () => new Response('GIF89a', { headers: { 'Content-Type': 'image/gif' } }));
  await client.login(credentials);
  assert.equal((await client.attachment('image-fixture')).name, 'archivo-image-fixture.gif');
  await client.logout();
});

test('upload usa FormData nativo, conserva tipo privado y deja el boundary al transporte', async () => {
  const { client, calls } = fixture(async () => json({ id: 'upload_1', privado: true, tipo: 'IDENTIDAD' }));
  await client.login(credentials);
  const result = await client.upload({ name: 'identidad.pdf', mimeType: 'application/pdf', tipo: 'IDENTIDAD', privado: true, bytes: new Uint8Array([1, 2]) });
  assert.equal(result.id, 'upload_1');
  const call = calls.at(-1);
  assert.equal(call.options.body.get('tipo'), 'IDENTIDAD');
  assert.equal(call.options.body.get('privado'), 'true');
  assert.equal(call.options.headers['Content-Type'], undefined);
  assert.equal(call.options.headers.Cookie, `civigo_session=${TOKEN}`);
  await client.logout();
});

test('HTTP real local: redirects rechazados, cookie y multipart viajan por fetch del main', async t => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requests.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/users/login') { response.setHeader('Set-Cookie', cookieHeader(false)); response.end(JSON.stringify({ usuario: administrator })); }
    else if (request.url === '/api/users/me') response.end(JSON.stringify({ usuario: administrator }));
    else if (request.url === '/api/admin/users') { response.writeHead(302, { Location: '/api/private-redirect' }); response.end('{}'); }
    else response.end('{"ok":true}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new ApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, origin: 'https://civigo.online' });
  await client.login(credentials);
  await client.upload({ name: 'prueba.pdf', mimeType: 'application/pdf', tipo: 'IDENTIDAD', privado: true, bytes: new Uint8Array([1, 2, 3]) });
  const uploaded = requests.find(value => value.url === '/api/uploads');
  assert.match(uploaded.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.equal(uploaded.headers.cookie, `civigo_session=${TOKEN}`);
  assert.equal(uploaded.headers.origin, 'https://civigo.online');
  assert.match(uploaded.body, /name="tipo"\r\n\r\nIDENTIDAD/);
  await assert.rejects(client.request({ route: '/admin/users' }), error => error.code === 'DESKTOP_NETWORK');
  assert.equal(requests.some(value => value.url === '/api/private-redirect'), false);
  await client.logout();
  assert.equal(client.authenticated(), false);
});
