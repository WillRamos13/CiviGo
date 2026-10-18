const test = require('node:test');
const assert = require('node:assert/strict');
const { managedUserState, assertManagedUserUnchanged } = require('../src/lib/managed-user-state');

const original = {
  id: 2, rol: 'AGENTE', tipoAgente: 'SERENAZGO', distrito: 'Ica',
  permisos: ['consultar', 'validar'], premium: false, bloqueado: false, correoVerificado: true,
};

test('la precondición administrativa compara permisos efectivos y rechaza estados incompletos', () => {
  const expected = managedUserState(original);
  assert.doesNotThrow(() => assertManagedUserUnchanged({ ...original, permisos: ['validar', 'consultar'] }, expected));
  assert.doesNotThrow(() => assertManagedUserUnchanged(original, undefined));
  for (const value of [null, [], {}, { ...expected, bloqueado: 'false' }, { ...expected, permisos: ['admin'] }, { ...expected, extra: true }])
    assert.throws(() => assertManagedUserUnchanged(original, value), { status: 400, code: 'ADMIN_USER_STATE_INVALID' });
  for (const change of [{ bloqueado: true }, { permisos: ['consultar'] }, { correoVerificado: false }, { distrito: 'Parcona' }])
    assert.throws(() => assertManagedUserUnchanged({ ...original, ...change }, expected), { status: 409, code: 'ADMIN_USER_CHANGED' });
});

test('el PATCH real no deshace un bloqueo ni permisos revocados entre abrir y guardar', async () => {
  require('./helpers/provider-environment').disableExternalProviders();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = '';
  const previous = globalThis.__civigoPrisma;
  const admin = { id: 1, rol: 'ADMIN', bloqueado: false, correoVerificado: true };
  let account = { ...original }, updates = [], audits = [];
  const db = {
    session: { findUnique: async () => ({ id: 'fixture-session', expiresAt: new Date(Date.now() + 60000), usuario: admin }) },
    user: {
      findUnique: async ({ where }) => where.id === admin.id ? admin : account,
      update: async ({ data }) => { updates.push(data); account = { ...account, ...data }; return account; },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    $transaction: async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(db); },
  };
  globalThis.__civigoPrisma = db;
  let server;
  try {
    const app = require('express')();
    app.use(require('express').json());
    app.use('/api/admin', require('../src/routes/admin'));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const patch = async body => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/2`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: 'civigo_session=' + 'a'.repeat(64), Connection: 'close' }, body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    };
    const expected = managedUserState(original);
    for (const change of [{ bloqueado: true }, { permisos: ['consultar'] }]) {
      account = { ...original, ...change }; updates = []; audits = [];
      const response = await patch({ premium: true, estadoAnterior: expected });
      assert.equal(response.status, 409, JSON.stringify(response));
      assert.equal(response.data.code, 'ADMIN_USER_CHANGED');
      assert.deepEqual(updates, []); assert.deepEqual(audits, []);
      assert.deepEqual(managedUserState(account), managedUserState({ ...original, ...change }));
    }
    account = { ...original }; updates = []; audits = [];
    const saved = await patch({ premium: true, estadoAnterior: expected });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.equal(saved.data.usuario.premium, true);
    assert.deepEqual(updates, [{ premium: true }]);
    assert.equal(audits.length, 1);
    assert.equal('estadoAnterior' in audits[0].datos, false);
    // An older partial client remains compatible and does not resend a block.
    account = { ...original, bloqueado: true }; updates = [];
    assert.equal((await patch({ premium: true })).status, 200);
    assert.equal(account.bloqueado, true);
    assert.deepEqual(updates, [{ premium: true }]);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete globalThis.__civigoPrisma;
    else globalThis.__civigoPrisma = previous;
  }
});
