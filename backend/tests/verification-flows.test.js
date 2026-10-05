const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { HttpError } = require("../src/lib/http");

function matches(value, where) {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !(expected instanceof Date))
      return (
        (expected.gte === undefined || value[key] >= expected.gte) &&
        (expected.lt === undefined || value[key] < expected.lt)
      );
    return value[key] === expected;
  });
}
async function fixture() {
  const state = {
    user: {
      id: 123,
      telefono: "+51900000001",
      correo: "citizen@gmail.com",
      telefonoVerificado: false,
      correoVerificado: false,
      bloqueado: false,
    },
    records: [],
    googleConfigured: true,
    googleChecks: [],
    approved: true,
  };
  const db = {
    verification: {
      findFirst: async ({ where, orderBy }) => {
        const rows = state.records.filter((row) => matches(row, where));
        if (orderBy) rows.sort((a, b) => b.id - a.id);
        return rows[0] ? { ...rows[0] } : null;
      },
      count: async ({ where }) =>
        state.records.filter((row) => matches(row, where)).length,
      create: async ({ data }) => {
        const row = {
          ...data,
          id: state.records.length + 1,
          creadoEn: new Date(),
          intentos: 0,
          usado: false,
        };
        state.records.push(row);
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        const rows = state.records.filter((row) => matches(row, where));
        for (const row of rows) {
          if (data.intentos) row.intentos += data.intentos.increment;
          if (data.usado !== undefined) row.usado = data.usado;
          if (data.codigoHash !== undefined) row.codigoHash = data.codigoHash;
        }
        return { count: rows.length };
      },
    },
    user: {
      updateMany: async ({ where, data }) => {
        if (!matches(state.user, where)) return { count: 0 };
        Object.assign(state.user, data);
        return { count: 1 };
      },
      findUnique: async () => ({ ...state.user }),
    },
  };
  const fakeProviders = {
    verifyFirebaseEmail: async (...args) => {
      state.googleChecks.push(args);
      if (state.duringCheck) state.duringCheck();
      if (!state.approved)
        throw new HttpError(400, "Prueba inválida", "EMAIL_GOOGLE_INVALID");
      return { proofHash: state.proofHash || "signed-google-event-hash" };
    },
  };
  const overrides = {
    "../src/lib/firebase-email": {
      firebaseEmailConfig: () => ({
        configured: state.googleConfigured,
        projectId: "civigo-fixture",
      }),
    },
    "../src/lib/db": db,
    "../src/lib/auth": {
      ...require("../src/lib/auth"),
      auth: (req, res, next) => {
        req.user = { ...state.user };
        next();
      },
    },
    "../src/lib/workflows": { transaction: (work) => work(db) },
    "../src/lib/providers": fakeProviders,
    "../src/lib/projections": { ownUser: (user) => user },
  };
  const saved = [];
  const usersPath = require.resolve("../src/routes/users");
  const previousRouter = require.cache[usersPath];
  delete require.cache[usersPath];
  let router;
  try {
    for (const [path, exports] of Object.entries(overrides)) {
      const id = require.resolve(path);
      saved.push([id, require.cache[id]]);
      require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    router = require("../src/routes/users");
  } finally {
    for (const [id, value] of saved) {
      if (value) require.cache[id] = value;
      else delete require.cache[id];
    }
    if (previousRouter) require.cache[usersPath] = previousRouter;
    else delete require.cache[usersPath];
  }
  const app = express();
  app.use(express.json());
  app.use("/users", router);
  app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada." }));
  app.use((error, req, res, next) =>
    res
      .status(error.status || 500)
      .json({ error: error.message, code: error.code }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    state,
    request: async (route, body = {}) => {
      const response = await fetch(
        "http://127.0.0.1:" + server.address().port + "/users" + route,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return { status: response.status, json: await response.json() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("Google es la única verificación disponible y conserva cooldown y cinco solicitudes por hora", async () => {
  const f = await fixture();
  try {
    for (const route of [
      "/phone/request",
      "/phone/verify",
      "/email/request",
      "/email/verify",
    ])
      assert.equal((await f.request(route)).status, 404);
    f.state.googleConfigured = false;
    assert.equal((await f.request("/email/google/request")).status, 503);
    assert.equal(f.state.records.length, 0);
    f.state.googleConfigured = true;
    const request = await f.request("/email/google/request");
    assert.equal(request.status, 200);
    assert.equal(request.json.codigoDemo, undefined);
    assert.equal(request.json.codigo, undefined);
    assert.equal((await f.request("/email/google/request")).status, 429);
    assert.equal(f.state.records.length, 1);
    f.state.records[0].creadoEn = new Date(Date.now() - 120000);
    for (let i = 1; i < 5; i++)
      f.state.records.push({ ...f.state.records[0], id: i + 1 });
    const limited = await f.request("/email/google/request");
    assert.equal(limited.status, 429);
    assert.equal(limited.json.code, "VERIFICATION_RATE_LIMITED");
    assert.equal(f.state.records.length, 5);
  } finally {
    await f.close();
  }
});

test("las cuentas pendientes deben usar Gmail y las cuentas ya verificadas mantienen el acceso", async () => {
  const f = await fixture();
  try {
    f.state.user.correo = "workspace@empresa.test";
    for (const path of ["/email/google/request", "/email/google/verify"]) {
      const denied = await f.request(path, {
        challengeId: "1",
        idToken: "fixture-token-without-provider-call",
      });
      assert.equal(denied.status, 400);
      assert.equal(denied.json.code, "EMAIL_GMAIL_REQUIRED");
    }
    assert.equal(f.state.googleChecks.length, 0);
    assert.equal(f.state.records.length, 0);
    f.state.user.correo = "demo@civigo.test";
    f.state.user.correoVerificado = true;
    assert.equal((await f.request("/email/google/request")).status, 200);
    assert.equal((await f.request("/email/google/verify")).status, 200);
    assert.equal(f.state.user.correoVerificado, true);
    assert.equal(f.state.googleChecks.length, 0);
    assert.equal(f.state.records.length, 0);
  } finally {
    await f.close();
  }
});

test("Google exige el desafío propio, consume el evento firmado y rechaza su reutilización", async () => {
  const f = await fixture();
  try {
    const token = "local-signed-token-placeholder";
    const request = await f.request("/email/google/request");
    const body = { challengeId: request.json.challengeId, idToken: token };
    assert.equal(
      (
        await f.request("/email/google/verify", {
          ...body,
          challengeId: "99",
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request("/email/google/verify", { ...body, challengeId: 1 }))
        .status,
      400,
    );
    assert.equal(f.state.googleChecks.length, 0);
    const verified = await f.request("/email/google/verify", body);
    assert.equal(verified.status, 200);
    assert.equal(verified.json.usuario.correoVerificado, true);
    assert.equal(f.state.records[0].usado, true);
    assert.equal(f.state.records[0].codigoHash, "signed-google-event-hash");
    assert.deepEqual(f.state.googleChecks[0], [
      token,
      f.state.user.correo,
      f.state.records[0].creadoEn,
    ]);
    assert.equal((await f.request("/email/google/verify", body)).status, 200);
    assert.equal(f.state.googleChecks.length, 1);
    f.state.user.correoVerificado = false;
    f.state.records[0].creadoEn = new Date(Date.now() - 120000);
    const next = await f.request("/email/google/request");
    const replay = await f.request("/email/google/verify", {
      ...body,
      challengeId: next.json.challengeId,
    });
    assert.equal(replay.status, 409);
    assert.equal(replay.json.code, "EMAIL_GOOGLE_REPLAY");
    assert.equal(f.state.user.correoVerificado, false);
    assert.equal(f.state.records[1].usado, false);
  } finally {
    await f.close();
  }
});

test("Google conserva cinco intentos y no verifica si cambia el correo o se bloquea la cuenta", async () => {
  const f = await fixture();
  try {
    const request = await f.request("/email/google/request");
    const body = {
      challengeId: request.json.challengeId,
      idToken: "local-signed-token-placeholder",
    };
    f.state.approved = false;
    for (let i = 0; i < 6; i++)
      assert.equal((await f.request("/email/google/verify", body)).status, 400);
    assert.equal(f.state.googleChecks.length, 5);
    f.state.records[0].intentos = 0;
    f.state.approved = true;
    f.state.duringCheck = () => {
      f.state.user.bloqueado = true;
    };
    assert.equal((await f.request("/email/google/verify", body)).status, 409);
    assert.equal(f.state.user.correoVerificado, false);
  } finally {
    await f.close();
  }
});
