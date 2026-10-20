"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { parseArgs, targetFor } = require("../scripts/import-official-history");
test("La carga oficial es vista previa por defecto y requiere cantidad y destino explícitos", () => {
  assert.equal(
    parseArgs(["--input", "datos.json", "--expected-count", "3412"]).commit,
    false,
  );
  assert.equal(
    parseArgs(["--input", "datos.json", "--expected-count", "3412", "--commit"])
      .commit,
    true,
  );
  assert.throws(() => parseArgs(["--input", "datos.json"]));
  assert.throws(() => parseArgs(["--delete"]));
  assert.throws(() =>
    targetFor(
      "postgresql://postgres:secret@db.otro.supabase.co/postgres",
      "esperado",
    ),
  );
  assert.throws(() =>
    targetFor(
      "postgresql://postgres.otro:secret@aws.pooler.supabase.com:6543/postgres",
      "esperado",
    ),
  );
  const target = targetFor(
    "postgresql://postgres.esperado:secret@aws.pooler.supabase.com:6543/postgres",
    "esperado",
  );
  assert.equal(target.projectRef, "esperado");
  assert.equal(JSON.stringify(target).includes("secret"), false);
});
