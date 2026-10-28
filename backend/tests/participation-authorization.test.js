"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

test("La revocación entre autenticación y transacción impide mensajes, pruebas y canjes", async (t) => {
  // Plain delegates replace Prisma before loading the real HTTP routes. No
  // connection, provider, seeded account or persistent file is involved.
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "";
  const previousPrisma = globalThis.__civigoPrisma;
  const authenticated = {
    id: 7,
    rol: "USUARIO",
    nombreUsuario: "fixture",
    bloqueado: false,
    correoVerificado: true,
  };
  let transactionUser;
  let mutations;
  const incident = {
    id: 2,
    estado: "ACTIVO",
    publicado: true,
    individual: false,
    reportes: [{ usuarioId: authenticated.id }],
  };
  const report = {
    id: 1,
    usuarioId: authenticated.id,
    estado: "PENDIENTE",
    incidente: incident,
    usuario: authenticated,
    adjuntos: [],
  };
  const changed = (action, value) => async () => {
    mutations.push(action);
    return value;
  };
  const db = {
    appConfig: {findUnique: async () => null},
    $transaction: async (work) => work(db),
    session: {
      findUnique: async () => ({
        id: "fixture-session",
        expiresAt: new Date(Date.now() + 60000),
        usuario: { ...authenticated },
      }),
    },
    user: {
      findUnique: async () => transactionUser,
      findMany: async () => [],
      update: changed("user.update", authenticated),
      updateMany: changed("user.updateMany", { count: 1 }),
    },
    incident: {
      count: async () => 1,
      findUnique: async () => incident,
    },
    report: {
      findFirst: async () => report,
      findUnique: async () => report,
      count: async () => 0,
      update: changed("report.update", report),
    },
    attachment: {
      count: async () => 0,
      updateMany: changed("attachment.updateMany", { count: 1 }),
    },
    chatMessage: {
      findMany: async () => [],
      create: changed("chatMessage.create", {
        id: 3,
        mensaje: "Mensaje local",
      }),
    },
    reward: {
      findUnique: async () => ({
        id: 1,
        activo: true,
        stock: 1,
        costoMonedas: 5,
      }),
      updateMany: changed("reward.updateMany", { count: 1 }),
    },
    redemption: { create: changed("redemption.create", { id: 4 }) },
  };
  globalThis.__civigoPrisma = db;
  let server;
  try {
    const app = express();
    app.use(express.json());
    app.use("/api/reports", require("../src/routes/reports"));
    app.use("/api/incidents", require("../src/routes/incidents"));
    app.use("/api", require("../src/routes/community"));
    app.use((error, req, res, next) =>
      res.status(error.status || 500).json({ code: error.code }),
    );
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const routes = [
      [
        "/reports/1/evidence",
        { adjuntosIds: ["fixture-private-evidence"] },
        200,
        "attachment.updateMany",
      ],
      [
        "/incidents/2/chat",
        { mensaje: "Mensaje local" },
        201,
        "chatMessage.create",
      ],
      ["/recompensas/1/canjear", {}, 201, "redemption.create"],
    ];
    for (const [route, body, success, mutation] of routes) {
      for (const [label, user, code] of [
        [
          "correo revocado",
          { ...authenticated, correoVerificado: false },
          "EMAIL_REQUIRED",
        ],
        [
          "cuenta bloqueada",
          { ...authenticated, bloqueado: true },
          "ACCOUNT_BLOCKED",
        ],
        ["cuenta eliminada", null, "ACCOUNT_BLOCKED"],
        ["cuenta autorizada", { ...authenticated }, null],
      ]) {
        await t.test(`${route}: ${label}`, async () => {
          transactionUser = user;
          mutations = [];
          const response = await fetch(
            `http://127.0.0.1:${server.address().port}/api${route}`,
            {
              method: "POST",
              headers: {
                Cookie: "civigo_session=" + "a".repeat(64),
                "Content-Type": "application/json",
                Connection: "close",
              },
              body: JSON.stringify(body),
            },
          );
          const result = await response.json();
          assert.equal(
            response.status,
            code ? 403 : success,
            JSON.stringify(result),
          );
          if (code) {
            assert.equal(result.code, code);
            assert.deepEqual(mutations, []);
          } else assert.ok(mutations.includes(mutation));
        });
      }
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousPrisma === undefined) delete globalThis.__civigoPrisma;
    else globalThis.__civigoPrisma = previousPrisma;
  }
});

test("El acceso de una cuenta bloqueada permite consulta, apelación y salida sin modificar su perfil", async () => {
  const { auth } = require("../src/lib/auth");
  for (const [method, path, allowed] of [
    ["GET", "/api/users/me", true],
    ["HEAD", "/api/users/me", true],
    ["GET", "/api/reports/mine/?page=1", true],
    ["GET", "/api/reports", true],
    ["POST", "/api/reports/1/appeal", true],
    ["POST", "/api/users/logout/", true],
    ["PATCH", "/api/users/me", false],
    ["POST", "/api/reports", false],
    ["POST", "/api/incidents/1/chat", false],
    ["GET", "/api/admin", false],
  ]) {
    const error = await new Promise((resolve) =>
      auth(
        {
          authLoaded: true,
          user: { id: 1, bloqueado: true, correoVerificado: true },
          method,
          originalUrl: path,
        },
        {},
        resolve,
      ),
    );
    assert.equal(error?.status, allowed ? undefined : 403, `${method} ${path}`);
    if (!allowed) assert.equal(error.code, "ACCOUNT_BLOCKED");
  }
});
