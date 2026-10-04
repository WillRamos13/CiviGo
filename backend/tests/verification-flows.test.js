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
      correo: "citizen@tests.local",
      telefonoVerificado: false,
      correoVerificado: false,
    },
    records: [],
    phoneConfigured: true,
    emailConfigured: true,
    phoneRequests: [],
    phoneChecks: [],
    emails: [],
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
    services: () => ({
      telefono: { configurado: state.phoneConfigured },
      correo: { configurado: state.emailConfigured },
    }),
    requestPhone: async (...args) => {
      if (!state.phoneConfigured)
        throw new HttpError(503, "No configurado", "PHONE_PROVIDER_MISSING");
      state.phoneRequests.push(args);
      return { status: "pending" };
    },
    checkPhone: async (...args) => {
      state.phoneChecks.push(args);
      if (state.duringCheck) state.duringCheck();
      return state.approved;
    },
    sendEmail: async (...args) => {
      state.emails.push(args);
      if (state.emailError) throw state.emailError;
      return true;
    },
  };
  const overrides = {
    "../src/lib/db": db,
    "../src/lib/auth": {
      ...require("../src/lib/auth"),
      auth: (req, res, next) => {
        req.user = { ...state.user };
        next();
      },
      demoEnabled: () => false,
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

test("La ruta valida canales, proveedor ausente y cooldown antes de generar envíos cobrables", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.request("/phone/request", { canal: "invalid" })).status,
      400,
    );
    assert.equal(f.state.records.length, 0);
    f.state.phoneConfigured = false;
    assert.equal((await f.request("/phone/request")).status, 503);
    assert.equal(f.state.records.length, 0);
    f.state.phoneConfigured = true;
    const requested = await f.request("/phone/request", { canal: "whatsapp" });
    assert.equal(requested.status, 200);
    assert.equal(requested.json.modo, "proveedor");
    assert.equal(requested.json.codigoDemo, undefined);
    assert.equal((await f.request("/phone/request")).status, 429);
    assert.equal(f.state.phoneRequests.length, 1);
    assert.deepEqual(f.state.phoneRequests[0], [
      f.state.user.telefono,
      "whatsapp",
    ]);
  } finally {
    await f.close();
  }
});

test("La aprobación de Twilio verifica el teléfono actual y repetir no genera otra llamada", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.request("/phone/verify", { codigo: "123456" })).status,
      400,
      "Requiere solicitar un código primero",
    );
    assert.equal(f.state.phoneChecks.length, 0);
    await f.request("/phone/request");
    assert.equal(
      (await f.request("/phone/verify", { codigo: "abc123" })).status,
      400,
    );
    const verified = await f.request("/phone/verify", { codigo: "123456" });
    assert.equal(verified.status, 200);
    assert.equal(verified.json.usuario.telefonoVerificado, true);
    assert.equal(f.state.records[0].usado, true);
    assert.equal(
      (await f.request("/phone/verify", { codigo: "123456" })).status,
      200,
    );
    assert.equal((await f.request("/phone/request")).status, 200);
    assert.equal(f.state.phoneChecks.length, 1);
    assert.equal(f.state.phoneRequests.length, 1);
  } finally {
    await f.close();
  }
});

test("Los intentos fallidos y los cambios concurrentes no aprueban otro teléfono", async () => {
  const f = await fixture();
  try {
    await f.request("/phone/request");
    f.state.approved = false;
    for (let i = 0; i < 6; i++)
      assert.equal(
        (await f.request("/phone/verify", { codigo: "123456" })).status,
        400,
      );
    assert.equal(f.state.phoneChecks.length, 5);
    assert.equal(f.state.user.telefonoVerificado, false);
    f.state.records[0].intentos = 0;
    f.state.approved = true;
    f.state.duringCheck = () => {
      f.state.user.telefono = "+51900000002";
    };
    assert.equal(
      (await f.request("/phone/verify", { codigo: "123456" })).status,
      409,
    );
    assert.equal(f.state.user.telefonoVerificado, false);
  } finally {
    await f.close();
  }
});

test("Los cinco códigos por hora se limitan en la base antes de contactar Twilio", async () => {
  const f = await fixture();
  try {
    f.state.records = Array.from({ length: 5 }, (_, id) => ({
      id: id + 1,
      usuarioId: 123,
      tipo: "TELEFONO",
      usado: true,
      creadoEn: new Date(Date.now() - 120000),
    }));
    const blocked = await f.request("/phone/request");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.code, "VERIFICATION_RATE_LIMITED");
    assert.equal(f.state.phoneRequests.length, 0);
  } finally {
    await f.close();
  }
});

test("La ruta de correo conserva idempotencia, errores del proveedor y confirmación solo del destino actual", async () => {
  const f = await fixture();
  try {
    const sent = await f.request("/email/request");
    assert.equal(sent.status, 200);
    assert.equal(sent.json.codigoDemo, undefined);
    const args = f.state.emails[0];
    assert.deepEqual(args[3], {
      idempotencyKey: "email-verification/1",
      throwOnError: true,
    });
    assert.equal((await f.request("/email/request")).status, 429);
    const code = args[2].match(/<strong>(\d{6})<\/strong>/)[1];
    f.state.user.correo = "changed@tests.local";
    assert.equal(
      (await f.request("/email/verify", { codigo: code })).status,
      409,
    );
    assert.equal(f.state.user.correoVerificado, false);
    f.state.user.correo = "citizen@tests.local";
    assert.equal(
      (await f.request("/email/verify", { codigo: code })).status,
      200,
    );
    assert.equal(f.state.user.correoVerificado, true);
    assert.equal((await f.request("/email/request")).status, 200);
    assert.equal(f.state.emails.length, 1);
  } finally {
    await f.close();
  }
  const failed = await fixture();
  try {
    failed.state.emailError = new HttpError(
      429,
      "Límite del proveedor",
      "EMAIL_RATE_LIMITED",
    );
    const result = await failed.request("/email/request");
    assert.equal(result.status, 429);
    assert.equal(result.json.code, "EMAIL_RATE_LIMITED");
    assert.equal(failed.state.user.correoVerificado, false);
  } finally {
    await failed.close();
  }
});
