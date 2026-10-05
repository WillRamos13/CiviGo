"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDemoUsers } = require("../scripts/create-demo-users");
const { verifyPassword } = require("../src/lib/password");

test("Las cuentas de demostración se crean verificadas, sin privilegios y con contraseñas hasheadas", async () => {
  const records = new Map();
  const audits = [];
  const database = {
    user: { findUnique: async ({ where }) => records.get(where.id) },
    $transaction: async (action) =>
      action({
        user: {
          create: async ({ data }) => {
            const user = { ...data, id: records.size + 1 };
            records.set(user.id, user);
            return user;
          },
        },
        auditLog: {
          create: async ({ data }) => {
            audits.push(data);
          },
        },
      }),
  };
  const accounts = await createDemoUsers({ database });
  assert.equal(accounts.length, 2);
  assert.equal(new Set(accounts.map((account) => account.password)).size, 2);
  assert.equal(new Set(accounts.map((account) => account.correo)).size, 2);
  for (const account of accounts) {
    const stored = records.get(account.id);
    assert.match(account.correo, /@civigo\.test$/);
    assert.match(stored.telefono, /^\+999\d{11}$/);
    assert.equal(stored.correoVerificado, true);
    assert.equal(stored.telefonoVerificado, false);
    assert.equal(stored.rol, "USUARIO");
    assert.ok(account.password.length >= 24);
    assert.notEqual(account.password, stored.password);
    assert.ok(await verifyPassword(account.password, stored.password));
    assert.ok(!JSON.stringify(audits).includes(account.password));
  }
  assert.equal(audits.length, 2);
  assert.ok(
    audits.every((entry) => entry.datos.verificacionGoogleReal === false),
  );
});

test("Las cuentas demo requieren dependencia explícita y limitan la creación a dos", async () => {
  await assert.rejects(createDemoUsers(), /explícita/);
  await assert.rejects(
    createDemoUsers({ database: {}, count: 3 }),
    /explícita/,
  );
});
