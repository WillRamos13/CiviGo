const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const {
  announcementData,
  safeLink,
  scheduledDate,
  trafficModerationData,
} = require("../src/lib/announcements");
const fixture = {
  titulo: "Nueva función del mapa",
  mensaje: "Consulta los avisos viales.",
  tipo: "NOVEDAD",
};

test("anuncios validan texto, enlaces, orden y programación inequívoca", () => {
  const result = announcementData({
    ...fixture,
    inicio: "2026-10-08T08:00:00-05:00",
    fin: "2026-10-09T08:00:00-05:00",
    enlace: "/mapa",
  });
  assert.equal(result.inicio.toISOString(), "2026-10-08T13:00:00.000Z");
  assert.equal(result.enlace, "/mapa");
  assert.equal(result.negocioId, null);
  for (const patch of [
    { titulo: "<script>alert(1)</script>" },
    { activo: "true" },
    { orden: -1 },
    { orden: 1.5 },
    { tipo: "OTRO" },
    { tipo: "NEGOCIO", negocioId: null },
    { enlace: "javascript:alert(1)" },
    { inicio: "2026-10-08T13:00" },
    { inicio: "2026-02-30T13:00:00Z" },
    { inicio: "2026-10-08T13:00:00Z", fin: "2026-10-08T12:00:00Z" },
  ])
    assert.throws(() => announcementData({ ...fixture, ...patch }), {
      status: 400,
    });
  for (const unsafe of [
    "//evil.test",
    "http://example.test",
    "https://a:b@example.test",
    "https://example.test/\\evil",
    "/admin",
    "/mapa?next=evil",
    "data:text/html,hi",
  ])
    assert.throws(() => safeLink(unsafe));
  assert.equal(
    safeLink("https://example.test/novedad"),
    "https://example.test/novedad",
  );
  assert.equal(scheduledDate(null), null);
  const advert = announcementData({
    ...fixture,
    tipo: "NEGOCIO",
    negocioId: 10,
    enlace: "https://example.test",
  });
  assert.equal(advert.negocioId, 10);
  assert.equal(advert.enlace, null);
  const switched = announcementData({ tipo: "NOVEDAD" }, advert);
  assert.equal(switched.negocioId, null);
});

test("la moderación requiere motivo y guarda solo un snapshot público limitado", () => {
  assert.throws(
    () =>
      trafficModerationData({ externoId: "1", oculto: true, motivo: "corto" }),
    { status: 400 },
  );
  const result = trafficModerationData({
    externoId: "TT_123",
    oculto: true,
    motivo: "La vía ya está habilitada.",
    datos: {
      titulo: "Cierre",
      tipo: "ROAD_CLOSED",
      latitud: -14.06,
      longitud: -75.72,
      apiKey: "never-store",
      usuario: "private",
      geometria: [],
    },
  });
  assert.deepEqual(result.datos, {
    titulo: "Cierre",
    tipo: "ROAD_CLOSED",
    latitud: -14.06,
    longitud: -75.72,
  });
  assert.equal(result.proveedor, "TOMTOM");
});

function loadRouter(state) {
  const businesses = [
    { id: 10, nombre: "Comercio", activo: true },
    { id: 11, nombre: "Inactivo", activo: false },
  ];
  let sequence = 0;
  const clone = (row) => ({
    ...row,
    negocio: businesses.find((b) => b.id === row.negocioId) ?? null,
  });
  const db = {
    mapAnnouncement: {
      findMany: async ({ where }) => {
        let rows = state.rows;
        if (where) {
          const now = where.AND[0].OR[1].inicio.lte;
          assert.equal(where.activo, true);
          assert.ok(where.AND[1].OR[1].fin.gt instanceof Date);
          const hideAds = where.AND[2].tipo === "NOVEDAD";
          rows = rows.filter(
            (row) =>
              row.activo &&
              (!row.inicio || row.inicio <= now) &&
              (!row.fin || row.fin > now) &&
              (row.tipo === "NOVEDAD" ||
                (!hideAds &&
                  businesses.find((b) => b.id === row.negocioId)?.activo)),
          );
        }
        return rows
          .slice()
          .sort((a, b) => a.orden - b.orden || a.id - b.id)
          .map(clone);
      },
      findUnique: async ({ where }) =>
        state.rows.find((row) => row.id === where.id) ?? null,
      create: async ({ data }) => {
        const row = { id: ++sequence, ...data };
        state.rows.push(row);
        return clone(row);
      },
      update: async ({ where, data }) => {
        const row = state.rows.find((row) => row.id === where.id);
        Object.assign(row, data);
        return clone(row);
      },
      delete: async ({ where }) => {
        state.rows = state.rows.filter((row) => row.id !== where.id);
      },
    },
    business: {
      findUnique: async ({ where }) =>
        businesses.find((row) => row.id === where.id) ?? null,
    },
    auditLog: {
      create: async ({ data }) => {
        state.audit.push(data);
        return data;
      },
    },
    externalTrafficModeration: {
      findMany: async () => state.moderation,
      upsert: async ({ where, create, update }) => {
        let row = state.moderation.find(
          (row) => row.externoId === where.proveedor_externoId.externoId,
        );
        if (row) Object.assign(row, update);
        else {
          row = { id: 1, ...create };
          state.moderation.push(row);
        }
        return row;
      },
    },
    $transaction: async (callback) => callback(db),
  };
  const setUser = (req, res, next) => {
    req.user = req.headers["x-role"]
      ? {
          id: 1,
          rol: req.headers["x-role"],
          premium: req.headers["x-premium"] === "yes",
          ocultarAnuncios: req.headers["x-hide"] === "yes",
        }
      : null;
    next();
  };
  const auth = (req, res, next) =>
    setUser(req, res, () =>
      req.user ? next() : res.status(401).json({ error: "Inicia sesión." }),
    );
  const overrides = {
    "../src/lib/db": db,
    "../src/lib/auth": { auth, optionalAuth: setUser },
  };
  const saved = [];
  const routeId = require.resolve("../src/routes/announcements");
  try {
    saved.push([routeId, require.cache[routeId]]);
    delete require.cache[routeId];
    for (const [name, exports] of Object.entries(overrides)) {
      const id = require.resolve(name);
      saved.push([id, require.cache[id]]);
      require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    return require(routeId);
  } finally {
    for (const [id, previous] of saved.reverse()) {
      if (previous) require.cache[id] = previous;
      else delete require.cache[id];
    }
  }
}

test("API de anuncios publica solo vigentes, protege CRUD y audita moderación", async (t) => {
  const state = { rows: [], audit: [], moderation: [] };
  const app = express();
  app.use(express.json());
  app.use("/api/announcements", loadRouter(state));
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/announcements`;
  const request = (path, method = "GET", body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: {
        Connection: "close",
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const admin = { "x-role": "ADMIN" };
  try {
    await t.test(
      "anónimos y usuarios no pueden gestionar ni ocultar avisos",
      async () => {
        assert.equal((await request("/manage")).status, 401);
        assert.equal(
          (await request("/manage", "POST", fixture, { "x-role": "USUARIO" }))
            .status,
          403,
        );
        assert.equal(
          (
            await request(
              "/traffic-moderation",
              "POST",
              {},
              { "x-role": "AGENTE" },
            )
          ).status,
          403,
        );
      },
    );
    await t.test("crear, editar, ordenar y programación pública", async () => {
      const create = await request("/manage", "POST", fixture, admin);
      assert.equal(create.status, 201);
      const news = await create.json();
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            {
              ...fixture,
              titulo: "Comercio",
              tipo: "NEGOCIO",
              negocioId: 10,
              orden: 1,
            },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            {
              ...fixture,
              titulo: "Negocio inactivo",
              tipo: "NEGOCIO",
              negocioId: 11,
            },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            {
              ...fixture,
              titulo: "Anuncio futuro",
              inicio: "2099-10-08T13:00:00Z",
            },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            {
              ...fixture,
              titulo: "Anuncio expirado",
              fin: "2020-10-08T13:00:00Z",
            },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (await request("/manage", "POST", { ...fixture, activo: false }, admin))
          .status,
        201,
      );
      const publicList = await request("/");
      assert.equal(publicList.headers.get("cache-control"), "no-store");
      assert.deepEqual(
        (await publicList.json()).map((row) => row.titulo),
        [fixture.titulo, "Comercio"],
      );
      const premium = await request("/", "GET", null, {
        "x-role": "USUARIO",
        "x-premium": "yes",
        "x-hide": "yes",
      });
      assert.deepEqual(
        (await premium.json()).map((row) => row.tipo),
        ["NOVEDAD"],
      );
      const ordinary = await request("/", "GET", null, {
        "x-role": "USUARIO",
        "x-hide": "yes",
      });
      assert.equal((await ordinary.json()).length, 2);
      assert.equal(
        (
          await request(
            `/manage/${news.id}`,
            "PATCH",
            { orden: 2, titulo: "Título editado" },
            admin,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            { ...fixture, tipo: "NEGOCIO", negocioId: 999 },
            admin,
          )
        ).status,
        400,
      );
      assert.equal(
        (await request(`/manage/${news.id}`, "DELETE", null, admin)).status,
        200,
      );
      assert.equal(
        (await request(`/manage/${news.id}`, "PATCH", fixture, admin)).status,
        404,
      );
      assert.ok(
        state.audit.some(
          (row) => row.accion === "ELIMINAR" && row.entidad === "ANUNCIO_MAPA",
        ),
      );
    });
    await t.test(
      "ocultar y restaurar conserva motivo y fuente sin crear incidentes ciudadanos",
      async () => {
        const payload = {
          externoId: "tt_123",
          oculto: true,
          motivo: "Aviso incorrecto comprobado en la vía.",
          datos: { titulo: "Accidente" },
        };
        assert.equal(
          (await request("/traffic-moderation", "POST", payload, admin)).status,
          200,
        );
        assert.equal(state.moderation[0].oculto, true);
        assert.equal(
          (
            await request(
              "/traffic-moderation",
              "POST",
              {
                ...payload,
                oculto: false,
                datos: undefined,
                motivo: "La información externa volvió a ser vigente.",
              },
              admin,
            )
          ).status,
          200,
        );
        assert.equal(state.moderation[0].oculto, false);
        assert.equal(state.moderation[0].datos.titulo, "Accidente");
        assert.equal(state.moderation.length, 1);
        assert.deepEqual(
          state.audit
            .filter((row) => row.entidad === "AVISO_TOMTOM")
            .map((row) => row.accion),
          ["OCULTAR", "RESTAURAR"],
        );
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("migración local conserva relación de negocios y valida horarios y cuota", async () => {
  const { PGlite } = require("@electric-sql/pglite");
  const fs = require("node:fs");
  const path = require("node:path");
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE TABLE "Business" ("id" INTEGER PRIMARY KEY); INSERT INTO "Business" VALUES (1);',
    );
    await db.exec(
      fs.readFileSync(
        path.join(
          __dirname,
          "../prisma/migrations/20261008000100_map_announcements_and_traffic/migration.sql",
        ),
        "utf8",
      ),
    );
    await db.exec(
      `INSERT INTO "MapAnnouncement" ("tipo", "titulo", "negocioId", "actualizadoEn") VALUES ('NEGOCIO', 'Publicidad', 1, NOW());`,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "MapAnnouncement" ("tipo", "titulo", "actualizadoEn") VALUES ('NEGOCIO', 'Inválido', NOW());`,
      ),
      /negocio_check/,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "MapAnnouncement" ("titulo", "inicio", "fin", "actualizadoEn") VALUES ('Fechas', '2026-10-09', '2026-10-08', NOW());`,
      ),
      /fechas_check/,
    );
    await db.exec(
      `INSERT INTO "ExternalApiUsage" ("proveedor", "producto", "mes", "actualizadoEn") VALUES ('TOMTOM', 'routing', '2026-10', NOW());`,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "ExternalApiUsage" ("proveedor", "producto", "mes", "actualizadoEn") VALUES ('TOMTOM', 'routing', '2026-10', NOW());`,
      ),
      /unique constraint/,
    );
    await assert.rejects(
      db.exec(`UPDATE "ExternalApiUsage" SET "usadas" = -1;`),
      /usadas_check/,
    );
    await db.exec('DELETE FROM "Business" WHERE "id" = 1;');
    assert.equal(
      (await db.query('SELECT * FROM "MapAnnouncement"')).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
