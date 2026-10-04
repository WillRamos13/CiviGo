const test = require("node:test");
const assert = require("node:assert/strict");
const { processLifecycle } = require("../src/lib/lifecycle");

function fixture(current) {
  const now = new Date("2026-10-01T12:00:00Z");
  const incident = {
    id: 9001,
    individual: true,
    publicado: true,
    validacion: 0.5,
    estado: "ACTIVO",
    fechaCreacion: new Date(+now - 8 * 86400000),
  };
  const initial = {
    id: 9002,
    fechaCreacion: new Date(+now - 8 * 86400000),
    recordatorioEnviado: true,
    estado: "PENDIENTE",
    usuario: { correo: "fixture@tests.civigo.local" },
    incidente: incident,
    adjuntos: [],
  };
  const calls = [];
  const db = {
    report: {
      findMany: async () => [initial],
      findUnique: async () => ({ ...initial, ...current }),
      update: async (args) => calls.push(["report", args]),
    },
    incident: { update: async (args) => calls.push(["incident", args]) },
    notification: { findFirst: async () => ({ id: "already-notified" }) },
    session: { deleteMany: async () => ({ count: 0 }) },
    verification: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (work, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      return work(db);
    },
  };
  return { now, db, calls, incident };
}

test("El plazo no retira un incidente validado después de la lectura inicial", async () => {
  const f = fixture({
    incidente: {
      id: 9001,
      individual: true,
      publicado: true,
      validacion: 1,
      estado: "VALIDADO",
    },
    estado: "VALIDADO",
  });
  assert.deepEqual(await processLifecycle(f.now, f.db), {
    reminders: 0,
    expired: 0,
    reduced: 0,
  });
  assert.equal(f.calls.length, 0);
});

test("Las pruebas presentadas conservan el reporte pendiente durante la revisión humana", async () => {
  const f = fixture({ adjuntos: [{ id: "private-proof", tipo: "EVIDENCIA" }] });
  assert.deepEqual(await processLifecycle(f.now, f.db), {
    reminders: 0,
    expired: 0,
    reduced: 0,
  });
  assert.equal(f.calls.length, 0);
});

test("El retiro sin pruebas actualiza reporte e incidente en una transacción", async () => {
  const f = fixture({});
  assert.deepEqual(await processLifecycle(f.now, f.db), {
    reminders: 0,
    expired: 1,
    reduced: 0,
  });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0][1].data.estado, "RETIRADO");
  assert.equal(f.calls[0][1].data.publicado, false);
  assert.equal(f.calls[1][1].data.estado, "RETIRADO");
});

test("Una publicación reciente conserva los siete días aunque el reporte se haya enviado antes", async () => {
  const f = fixture({});
  f.incident.fechaPublicacion = new Date(+f.now - 86400000);
  assert.deepEqual(await processLifecycle(f.now, f.db), {
    reminders: 0,
    expired: 0,
    reduced: 0,
  });
  assert.equal(f.calls.length, 0);
});

test("Los recordatorios aceptados conservan la clave idempotente si falla el marcado local", async () => {
  const keys = ["RESEND_API_KEY", "EMAIL_FROM"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  const f = fixture({});
  f.incident.fechaPublicacion = new Date(+f.now - 2 * 86400000);
  f.db.report.findMany = async () => [
    {
      id: 9002,
      recordatorioEnviado: false,
      usuario: { correo: "fixture@tests.civigo.local" },
      incidente: f.incident,
      adjuntos: [],
    },
  ];
  let failed = true;
  f.db.report.update = async (args) => {
    assert.equal(args.data.recordatorioEnviado, true);
    if (failed) throw new Error("Fixture de escritura local fallida");
    f.calls.push(["report", args]);
  };
  const emails = [];
  process.env.RESEND_API_KEY = "fixture-only-not-a-key";
  process.env.EMAIL_FROM = "fixture@tests.civigo.local";
  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    emails.push(options);
    return { ok: true, json: async () => ({ id: "fixture-mail-id" }) };
  };
  try {
    await assert.rejects(processLifecycle(f.now, f.db), /escritura local/);
    failed = false;
    assert.equal((await processLifecycle(f.now, f.db)).reminders, 1);
    assert.equal(emails.length, 2);
    assert.equal(
      emails[0].headers["Idempotency-Key"],
      "report-proof-reminder/9002",
    );
    assert.equal(
      emails[1].headers["Idempotency-Key"],
      emails[0].headers["Idempotency-Key"],
    );
    assert.equal(emails[1].body, emails[0].body);
    assert.equal(f.calls.length, 1);
    global.fetch = async () => ({ ok: true, json: async () => ({}) });
    assert.equal((await processLifecycle(f.now, f.db)).reminders, 0);
    assert.equal(
      f.calls.length,
      1,
      "Respuesta sin id no marca un envío inexistente",
    );
    f.incident.fechaPublicacion = new Date(+f.now - 8 * 86400000);
    f.db.report.update = async (args) => f.calls.push(["report", args]);
    global.fetch = () =>
      assert.fail("No debe recordar aportar pruebas cuando el plazo ya venció");
    await processLifecycle(f.now, f.db);
  } finally {
    global.fetch = previousFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
