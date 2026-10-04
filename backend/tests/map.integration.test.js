const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  require("./helpers/provider-environment").disableExternalProviders();
  const url = new URL(connection);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) &&
    process.env.ALLOW_REMOTE_TESTS !== "true"
  )
    throw new Error(
      "Las pruebas remotas requieren una base de prueba autorizada.",
    );
  url.searchParams.set("pgbouncer", "true");
  url.searchParams.set("statement_cache_size", "0");
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = "test";
  process.env.ENABLE_JOBS = "false";
}

test(
  "Los antecedentes masivos y registros caducados no ocultan incidentes activos del mapa",
  { skip: !connection },
  async () => {
    const prisma = require("../src/lib/db");
    const app = require("../src/server");
    const fuente = "fixture_map_" + crypto.randomBytes(8).toString("hex");
    let server;
    try {
      const now = new Date();
      const old = new Date(now);
      old.setUTCFullYear(old.getUTCFullYear() - 4);
      const base = {
        tipo: "Escenario de prueba automatizada",
        descripcion: "Fixture de mapa: no representa un hecho real.",
        latitud: -14.06777,
        longitud: -75.7286,
        distrito: "Ica",
        publicado: true,
        nivelRiesgo: 2,
        evaluacion: "AGENTE",
        validacion: 1,
        fuente,
      };
      const active = await prisma.incident.create({
        data: {
          ...base,
          estado: "ACTIVO",
          historico: false,
          fechaCreacion: new Date(+now - 86400000),
        },
      });
      const data = [];
      for (let n = 0; n < 501; n++) {
        data.push({
          ...base,
          estado: "RESUELTO",
          historico: true,
          fechaEvento: new Date(+now - 180 * 86400000),
        });
        data.push({
          ...base,
          estado: "RESUELTO",
          historico: true,
          fechaEvento: old,
        });
        data.push({ ...base, estado: "RESUELTO", historico: false });
      }
      await prisma.incident.createMany({ data });
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const response = await fetch(
        "http://127.0.0.1:" + server.address().port + "/api/incidents",
      );
      assert.equal(response.status, 200);
      const map = await response.json();
      assert.ok(
        map.some((i) => i.id === active.id),
        "El incidente activo debe permanecer disponible",
      );
      const ours = map.filter((i) => i.fuente === fuente);
      assert.equal(
        ours.filter((i) => i.estado === "RESUELTO" && i.historico).length,
        500,
      );
      assert.ok(ours.every((i) => i.estado !== "RESUELTO" || i.historico));
      assert.ok(
        ours.every((i) => !i.historico || +new Date(i.fechaEvento) > +old),
      );
      assert.ok(map.length <= 1000);
    } finally {
      try {
        await prisma.incident.deleteMany({ where: { fuente } });
      } finally {
        if (server) await new Promise((r) => server.close(r));
        await prisma.$disconnect();
      }
    }
  },
);

test(
  "La capa pública de riesgo usa la misma cobertura provincial que el planificador",
  { skip: !connection },
  async () => {
    const prisma = require("../src/lib/db");
    const app = require("../src/server");
    const { getRoads, coveredSegments } = require("../src/lib/roads");
    const roads = getRoads();
    const expected = new Set(coveredSegments(roads).map((s) => s.id));
    let server;
    try {
      server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/navigation/roads`,
      );
      assert.equal(response.status, 200);
      const layer = await response.json();
      assert.equal(layer.features.length, expected.size);
      assert.ok(layer.features.every((feature) => expected.has(feature.id)));
      assert.ok(
        layer.features.length < roads.segments.length,
        "Las vías de fuera no deben aparecer como tramos seguros",
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await prisma.$disconnect();
    }
  },
);
