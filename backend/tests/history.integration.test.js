"use strict";
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
      "Las pruebas históricas remotas requieren autorización de una base de prueba.",
    );
  url.searchParams.set("pgbouncer", "true");
  url.searchParams.set("statement_cache_size", "0");
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = "test";
  process.env.ENABLE_JOBS = "false";
}

test(
  "Importar 2000 históricos conserva referencias, IDs e idempotencia sin consultas por fila",
  { skip: !connection },
  async (t) => {
    const prisma = require("../src/lib/db");
    const { seedCatalog } = require("../src/lib/catalog");
    const { hashPassword } = require("../src/lib/password");
    const app = require("../src/server");
    const run = crypto.randomBytes(10).toString("hex");
    const fuente = "fixture_import_" + run;
    const password = crypto.randomBytes(24).toString("base64url");
    let usuarioId, server;
    let keys = [];
    try {
      await seedCatalog();
      const user = await prisma.user.create({
        data: {
          nombreUsuario: "history_" + run,
          nombres: "Prueba",
          apellidos: "Históricos",
          correo: run + "@tests.civigo.local",
          telefono: "+519" + crypto.randomInt(10000000, 99999999),
          password: await hashPassword(password),
          rol: "ADMIN",
          telefonoVerificado: false,
          correoVerificado: true,
        },
      });
      usuarioId = user.id;
      server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const login = await fetch(base + "/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo: user.correo, password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const body = {
        formato: "json",
        fuente,
        contenido: JSON.stringify(
          Array.from({ length: 2000 }, (_, index) => ({
            tipo: "robo",
            fechaEvento: "2025-10-01T12:30:00",
            latitud: -14.0678,
            longitud: -75.7286,
            nivelRiesgo: 4,
            descripcion: "Fixture automatizado, no representa un hecho real.",
            referencia: run + ":" + index,
          })),
        ),
      };
      const request = async (endpoint) => {
        const response = await fetch(base + "/history/import/" + endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify(body),
        });
        return { status: response.status, json: await response.json() };
      };
      const preview = await request("preview");
      assert.equal(preview.status, 200);
      assert.equal(preview.json.totalValidos, 2000);
      keys = preview.json.registros.map((row) => row.clave);
      const start = performance.now();
      const imported = await request("commit");
      assert.equal(imported.status, 201, JSON.stringify(imported.json));
      assert.equal(imported.json.importados, 2000);
      assert.equal(imported.json.duplicados, 0);
      t.diagnostic(
        `Lote de 2000 registros importado en ${(performance.now() - start).toFixed(0)} ms`,
      );
      const incidents = await prisma.incident.findMany({
        where: { fuente },
        select: { id: true, fechaEvento: true },
      });
      assert.equal(incidents.length, 2000);
      assert.equal(new Set(incidents.map((row) => row.id)).size, 2000);
      assert.ok(
        incidents.every(
          (row) => row.fechaEvento.toISOString() === "2025-10-01T17:30:00.000Z",
        ),
      );
      const incidentIds = new Set(incidents.map((row) => row.id));
      const references = await prisma.appConfig.findMany({
        where: { clave: { in: keys } },
      });
      assert.equal(references.length, 2000);
      assert.equal(
        new Set(references.map((row) => row.valor.incidenteId)).size,
        2000,
      );
      assert.ok(
        references.every(
          (row) =>
            incidentIds.has(row.valor.incidenteId) &&
            row.valor.importadoPor === usuarioId,
        ),
      );
      const repeated = await request("commit");
      assert.equal(repeated.status, 201);
      assert.equal(repeated.json.importados, 0);
      assert.equal(repeated.json.duplicados, 2000);
      assert.equal(await prisma.incident.count({ where: { fuente } }), 2000);
      const following = await prisma.incident.create({
        data: {
          tipo: "Fixture de secuencia",
          descripcion: "Prueba automatizada",
          latitud: -14.0678,
          longitud: -75.7286,
          fuente,
        },
      });
      assert.ok(
        following.id > Math.max(...incidentIds),
        "El siguiente ID automático debe avanzar sin colisionar con los importados",
      );
    } finally {
      try {
        await prisma.incident.deleteMany({ where: { fuente } });
        if (keys.length)
          await prisma.appConfig.deleteMany({ where: { clave: { in: keys } } });
        if (usuarioId) {
          await prisma.auditLog.deleteMany({ where: { usuarioId } });
          await prisma.user.delete({ where: { id: usuarioId } });
        }
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await prisma.$disconnect();
      }
    }
  },
);
