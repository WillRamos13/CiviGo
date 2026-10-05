const test = require("node:test");
const assert = require("node:assert/strict");
const { requireEmail } = require("../src/lib/auth");

test("la participación depende del correo verificado y no del teléfono", () => {
  for (const telefonoVerificado of [true, false]) {
    let result;
    requireEmail(
      { user: { correoVerificado: false, telefonoVerificado } },
      {},
      (error) => {
        result = error;
      },
    );
    assert.equal(result.status, 403);
    assert.equal(result.code, "EMAIL_REQUIRED");
  }
  let called = false;
  requireEmail(
    {
      user: {
        correo: "demo@civigo.test",
        correoVerificado: true,
        telefonoVerificado: false,
      },
    },
    {},
    (error) => {
      assert.equal(error, undefined);
      called = true;
    },
  );
  assert.equal(called, true);
  let blocked;
  requireEmail(
    { user: { correoVerificado: true, bloqueado: true } },
    {},
    (error) => {
      blocked = error;
    },
  );
  assert.equal(blocked.status, 403);
});
