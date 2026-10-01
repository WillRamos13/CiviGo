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
