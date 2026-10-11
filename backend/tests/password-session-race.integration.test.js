const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  if (!['localhost', '127.0.0.1'].includes(new URL(connection).hostname)) throw new Error('Requires local test database');
  require('./helpers/provider-environment').disableExternalProviders();
  process.env.DATABASE_URL = connection;
}

test('An in-flight login cannot create a session after its password was changed or reset', { skip: !connection, timeout: 60000 }, async t => {
  const db = require('../src/lib/db');
  const auth = require('../src/lib/auth');
  const { hashPassword } = require('../src/lib/password');
  const { changePassword, requestReset, finishReset } = require('../src/lib/password-reset');
  const id = crypto.randomUUID();
  const originalPassword = 'Fixture-original-123!';
  const changedPassword = 'Fixture-changed-123!';
  const resetPassword = 'Fixture-reset-123!';
  const user = await db.user.create({ data: { nombreUsuario: id, correo: id + '@gmail.com', telefono: id, password: await hashPassword(originalPassword) } });
  const originalCreateSession = auth.createSession;
  let gate = null;
  let server;
  let activeRequest;
  t.mock.method(auth, 'createSession', async (...args) => {
    if (gate) { gate.entered(); await gate.release; }
    return originalCreateSession(...args);
  });
  try {
    const app = require('express')();
    app.use(require('express').json());
    app.use('/users', require('../src/routes/users'));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = password => fetch(base + '/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo: user.correo, password }), signal: AbortSignal.timeout(15000) });

    async function interleavedLogin(password, mutation) {
      let entered;
      const credentialVerified = new Promise(resolve => { entered = resolve; });
      let release;
      gate = { entered, release: new Promise(resolve => { release = resolve; }), unblock: () => release() };
      activeRequest = login(password);
      let timer;
      try {
        await Promise.race([credentialVerified, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Login did not reach the verified credential boundary')), 5000); })]);
        clearTimeout(timer);
        await mutation();
      } finally { clearTimeout(timer); gate.unblock(); gate = null; }
      const response = await activeRequest;
      activeRequest = null;
      assert.equal(response.status, 401, JSON.stringify(await response.json()));
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(await db.session.count({ where: { usuarioId: user.id } }), 0);
    }

    await t.test('Password change invalidates a previously verified old-password login', async () => {
      await interleavedLogin(originalPassword, () => changePassword(db, user.id, originalPassword, changedPassword));
      const good = await login(changedPassword);
      assert.equal(good.status, 200); assert.ok(good.headers.get('set-cookie')); await good.arrayBuffer();
      const old = await login(originalPassword);
      assert.equal(old.status, 401); await old.arrayBuffer();
    });
    await t.test('Email recovery also blocks the delayed login and revokes its older sessions', async () => {
      let token;
      await requestReset(db, user.correo, async (_email, _subject, html) => { token = html.match(/#token=([a-f0-9]{64})/)[1]; return true; });
      await interleavedLogin(changedPassword, () => finishReset(db, token, resetPassword));
      const good = await login(resetPassword);
      assert.equal(good.status, 200); assert.ok(good.headers.get('set-cookie')); await good.arrayBuffer();
    });
  } finally {
    gate?.unblock();
    await activeRequest?.catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    await db.session.deleteMany({ where: { usuarioId: user.id } });
    await db.verification.deleteMany({ where: { usuarioId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
