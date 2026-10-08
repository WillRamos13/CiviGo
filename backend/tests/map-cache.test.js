const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { HttpError } = require("../src/lib/http");

function loadRouters(state) {
  // Only the real route handlers and HTTP middleware run. These delegates
  // cannot contact a database, read .env, or call an external provider.
  const overrides = {
    "../src/lib/db": {
      incident: {
        findMany: async ({ where }) => {
          if (state.databaseError)
            throw new HttpError(503, "Base no disponible.");
          assert.equal(where.publicado, true);
          assert.ok(where.AND?.length, "Se conserva la elegibilidad pública.");
          return where.estado === "RESUELTO"
            ? []
            : state.incidents.map((incident) => ({
                ...incident,
                reportes: [],
              }));
        },
        findUnique: async () => null,
      },
      session: {
        findUnique: async () => {
          throw new Error(
            "La prueba pública no necesita sesiones ni una base.",
          );
        },
      },
    },
    "../src/lib/catalog": { config: async () => ({}) },
    "../src/lib/projections": {
      incident: (value) => ({ id: value.id, estado: value.estado }),
      publicUser: (value) => value,
    },
    "../src/lib/roads": {
      getRoads: () => {
        if (state.roadError)
          throw new HttpError(503, "Vías no disponibles.", "ROADS_UNAVAILABLE");
        return { actualizadoEn: "2026-10-07", atribucion: "Fixture local" };
      },
      coveredSegments: () => [],
    },
    "../src/lib/risk": {
      ageWeight: () => 1,
      scoreSegments: (roads, incidents) => [
        {
          id: "fixture-road",
          nombre: "Tramo de prueba",
          points: incidents.length,
          level: incidents.length,
          pending: false,
          coordinates: [
            [-75.7286, -14.0678],
            [-75.7287, -14.0679],
          ],
        },
      ],
    },
  };
  const saved = [];
  const paths = ["../src/routes/incidents", "../src/routes/navigation"];
  try {
    for (const request of paths) {
      const id = require.resolve(request);
      saved.push([id, require.cache[id]]);
      delete require.cache[id];
    }
    for (const [request, exports] of Object.entries(overrides)) {
      const id = require.resolve(request);
      saved.push([id, require.cache[id]]);
      require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    return paths.map((request) => require(request));
  } finally {
    for (const [id, previous] of saved.reverse()) {
      if (previous) require.cache[id] = previous;
      else delete require.cache[id];
    }
  }
}

test("El mapa sirve cambios sin caché y conserva no-store también en errores", async (t) => {
  const state = {
    incidents: [{ id: 1, estado: "ACTIVO", fechaCreacion: new Date() }],
    databaseError: false,
    roadError: false,
  };
  const [incidents, navigation] = loadRouters(state);
  const app = express();
  app.use(express.json());
  app.use("/api/incidents", incidents);
  app.use("/api/navigation", navigation);
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
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (path, options = {}) =>
    fetch(base + path, {
      ...options,
      headers: { Connection: "close", ...options.headers },
    });
  try {
    await t.test(
      "La lista pública devuelve el nuevo incidente sin reusar la respuesta anterior",
      async () => {
        const before = await request("/api/incidents");
        assert.equal(before.status, 200);
        assert.equal(before.headers.get("cache-control"), "no-store");
        assert.deepEqual(await before.json(), [{ id: 1, estado: "ACTIVO" }]);
        state.incidents.push({
          id: 2,
          estado: "ACTIVO",
          fechaCreacion: new Date(),
        });
        const after = await request("/api/incidents", {
          headers: { "If-None-Match": before.headers.get("etag") },
        });
        assert.equal(after.status, 200);
        assert.equal(after.headers.get("cache-control"), "no-store");
        assert.equal((await after.json()).length, 2);
      },
    );
    await t.test(
      "La capa vial vuelve a calcular puntos y declara no-store",
      async () => {
        const before = await request("/api/navigation/roads");
        assert.equal(before.status, 200);
        assert.equal(before.headers.get("cache-control"), "no-store");
        assert.equal((await before.json()).features[0].properties.puntos, 2);
        state.incidents.pop();
        const after = await request("/api/navigation/roads", {
          headers: { "If-None-Match": before.headers.get("etag") },
        });
        assert.equal(after.status, 200);
        assert.equal(after.headers.get("cache-control"), "no-store");
        assert.equal((await after.json()).features[0].properties.puntos, 1);
      },
    );
    await t.test(
      "Errores de autorización y ausencia de incidente conservan su estado y no-store",
      async () => {
        const missing = await request("/api/incidents/999");
        assert.equal(missing.status, 404);
        assert.equal(missing.headers.get("cache-control"), "no-store");
        const anonymous = await request("/api/incidents/1/confirmar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        assert.equal(anonymous.status, 401);
        assert.equal(anonymous.headers.get("cache-control"), "no-store");
      },
    );
    await t.test(
      "Fallos de base o vías nunca quedan almacenados como datos del mapa",
      async () => {
        state.databaseError = true;
        const failed = await request("/api/incidents");
        assert.equal(failed.status, 503);
        assert.equal(failed.headers.get("cache-control"), "no-store");
        state.databaseError = false;
        state.roadError = true;
        const roads = await request("/api/navigation/roads");
        assert.equal(roads.status, 503);
        assert.equal(roads.headers.get("cache-control"), "no-store");
        assert.equal((await roads.json()).code, "ROADS_UNAVAILABLE");
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
