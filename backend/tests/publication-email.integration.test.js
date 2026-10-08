const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error(
      "La prueba de publicación requiere una base local aislada.",
    );
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
  process.env.ENABLE_JOBS = "false";
  delete process.env.TRUST_PROXY;
}

test(
  "Publicación: exige autores verificados y conserva históricos administrativos",
  { skip: !connection },
  async (t) => {
    const prisma = require("../src/lib/db");
    const { hashToken } = require("../src/lib/auth");
    const { seedCatalog } = require("../src/lib/catalog");
    const providers = require("../src/lib/providers");
    let evaluated = async () => {};
    t.mock.method(providers, "evaluateReport", async () => {
      await evaluated();
      return null;
    });
    const risk = require("../src/lib/risk");
    const scoreSegments = risk.scoreSegments;
    let navigationIncidents;
    t.mock.method(risk, "scoreSegments", (segments, rows, ...args) => {
      navigationIncidents = rows;
      return scoreSegments(segments, rows, ...args);
    });
    const app = require("../src/server");
    const users = [],
      incidents = [],
      settlements = [];
    const run = crypto.randomBytes(6).toString("hex");
    const point = { latitud: -14.06777, longitud: -75.7286 };
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, user, body) {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(user ? { Cookie: user.cookie } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    }
    async function actor(label, verified, rol = "USUARIO") {
      const user = await prisma.user.create({
        data: {
          nombreUsuario: run + label,
          nombres: "Prueba",
          apellidos: "Publicación",
          correo: run + label + "@gmail.com",
          telefono: "+519" + crypto.randomInt(10000000, 99999999),
          password: "scrypt$fixture_sin_login",
          rol,
          correoVerificado: verified,
          telefonoVerificado: !verified,
        },
      });
      users.push(user.id);
      const token = crypto.randomBytes(32).toString("hex");
      await prisma.session.create({
        data: {
          id: hashToken(token),
          usuarioId: user.id,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return { ...user, cookie: "civigo_session=" + token };
    }
    async function incident(data = {}) {
      const row = await prisma.incident.create({
        data: {
          tipo: "Fixture publicación",
          ...point,
          ...data,
        },
      });
      incidents.push(row.id);
      return row;
    }
    async function report(row, user, estado = "PENDIENTE") {
      return prisma.report.create({
        data: {
          incidenteId: row.id,
          usuarioId: user.id,
          tipo: row.tipo,
          descripcion: "Reporte de prueba",
          ...point,
          estado,
        },
      });
    }
    try {
      await seedCatalog();
      const admin = await actor("admin", true, "ADMIN");
      const verified = await actor("verified", true);
      const unverified = await actor("unverified", false);
      const review = (row, accion = "VALIDAR") =>
        request(`/admin/incidents/${row.id}/review`, admin, {
          accion,
          nivelRiesgo: 2,
          motivo: "Revisión de publicación en entorno aislado.",
        });
      await t.test(
        "La autorización se comprueba otra vez después de esperar la IA",
        async () => {
          const actorAfterAI = await actor("race", true);
          evaluated = () =>
            prisma.user.update({
              where: { id: actorAfterAI.id },
              data: { correoVerificado: false },
            });
          const response = await request("/reports", actorAfterAI, {
            tipo: "persona-desaparecida",
            descripcion: "",
            ...point,
          });
          evaluated = async () => {};
          assert.equal(response.status, 403, JSON.stringify(response.json));
          assert.equal(response.json.code, "EMAIL_REQUIRED");
          assert.equal(
            await prisma.report.count({
              where: { usuarioId: actorAfterAI.id },
            }),
            0,
          );
        },
      );
      await t.test(
        "VALIDAR y REABRIR no publican aportes legados sin correo verificado",
        async () => {
          const pending = await incident({ evaluacion: "IA", nivelRiesgo: 2 });
          await report(pending, unverified);
          const denied = await review(pending);
          assert.equal(denied.status, 409, JSON.stringify(denied.json));
          assert.equal(denied.json.code, "REPORT_EMAIL_REQUIRED");
          const saved = await prisma.incident.findUnique({
            where: { id: pending.id },
          });
          assert.equal(saved.publicado, false);
          assert.equal(saved.estado, "PENDIENTE");
          assert.equal(saved.evaluacion, "IA");
          const closed = await incident({ estado: "RESUELTO", validacion: 1 });
          await report(closed, unverified);
          assert.equal((await review(closed, "REABRIR")).status, 409);
          await prisma.user.update({
            where: { id: unverified.id },
            data: { correoVerificado: true },
          });
          assert.equal(
            (await prisma.incident.findUnique({ where: { id: pending.id } }))
              .publicado,
            false,
          );
          assert.equal((await review(pending)).status, 200);
          assert.equal(
            (await prisma.incident.findUnique({ where: { id: pending.id } }))
              .publicado,
            true,
          );
          await prisma.user.update({
            where: { id: unverified.id },
            data: { correoVerificado: false },
          });
        },
      );
      await t.test(
        "Mapa y lectura pública excluyen legados sin autor verificado sin borrar el registro",
        async () => {
          const legacy = await incident({
            publicado: true,
            estado: "ACTIVO",
            fechaPublicacion: new Date(),
          });
          await report(legacy, unverified);
          const list = await request("/incidents");
          assert.equal(list.status, 200);
          assert.equal(
            list.json.some((row) => row.id === legacy.id),
            false,
          );
          assert.equal((await request(`/incidents/${legacy.id}`)).status, 404);
          assert.equal(
            (await request(`/incidents/${legacy.id}`, unverified)).status,
            200,
          );
          assert.equal(
            (await request(`/incidents/${legacy.id}/chat`, verified)).status,
            404,
          );
          assert.equal(
            (
              await request(
                `/incidents/${legacy.id}/confirmar`,
                verified,
                point,
              )
            ).status,
            404,
          );
          assert.equal(
            (await prisma.incident.findUnique({ where: { id: legacy.id } }))
              .publicado,
            true,
          );
        },
      );
      await t.test(
        "Los históricos y registros OSM administrativos sin reportes mantienen publicación y revisión",
        async () => {
          const imported = await incident({
            fuente: "OSM",
            historico: true,
            estado: "RESUELTO",
            publicado: true,
            validacion: 1,
          });
          const list = await request("/incidents");
          assert.equal(
            list.json.some((row) => row.id === imported.id),
            true,
          );
          assert.equal(
            (await request(`/incidents/${imported.id}`)).status,
            200,
          );
          assert.equal((await review(imported, "REABRIR")).status, 200);
          assert.equal((await review(imported)).status, 200);
        },
      );
      await t.test(
        "Una agrupación válida no valida ni recompensa aportes de autores sin verificar",
        async () => {
          const grouped = await incident();
          const invalid = await report(grouped, unverified);
          const valid = await report(grouped, verified);
          assert.equal((await review(grouped)).status, 200);
          assert.equal(
            (await prisma.report.findUnique({ where: { id: invalid.id } }))
              .estado,
            "PENDIENTE",
          );
          assert.equal(
            (await prisma.report.findUnique({ where: { id: valid.id } }))
              .estado,
            "VALIDADO",
          );
          assert.equal(
            await prisma.pointEvent.count({
              where: { clave: "reporte:" + invalid.id },
            }),
            0,
          );
          assert.equal(
            await prisma.pointEvent.count({
              where: { clave: "reporte:" + valid.id },
            }),
            1,
          );
        },
      );
      await t.test(
        "Los votos legados no verificados no confirman ni resuelven, y una confirmación de agente prevalece",
        async () => {
          const voters = [unverified];
          for (let n = 0; n < 3; n++)
            voters.push(await actor("legacy_voter" + n, false));
          const participant = await actor("participant", true);
          const row = await incident({
            publicado: true,
            estado: "VALIDADO",
            evaluacion: "IA",
            validacion: 1,
          });
          await report(row, verified);
          await prisma.vote.createMany({
            data: [
              ...voters.slice(0, 2).map((u) => ({
                usuarioId: u.id,
                incidenteId: row.id,
                tipo: "CONFIRMAR",
                ...point,
              })),
              ...voters.map((u) => ({
                usuarioId: u.id,
                incidenteId: row.id,
                tipo: "RESOLVER",
                ...point,
              })),
            ],
          });
          const before = await request(`/incidents/${row.id}`);
          assert.equal(before.json.confirmaciones, 0);
          assert.equal(before.json.resoluciones, 0);
          const confirmed = await request(
            `/incidents/${row.id}/confirmar`,
            participant,
            point,
          );
          assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
          assert.equal(confirmed.json.confirmaciones, 1);
          assert.equal(confirmed.json.estado, "ACTIVO");
          assert.ok(confirmed.json.validacion < 1);
          const resolved = await request(
            `/incidents/${row.id}/resolver`,
            participant,
            point,
          );
          assert.equal(resolved.status, 200, JSON.stringify(resolved.json));
          assert.equal(resolved.json.resoluciones, 1);
          assert.equal(resolved.json.estado, "ACTIVO");
          const agent = await request(
            `/incidents/${row.id}/confirmar`,
            admin,
            point,
          );
          assert.equal(agent.status, 200, JSON.stringify(agent.json));
          assert.equal(agent.json.validacion, 1);
          assert.equal(agent.json.evaluacion, "AGENTE");
          const later = await actor("later_voter", true);
          const afterAgent = await request(
            `/incidents/${row.id}/confirmar`,
            later,
            point,
          );
          assert.equal(afterAgent.json.validacion, 1);
          assert.equal(afterAgent.json.evaluacion, "AGENTE");
        },
      );
      await t.test(
        "La agrupación pública omite texto, archivos y pruebas de autores no verificados; administración conserva los aportes",
        async () => {
          const privateText = "LEGADO_NO_PUBLICAR_" + run;
          const mixed = await incident({
            descripcion: privateText,
            publicado: true,
            individual: true,
            estado: "ACTIVO",
            evaluacion: "IA",
            nivelRiesgo: 4,
            totalReportes: 2,
            validacion: 0.5,
            fechaPublicacion: new Date(Date.now() - 8 * 86400000),
          });
          const invalid = await report(mixed, unverified);
          const valid = await report(mixed, verified);
          await prisma.report.update({
            where: { id: invalid.id },
            data: { descripcion: privateText },
          });
          await prisma.report.update({
            where: { id: valid.id },
            data: { descripcion: "Aporte verificado público" },
          });
          const publicId = crypto.randomUUID();
          const privateId = crypto.randomUUID();
          const validId = crypto.randomUUID();
          await prisma.attachment.createMany({
            data: [
              {
                id: publicId,
                usuarioId: unverified.id,
                reporteId: invalid.id,
                tipo: "PUBLICO",
                privado: false,
              },
              {
                id: privateId,
                usuarioId: unverified.id,
                reporteId: invalid.id,
                tipo: "EVIDENCIA",
                privado: true,
              },
              {
                id: validId,
                usuarioId: verified.id,
                reporteId: valid.id,
                tipo: "PUBLICO",
                privado: false,
              },
            ].map((data) => ({
              ...data,
              nombre: data.id + ".jpg",
              mimeType: "image/jpeg",
              size: 8,
              path: "supabase://fixture-private-bucket/" + data.id,
            })),
          });
          const publicView = await request(`/incidents/${mixed.id}`);
          assert.equal(publicView.status, 200);
          assert.equal(publicView.json.totalReportes, 1);
          assert.equal(
            publicView.json.descripcion,
            "Aporte verificado público",
          );
          assert.deepEqual(
            publicView.json.reportes.map((r) => r.id),
            [valid.id],
          );
          assert.deepEqual(
            publicView.json.adjuntos.map((a) => a.id),
            [validId],
          );
          for (const hidden of [privateText, publicId, privateId])
            assert.equal(
              JSON.stringify(publicView.json).includes(hidden),
              false,
            );
          assert.equal(publicView.json.aportePuntos, 0);
          const administration = await request("/admin/incidents", admin);
          const adminView = administration.json.find(
            (row) => row.id === mixed.id,
          );
          assert.equal(adminView.totalReportes, 2);
          assert.equal(adminView.descripcion, privateText);
          assert.equal(adminView.reportes.length, 2);
          assert.equal(
            adminView.adjuntos.some((a) => a.id === privateId),
            true,
          );
          assert.equal(
            adminView.adjuntos.some((a) => a.id === publicId),
            true,
          );
          const roads = await request("/navigation/roads");
          assert.equal(
            roads.status,
            200,
            JSON.stringify(roads.json).slice(0, 300),
          );
          const scored = navigationIncidents.find((row) => row.id === mixed.id);
          assert.equal(scored.pruebasRecibidas, false);
          assert.equal(scored.reportes.length, 1);
          assert.equal(scored.reportes[0].adjuntos.length, 0);
          await prisma.attachment.create({
            data: {
              id: crypto.randomUUID(),
              usuarioId: verified.id,
              reporteId: valid.id,
              tipo: "EVIDENCIA",
              privado: true,
              nombre: "prueba-verificada.jpg",
              mimeType: "image/jpeg",
              size: 8,
              path: "supabase://fixture-private-bucket/verified-evidence",
            },
          });
          const confirmedEvidence = await request(`/incidents/${mixed.id}`);
          assert.ok(confirmedEvidence.json.aportePuntos > 0);
          assert.equal(
            confirmedEvidence.json.adjuntos.some((a) => a.tipo === "EVIDENCIA"),
            false,
          );
          await request("/navigation/roads");
          assert.equal(
            navigationIncidents.find((row) => row.id === mixed.id)
              .pruebasRecibidas,
            true,
          );
        },
      );
      await t.test(
        "La agrupación de un reporte nuevo tampoco utiliza confirmaciones de cuentas sin verificar",
        async () => {
          const type = await prisma.incidentType.findUnique({
            where: { slug: "persona-desaparecida" },
          });
          const author = await actor("group_author", true);
          const old = await actor("group_old_voter", false);
          const contributor = await actor("group_new", true);
          const row = await incident({
            tipo: type.nombre,
            tipoId: type.id,
            validacion: 1,
          });
          await report(row, author);
          await prisma.vote.createMany({
            data: [unverified, old].map((u) => ({
              usuarioId: u.id,
              incidenteId: row.id,
              tipo: "CONFIRMAR",
              ...point,
            })),
          });
          const response = await request("/reports", contributor, {
            tipo: type.slug,
            descripcion: "",
            ...point,
            gpsLatitud: point.latitud,
            gpsLongitud: point.longitud,
          });
          if (
            response.json.incidente &&
            !incidents.includes(response.json.incidente.id)
          )
            incidents.push(response.json.incidente.id);
          assert.equal(response.status, 201, JSON.stringify(response.json));
          assert.equal(response.json.incidente.id, row.id);
          assert.ok(response.json.incidente.validacion < 1);
          assert.equal(response.json.incidente.estado, "PENDIENTE");
          assert.equal(response.json.reporte.incidente.confirmaciones, 0);
          assert.equal(response.json.reporte.estado, "EN_REVISION");
          const active = await actor("group_active", true);
          const activeRow = await incident({
            tipo: type.nombre,
            tipoId: type.id,
            publicado: true,
            estado: "VALIDADO",
            evaluacion: "IA",
            validacion: 1,
            latitud: point.latitud + 0.005,
          });
          await report(activeRow, author);
          await prisma.vote.createMany({
            data: [unverified, old].map((u) => ({
              usuarioId: u.id,
              incidenteId: activeRow.id,
              tipo: "CONFIRMAR",
              ...point,
            })),
          });
          const resubmitted = await request("/reports", active, {
            tipo: type.slug,
            descripcion: "",
            latitud: activeRow.latitud,
            longitud: activeRow.longitud,
            gpsLatitud: activeRow.latitud,
            gpsLongitud: activeRow.longitud,
          });
          if (
            resubmitted.json.incidente &&
            !incidents.includes(resubmitted.json.incidente.id)
          )
            incidents.push(resubmitted.json.incidente.id);
          assert.equal(
            resubmitted.status,
            201,
            JSON.stringify(resubmitted.json),
          );
          assert.equal(resubmitted.json.incidente.id, activeRow.id);
          assert.equal(resubmitted.json.incidente.estado, "ACTIVO");
          assert.equal(resubmitted.json.reporte.estado, "EN_REVISION");
        },
      );
      await t.test(
        "Puntos antiguos de una cuenta sin verificar no entran al ranking ni reciben monedas en un cierre nuevo",
        async () => {
          const month = "1807-03";
          const legacy = await actor("ranking_legacy", false);
          const eligible = await actor("ranking_eligible", true);
          await prisma.pointEvent.createMany({
            data: [
              {
                usuarioId: legacy.id,
                clave: run + "legacy_points",
                tipo: "AJUSTE",
                puntos: 100,
                creadoEn: new Date(month + "-15T12:00:00Z"),
              },
              {
                usuarioId: eligible.id,
                clave: run + "eligible_points",
                tipo: "AJUSTE",
                puntos: 10,
                creadoEn: new Date(month + "-15T12:00:00Z"),
              },
            ],
          });
          const ranking = await request("/ranking?mes=" + month);
          assert.equal(ranking.status, 200);
          assert.equal(
            ranking.json.entries.some(
              (r) => r.nickname === legacy.nombreUsuario,
            ),
            false,
          );
          assert.equal(
            ranking.json.entries.some(
              (r) => r.nickname === eligible.nombreUsuario,
            ),
            true,
          );
          const settled = await request("/admin/ranking/settle", admin, {
            mes: month,
          });
          assert.equal(settled.status, 200, JSON.stringify(settled.json));
          settlements.push(month);
          assert.equal(
            settled.json.datos.entries.some((r) => r.usuarioId === legacy.id),
            false,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: legacy.id } }))
              .monedas,
            0,
          );
          assert.ok(
            (await prisma.user.findUnique({ where: { id: eligible.id } }))
              .monedas > 0,
          );
          await prisma.user.update({
            where: { id: eligible.id },
            data: { correoVerificado: false },
          });
          const history = await request("/ranking?mes=" + month);
          assert.equal(history.json.finalized, true);
          assert.equal(
            history.json.entries.some(
              (r) => r.nickname === eligible.nombreUsuario,
            ),
            true,
          );
        },
      );
      await t.test(
        "Aceptar una apelación de emergencia restaura revisión sin activar autores no verificados",
        async () => {
          const emergency = await incident({
            emergencia: true,
            estado: "FALSO",
            evaluacion: "AGENTE",
          });
          const invalid = await report(emergency, unverified, "FALSO");
          const appeal = await prisma.appeal.create({
            data: {
              usuarioId: unverified.id,
              reporteId: invalid.id,
              motivo: "Solicito nueva revisión del reporte legado.",
            },
          });
          const response = await request(`/admin/appeals/${appeal.id}`, admin, {
            estado: "ACEPTADA",
            respuesta: "Se acepta revisar de nuevo la evidencia.",
          });
          assert.equal(response.status, 200, JSON.stringify(response.json));
          const saved = await prisma.incident.findUnique({
            where: { id: emergency.id },
          });
          assert.equal(saved.estado, "PENDIENTE");
          assert.equal(saved.evaluacion, "PENDIENTE");
          assert.equal(saved.publicado, false);
          assert.equal(saved.fechaPublicacion, null);
        },
      );
    } finally {
      try {
        const userWhere = { usuarioId: { in: users } };
        const incidentWhere = { incidenteId: { in: incidents } };
        await prisma.attachment.deleteMany({ where: userWhere });
        await prisma.appeal.deleteMany({ where: userWhere });
        await prisma.vote.deleteMany({ where: incidentWhere });
        await prisma.chatMessage.deleteMany({ where: incidentWhere });
        await prisma.review.deleteMany({ where: incidentWhere });
        await prisma.flag.deleteMany({ where: incidentWhere });
        await prisma.notification.deleteMany({
          where: { OR: [userWhere, incidentWhere] },
        });
        await prisma.pointEvent.deleteMany({ where: userWhere });
        await prisma.auditLog.deleteMany({ where: userWhere });
        await prisma.report.deleteMany({ where: userWhere });
        await prisma.rankingSettlement.deleteMany({
          where: { id: { in: settlements } },
        });
        await prisma.incident.deleteMany({ where: { id: { in: incidents } } });
        await prisma.user.deleteMany({ where: { id: { in: users } } });
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await prisma.$disconnect();
      }
    }
  },
);
