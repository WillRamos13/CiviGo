"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const reset = require("../src/lib/explicit-data-reset");
const cli = require("../scripts/reset-accounts-incidents");
const { permissionKeys } = require("../src/lib/agent-permissions");

const connection = "postgresql://operator:private@127.0.0.1:5432/reset_test";
function input() {
  return {
    format: reset.INPUT_FORMAT,
    accounts: Array.from({ length: 5 }, (_, index) => ({
      correo: `reset${index}@civigo.test`,
      nombreUsuario: `reset${index}`,
      password: "local-fixture-password",
      rol: index === 4 ? "AGENTE" : "ADMIN",
      ...(index === 4 ? { tipoAgente: "COLABORADOR" } : {}),
    })),
    datasetOptions: {
      now: "2026-10-13T18:00:00.000Z",
      count: 500,
      seed: "isolated-unit-fixture",
    },
  };
}
function snapshot() {
  const tables = Object.fromEntries(
    reset.snapshotTables.map(([table]) => [table, []]),
  );
  return {
    format: reset.SNAPSHOT_FORMAT,
    capturedAt: "2026-10-13T18:00:00.000Z",
    targetFingerprint: reset.identityFingerprint(connection),
    stateFingerprint: reset.fingerprint(tables),
    tables,
  };
}
function assertCode(fn, code) {
  assert.throws(fn, (error) => error.code === code);
}

test("reset target fingerprint excludes passwords and pool tuning but binds role, host, port, database and schema", () => {
  const first = reset.identityFingerprint(connection);
  assert.equal(
    first,
    reset.identityFingerprint(
      connection.replace("private", "replacement") +
        "?connection_limit=2&pgbouncer=true",
    ),
  );
  for (const changed of [
    connection.replace("operator:", "different:"),
    connection.replace("5432", "6543"),
    connection.replace("127.0.0.1", "localhost"),
    connection.replace("reset_test", "other_db"),
  ])
    assert.notEqual(first, reset.identityFingerprint(changed));
  for (const changed of [
    "https://example.test",
    connection + "?schema=other",
    connection + "?schema=public&schema=public",
  ])
    assertCode(() => reset.identityFingerprint(changed), "RESET_TARGET");
});

test("snapshot hash is stable for JSON/date representation and is required for every model", () => {
  const value = snapshot();
  value.tables.User = [
    { id: 1, fechaCreacion: new Date("2026-10-13T18:00:00Z"), rol: "USUARIO" },
  ];
  value.stateFingerprint = reset.fingerprint(value.tables);
  const reloaded = JSON.parse(JSON.stringify(value));
  assert.equal(reset.validateSnapshot(reloaded, connection), reloaded);
  reloaded.tables.User[0].rol = "ADMIN";
  assertCode(
    () => reset.validateSnapshot(reloaded, connection),
    "RESET_BACKUP",
  );
  const missing = snapshot();
  delete missing.tables.Attachment;
  assertCode(() => reset.validateSnapshot(missing, connection), "RESET_BACKUP");
  const wrong = snapshot();
  wrong.targetFingerprint = "different";
  assertCode(() => reset.validateSnapshot(wrong, connection), "RESET_BACKUP");
});

test("backups include every retained legacy table and refuse an older backup for a database with legacy relations", () => {
  const old = snapshot();
  assert.equal(reset.fingerprintSnapshotState(old), old.stateFingerprint);
  assertCode(
    () =>
      reset.validateSnapshot(old, connection, {
        expectedLegacyTables: reset.legacyTableNames,
      }),
    "RESET_BACKUP",
  );
  const value = snapshot();
  value.legacyTables = Object.fromEntries(
    reset.legacyTableNames.map((table) => [table, []]),
  );
  value.legacyTables.ReportComment.push({
    id: 8,
    reporteId: 7,
    usuarioId: 4,
    mensaje: "Comentario antiguo",
  });
  value.stateFingerprint = reset.fingerprintSnapshotState(value);
  value.criticalStateFingerprint =
    reset.fingerprintSnapshotCriticalState(value);
  reset.validateSnapshot(value, connection, {
    expectedLegacyTables: reset.legacyTableNames,
  });
  const original = value.criticalStateFingerprint;
  value.legacyTables.ReportComment[0].mensaje = "Cambio concurrente";
  assert.notEqual(reset.fingerprintSnapshotCriticalState(value), original);
  assertCode(() => reset.validateSnapshot(value, connection), "RESET_BACKUP");
});

test("schema inventory stops on an added relation rather than silently leaving orphaned accounts", () => {
  reset.assertModelInventory();
  assertCode(
    () =>
      reset.assertModelInventory([
        ...reset.snapshotTables.map(([name]) => ({ name })),
        { name: "NewUserDependent" },
      ]),
    "RESET_SCHEMA_CHANGED",
  );
});

test("live quota usage is preserved without hiding changes to old upload quotas or protected data", () => {
  const value = snapshot().tables;
  value.User = [{ id: 2 }];
  value.UsageCounter = [
    { clave: "ai:chat:day:2026-10-13", cantidad: 2 },
    { clave: "uploads:2:2026-10-13", cantidad: 1 },
  ];
  value.ExternalApiUsage = [{ proveedor: "TOMTOM", usadas: 2 }];
  const before = reset.criticalStateFingerprint(value);
  value.UsageCounter[0].cantidad = 3;
  value.ExternalApiUsage[0].usadas = 3;
  assert.equal(reset.criticalStateFingerprint(value), before);
  value.UsageCounter[1].cantidad = 2;
  assert.notEqual(reset.criticalStateFingerprint(value), before);
  value.UsageCounter[1].cantidad = 1;
  value.Business.push({ id: 5, nombre: "Changed advertisement" });
  assert.notEqual(reset.criticalStateFingerprint(value), before);
});

test("account input accepts exact requested short password, rejects duplicate identities, extra powers and wrong roles", () => {
  const value = input();
  value.accounts[0].password = "Ninechars";
  assert.equal(reset.validateInput(value).accounts[0].password, "Ninechars");
  assert.equal(
    reset.validateInput(value).accounts[4].tipoAgente,
    "COLABORADOR",
  );
  for (const modify of [
    (row) => {
      row.accounts[0].correo = row.accounts[1].correo;
    },
    (row) => {
      row.accounts[0].nombreUsuario = row.accounts[1].nombreUsuario;
    },
    (row) => {
      row.accounts[0].premium = true;
    },
    (row) => {
      row.accounts[4].tipoAgente = "POLICIA";
    },
    (row) => {
      row.accounts[0].rol = "USUARIO";
    },
    (row) => {
      row.accounts[0].password = "";
    },
    (row) => {
      row.datasetOptions.count = 499;
    },
    (row) => {
      row.datasetOptions.now = "invalid";
    },
    (row) => {
      row.datasetOptions.seed = "";
    },
  ]) {
    const invalid = input();
    modify(invalid);
    assertCode(() => reset.validateInput(invalid), "RESET_INPUT");
  }
});

test("inventory protects ad media and refuses a report file wrongly linked as an ad", () => {
  const value = snapshot();
  value.tables.User = [{ id: 7 }];
  value.tables.MapAnnouncement = [{ imagenId: "ad" }];
  value.tables.Attachment = [
    { id: "ad", usuarioId: 7, reporteId: null, path: "/private/ad.png" },
    { id: "report", usuarioId: 7, reporteId: 9, path: "/private/report.png" },
  ];
  const inventory = reset.resetInventory(value);
  assert.deepEqual(inventory.oldUserIds, [7]);
  assert.equal(inventory.preservedAttachments[0].id, "ad");
  assert.equal(inventory.purgeAttachments[0].id, "report");
  value.tables.Attachment[0].reporteId = 9;
  assertCode(() => reset.resetInventory(value), "RESET_BACKUP");
});

test("CLI is a read-only plan by default; apply needs exact target, backup and private new output", () => {
  assert.deepEqual(cli.parseArguments(["--input", ".local/input.json"]), {
    apply: false,
    input: ".local/input.json",
  });
  for (const args of [
    ["--apply", "--input", "x"],
    ["--input", "x", "--confirm-target", "y"],
    ["--input", "x", "--unknown", "y"],
    ["--input", "x", "--input", "y"],
  ])
    assertCode(() => cli.parseArguments(args), "RESET_INPUT");
  assert.equal(
    cli.privatePath(path.resolve(__dirname, "../../.local/reset/input.json")),
    path.resolve(__dirname, "../../.local/reset/input.json"),
  );
  for (const file of [
    path.resolve(__dirname, "../src/private.json"),
    path.resolve(__dirname, "../../.local/../tracked.json"),
    path.resolve(__dirname, "../../.local"),
  ])
    assertCode(() => cli.privatePath(file), "RESET_PRIVATE_FILE");
});

test("wrong target or missing backup fails before transaction and hashing, preserving the live database", async () => {
  let called = false;
  const database = {
    $transaction: async () => {
      called = true;
    },
  };
  await assert.rejects(
    reset.applyExplicitReset({
      database,
      connection,
      input: input(),
      snapshot: snapshot(),
      confirmTarget: "wrong",
      buildDataset: () => null,
    }),
    { code: "RESET_CONFIRM" },
  );
  await assert.rejects(
    reset.applyExplicitReset({
      database,
      connection,
      input: input(),
      confirmTarget: "wrong",
      buildDataset: () => null,
    }),
    { code: "RESET_BACKUP" },
  );
  assert.equal(called, false);
});

test("default plan reads all models but never calls a mutation and never returns password hashes", async () => {
  let transactions = 0;
  const tables = snapshot().tables;
  tables.User = [{ id: 2, password: "do-not-output-this-hash" }];
  const delegates = Object.fromEntries(
    reset.snapshotTables.map(([table, delegate]) => [
      delegate,
      {
        findMany: async () => tables[table],
        deleteMany: () => {
          throw new Error("mutation");
        },
        create: () => {
          throw new Error("mutation");
        },
      },
    ]),
  );
  delegates.$queryRawUnsafe = async () => [];
  const database = {
    ...delegates,
    $transaction: async (fn) => {
      transactions++;
      return fn(delegates);
    },
  };
  const result = await reset.planExplicitReset({
    database,
    connection,
    input: input(),
  });
  assert.equal(result.mode, "plan");
  assert.equal(result.counts.User, 1);
  assert.equal(transactions, 1);
  assert.equal(result.newReports, 500);
  assert.deepEqual(result.newAccounts[4].permisos, permissionKeys);
  assert.ok(!JSON.stringify(result).includes("do-not-output-this-hash"));
  assert.ok(!JSON.stringify(result).includes("local-fixture-password"));
});

module.exports = { resetInputFixture: input };
