const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) &&
    process.env.ALLOW_REMOTE_TESTS !== "true"
  )
    throw new Error("Base remota de prueba no autorizada.");
  url.searchParams.set("pgbouncer", "true");
  url.searchParams.set("statement_cache_size", "0");
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = "test";
  process.env.DEMO_VERIFICATION = "true";
  process.env.UPLOAD_DIR = path.join(__dirname, "../.test-uploads");
  delete process.env.AI_API_KEY;
}
test(
  "Los aportes validados conservan gravedad y premios, y las pruebas públicas o posteriores se premian una sola vez",
  { skip: !connection },
  async () => {
    const prisma = require("../src/lib/db"),
      app = require("../src/server");
    const { hashPassword } = require("../src/lib/password"),
      { createSession } = require("../src/lib/auth");
    const run = "reward_" + crypto.randomBytes(6).toString("hex");
    let server, incidentId;
    const ids = [];
    const fileIds = [];
    try {
      let tipo = await prisma.incidentType.findUnique({
        where: { slug: "persona-sospechosa" },
      });
      if (!tipo) {
        await require("../src/lib/catalog").seedCatalog();
        tipo = await prisma.incidentType.findUnique({
          where: { slug: "persona-sospechosa" },
        });
      }
      const values = [];
      for (let n = 0; n < 5; n++)
        values.push({
          nombreUsuario: run + "_" + n,
          nombres: "Ensayo",
          apellidos: "Recompensas",
          correo: run + "_" + n + "@tests.civigo.local",
          telefono: "+519" + crypto.randomInt(10000000, 99999999),
          password: await hashPassword(
            crypto.randomBytes(24).toString("base64url"),
          ),
          telefonoVerificado: true,
        });
      await prisma.user.createMany({ data: values });
      const users = await prisma.user.findMany({
        where: { nombreUsuario: { startsWith: run } },
        orderBy: { nombreUsuario: "asc" },
      });
      ids.push(...users.map((u) => u.id));
      const p = { latitud: -14.0685, longitud: -75.7295 };
      const incident = await prisma.incident.create({
        data: {
          tipo: tipo.nombre,
          tipoId: tipo.id,
          descripcion: "Escenario aislado de regresión; no es un hecho real.",
          ...p,
          distrito: "Ica",
          nivelRiesgo: 4,
          estado: "VALIDADO",
          publicado: true,
          evaluacion: "AGENTE",
          validacion: 1,
          totalReportes: 4,
          emergencia: true,
        },
      });
      incidentId = incident.id;
      await prisma.report.createMany({
        data: users.slice(0, 4).map((u, n) => ({
          usuarioId: u.id,
          tipo: tipo.nombre,
          tipoId: tipo.id,
          descripcion: "Aporte de ensayo",
          ...p,
          incidenteId: incident.id,
          estado: "VALIDADO",
          fechaCreacion: new Date(Date.now() - (4 - n) * 1000),
        })),
      });
      const reports = await prisma.report.findMany({
        where: { incidenteId: incident.id },
        orderBy: { fechaCreacion: "asc" },
      });
      await prisma.attachment.createMany({
        data: [
          {
            id: crypto.randomUUID(),
            usuarioId: users[0].id,
            reporteId: reports[0].id,
            nombre: "foto-publica.png",
            mimeType: "image/png",
            size: 8,
            path: path.join(process.env.UPLOAD_DIR, "fixture-public-photo"),
            tipo: "PUBLICO",
            privado: false,
          },
          {
            id: crypto.randomUUID(),
            usuarioId: users[1].id,
            reporteId: reports[1].id,
            nombre: "identidad.pdf",
            mimeType: "application/pdf",
            size: 8,
            path: path.join(process.env.UPLOAD_DIR, "fixture-private-identity"),
            tipo: "IDENTIDAD",
            privado: true,
          },
        ],
      });
      await prisma.pointEvent.createMany({
        data: reports.map((r, n) => ({
          usuarioId: r.usuarioId,
          clave: "reporte:" + r.id,
          tipo: "REPORTE_VALIDADO",
          puntos: [10, 7.5, 5, 0][n],
        })),
      });
      await prisma.vote.createMany({
        data: users.slice(1, 4).map((u) => ({
          usuarioId: u.id,
          incidenteId: incident.id,
          tipo: "CONFIRMAR",
          ...p,
        })),
      });
      const votes = await prisma.vote.findMany({
        where: { incidenteId: incident.id },
      });
      await prisma.pointEvent.createMany({
        data: votes.map((v) => ({
          usuarioId: v.usuarioId,
          clave: "confirmacion:" + v.id,
          tipo: "CONFIRMACION_VALIDADA",
          puntos: 2,
        })),
      });
      let cookie;
      await createSession(users[4], {
        cookie(name, value) {
          cookie = name + "=" + value;
        },
      });
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const response = await fetch(
        "http://127.0.0.1:" + server.address().port + "/api/reports",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({
            tipo: tipo.slug,
            descripcion: "Nuevo aporte técnico de prueba",
            ...p,
            gpsLatitud: p.latitud,
            gpsLongitud: p.longitud,
          }),
          signal: AbortSignal.timeout(70000),
        },
      );
      const result = await response.json();
      assert.equal(response.status, 201, JSON.stringify(result));
      assert.equal(result.incidente.id, incident.id);
      assert.equal(result.incidente.nivelRiesgo, 4);
      const original = await prisma.pointEvent.findMany({
        where: { clave: { in: reports.map((r) => "reporte:" + r.id) } },
        orderBy: { id: "asc" },
      });
      assert.deepEqual(
        original.map((p) => p.puntos),
        [10, 7.5, 5, 0],
      );
      assert.equal(
        await prisma.report.count({ where: { incidenteId: incident.id } }),
        5,
      );
      assert.equal(
        await prisma.pointEvent.count({
          where: {
            usuarioId: users[4].id,
            tipo: "REPORTE_VALIDADO",
            puntos: 0,
          },
        }),
        1,
      );
      assert.equal(
        (
          await prisma.pointEvent.findUnique({
            where: { clave: "prueba:" + reports[0].id },
          })
        ).puntos,
        3,
      );
      assert.equal(
        await prisma.pointEvent.findUnique({
          where: { clave: "prueba:" + reports[1].id },
        }),
        null,
      );
      const form = new FormData();
      form.append(
        "archivo",
        new Blob(["%PDF-1.7\nPrueba tardía de un incidente validado"], {
          type: "application/pdf",
        }),
        "prueba.pdf",
      );
      form.append("privado", "true");
      form.append("tipo", "EVIDENCIA");
      const base = "http://127.0.0.1:" + server.address().port + "/api";
      const uploaded = await fetch(base + "/uploads", {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
      });
      const proof = await uploaded.json();
      assert.equal(uploaded.status, 201, JSON.stringify(proof));
      fileIds.push(proof.id);
      async function attach() {
        return fetch(base + "/reports/" + result.reporte.id + "/evidence", {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ adjuntosIds: [proof.id] }),
        });
      }
      const attached = await attach();
      assert.equal(attached.status, 200, JSON.stringify(await attached.json()));
      assert.equal(
        (
          await prisma.pointEvent.findUnique({
            where: { clave: "prueba:" + result.reporte.id },
          })
        ).puntos,
        3,
      );
      assert.equal((await attach()).status, 400);
      assert.equal(
        await prisma.pointEvent.count({
          where: { usuarioId: users[4].id, tipo: "PRUEBA_VALIDADA" },
        }),
        1,
      );
    } finally {
      try {
        await prisma.notification.deleteMany({
          where: {
            OR: [
              { usuarioId: { in: ids } },
              ...(incidentId ? [{ incidenteId: incidentId }] : []),
            ],
          },
        });
        await prisma.pointEvent.deleteMany({
          where: { usuarioId: { in: ids } },
        });
        await prisma.vote.deleteMany({ where: { usuarioId: { in: ids } } });
        await prisma.attachment.deleteMany({
          where: { usuarioId: { in: ids } },
        });
        await prisma.report.deleteMany({ where: { usuarioId: { in: ids } } });
        if (incidentId)
          await prisma.incident.deleteMany({ where: { id: incidentId } });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
        for (const filename of fileIds)
          await fs.promises
            .unlink(path.join(process.env.UPLOAD_DIR, filename))
            .catch(() => {});
      } finally {
        if (server) await new Promise((r) => server.close(r));
        await prisma.$disconnect();
      }
    }
  },
);
