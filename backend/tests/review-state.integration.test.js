"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  )
    throw new Error("Esta regresión exige una base local aislada.");
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
  delete process.env.TRUST_PROXY;
}
test(
  "Las revisiones respetan la reapertura y no premian confirmaciones de aportes falsos",
  {
    skip: !connection,
    timeout: 90000,
  },
  async (t) => {
    const prisma = require("../src/lib/db");
    const { hashToken } = require("../src/lib/auth");
    const { seedCatalog } = require("../src/lib/catalog");
    const { rewardValidated, transaction } = require("../src/lib/workflows");
    const app = require("../src/server");
    const users = [],
      incidents = [];
    const prefix = "review_" + crypto.randomBytes(6).toString("hex");
    const point = { latitud: -14.06777, longitud: -75.7286 };
    const originalDate = new Date("2026-01-10T12:00:00Z");
    const originalFetch = global.fetch;
    t.mock.method(global, "fetch", (target, options) => {
      assert.equal(
        new URL(typeof target === "string" ? target : target.url).hostname,
        "127.0.0.1",
      );
      return originalFetch(target, options);
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(path, actor, body) {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: actor.cookie,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    }
    async function actor(label, role = "USUARIO", permisos = []) {
      const user = await prisma.user.create({
        data: {
          nombreUsuario: prefix + "_" + label,
          correo: prefix + "_" + label + "@gmail.com",
          telefono: "+999" + crypto.randomInt(10000000000, 100000000000),
          password: "scrypt$fixture_sin_inicio_de_sesion",
          correoVerificado: true,
          rol: role,
          ...(role === "AGENTE" ? { tipoAgente: "COLABORADOR", permisos } : {}),
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
    async function createIncident(data = {}) {
      const row = await prisma.incident.create({
        data: {
          tipo: "Incidente de regresión aislada",
          descripcion: "No es un hecho real.",
          ...point,
          distrito: "Ica",
          nivelRiesgo: 3,
          estado: "VALIDADO",
          publicado: true,
          evaluacion: "IA",
          validacion: 1,
          ...data,
        },
      });
      incidents.push(row.id);
      return row;
    }
    const createReport = (user, incident, estado = "VALIDADO") =>
      prisma.report.create({
        data: {
          usuarioId: user.id,
          incidenteId: incident.id,
          tipo: incident.tipo,
          descripcion: "Aporte de regresión aislada.",
          ...point,
          nivelRiesgo: 3,
          estado,
        },
      });
    const validation = {
      accion: "VALIDAR",
      nivelRiesgo: 3,
      motivo: "Revisión humana de prueba en una base aislada.",
    };
    try {
      await seedCatalog();
      const admin = await actor("admin", "ADMIN");
      const validator = await actor("validator", "AGENTE", ["validar"]);
      await t.test(
        "validar un aporte no reabre incidentes terminales, incluso para administradores",
        async () => {
          const author = await actor("terminal");
          for (const estado of ["RESUELTO", "RETIRADO", "FALSO"]) {
            const incident = await createIncident({ estado, publicado: false });
            const report = await createReport(author, incident, "PENDIENTE");
            for (const reviewer of [validator, admin]) {
              const result = await request(
                `/admin/reports/${report.id}/review`,
                reviewer,
                validation,
              );
              assert.equal(result.status, 409, JSON.stringify(result.json));
              assert.equal(result.json.code, "INCIDENT_REOPEN_REQUIRED");
              const direct = await request(
                `/admin/incidents/${incident.id}/review`,
                reviewer,
                validation,
              );
              assert.equal(direct.status, 409, JSON.stringify(direct.json));
            }
            assert.equal(
              (await prisma.incident.findUnique({ where: { id: incident.id } }))
                .estado,
              estado,
            );
            assert.equal(
              (await prisma.report.findUnique({ where: { id: report.id } }))
                .estado,
              "PENDIENTE",
            );
            if (estado === "RESUELTO") {
              assert.equal(
                (
                  await request(
                    `/admin/incidents/${incident.id}/review`,
                    validator,
                    { ...validation, accion: "REABRIR" },
                  )
                ).status,
                403,
              );
              const reopened = await request(
                `/admin/incidents/${incident.id}/review`,
                admin,
                { ...validation, accion: "REABRIR" },
              );
              assert.equal(reopened.status, 200, JSON.stringify(reopened.json));
              const accepted = await request(
                `/admin/reports/${report.id}/review`,
                validator,
                validation,
              );
              assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
            }
          }
        },
      );
      await t.test(
        "la falsedad desactiva su voto y sus premios hasta una apelación aceptada, sin afectar a vecinos",
        async () => {
          const [first, contributor, neighbor1, neighbor2, neighbor3] =
            await Promise.all(
              [
                "first",
                "contributor",
                "neighbor1",
                "neighbor2",
                "neighbor3",
              ].map((label) => actor(label)),
            );
          const incident = await createIncident();
          await createReport(first, incident);
          const report = await createReport(contributor, incident);
          const votes = [];
          for (const user of [contributor, neighbor1, neighbor2]) {
            const vote = await prisma.vote.create({
              data: {
                usuarioId: user.id,
                incidenteId: incident.id,
                tipo: "CONFIRMAR",
                ...point,
              },
            });
            votes.push(vote);
            await prisma.pointEvent.create({
              data: {
                usuarioId: user.id,
                clave: "confirmacion:" + vote.id,
                tipo: "CONFIRMACION_VALIDADA",
                puntos: 2,
                creadoEn: originalDate,
              },
            });
          }
          await prisma.pointEvent.create({
            data: {
              usuarioId: contributor.id,
              clave: "reporte:" + report.id,
              tipo: "REPORTE_VALIDADO",
              puntos: 7.5,
              creadoEn: originalDate,
            },
          });
          const falseResult = await request(
            `/admin/reports/${report.id}/review`,
            admin,
            {
              accion: "FALSO",
              motivo: "La revisión aislada determina falso sólo este aporte.",
            },
          );
          assert.equal(
            falseResult.status,
            200,
            JSON.stringify(falseResult.json),
          );
          let visible = await request(`/incidents/${incident.id}`, first);
          assert.equal(visible.json.confirmaciones, 2);
          assert.equal(visible.json.estado, "ACTIVO");
          assert.ok(visible.json.validacion < 1);
          assert.equal(
            await prisma.vote.count({ where: { incidenteId: incident.id } }),
            3,
            "Los IDs originales se retienen para auditoría y apelaciones.",
          );
          const confirmation = await request(
            `/incidents/${incident.id}/confirmar`,
            contributor,
            point,
          );
          assert.equal(confirmation.status, 409);
          assert.equal(
            confirmation.json.code,
            "REPORT_CONFIRMATION_INELIGIBLE",
          );
          const withdrawn = await request(
            `/admin/reports/${report.id}/review`,
            admin,
            {
              accion: "RETIRAR_PUNTOS",
              motivo: "Retirada administrativa de los puntos del aporte falso.",
            },
          );
          assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.json));
          const removedKeys = [
            "reporte:" + report.id,
            "confirmacion:" + votes[0].id,
          ];
          assert.equal(
            await prisma.pointEvent.count({
              where: { clave: { in: removedKeys } },
            }),
            0,
          );
          const next = await request(
            `/incidents/${incident.id}/confirmar`,
            neighbor3,
            point,
          );
          assert.equal(next.status, 200, JSON.stringify(next.json));
          assert.equal(next.json.confirmaciones, 3);
          assert.equal(next.json.estado, "VALIDADO");
          assert.equal(
            await prisma.pointEvent.count({
              where: { clave: { in: removedKeys } },
            }),
            0,
            "La validación de otros vecinos no restaura premios anulados.",
          );
          for (const vote of votes.slice(1))
            assert.equal(
              await prisma.pointEvent.count({
                where: { clave: "confirmacion:" + vote.id },
              }),
              1,
            );
          const appeal = await request(
            `/reports/${report.id}/appeal`,
            contributor,
            {
              motivo:
                "Solicito revisión con contexto y pruebas nuevas de ensayo.",
            },
          );
          assert.equal(appeal.status, 201, JSON.stringify(appeal.json));
          const decision = await request(
            `/admin/appeals/${appeal.json.id}`,
            admin,
            {
              estado: "ACEPTADA",
              respuesta:
                "La apelación se acepta para revisar el aporte, sin validarlo automáticamente.",
            },
          );
          assert.equal(decision.status, 200, JSON.stringify(decision.json));
          await transaction((db) => rewardValidated(db, incident.id));
          assert.equal(
            await prisma.pointEvent.count({
              where: { clave: "reporte:" + report.id },
            }),
            0,
            "El aporte aún EN_REVISION no recibe puntos de reporte.",
          );
          const restoredPresence = await prisma.pointEvent.findUnique({
            where: { clave: "confirmacion:" + votes[0].id },
          });
          assert.equal(restoredPresence.puntos, 2);
          assert.equal(+restoredPresence.creadoEn, +originalDate);
          const approved = await request(
            `/admin/reports/${report.id}/review`,
            admin,
            validation,
          );
          assert.equal(approved.status, 200, JSON.stringify(approved.json));
          const restored = await prisma.pointEvent.findMany({
            where: { clave: { in: removedKeys } },
          });
          assert.equal(restored.length, 2);
          assert.deepEqual(
            restored.map((row) => row.puntos).sort((a, b) => a - b),
            [2, 7.5],
          );
          assert.ok(restored.every((row) => +row.creadoEn === +originalDate));
          visible = await request(`/incidents/${incident.id}`, first);
          assert.equal(visible.json.confirmaciones, 4);
        },
      );
      await t.test(
        "los votos legados de aportes ya falsos no recuperan premios ni cuentan al confirmar",
        async () => {
          const first = await actor("legacy_first");
          const legacy = await actor("legacy_false");
          const neighbor = await actor("legacy_neighbor");
          const incident = await createIncident({
            validacion: 0.5,
            estado: "ACTIVO",
          });
          await createReport(first, incident);
          await createReport(legacy, incident, "FALSO");
          const vote = await prisma.vote.create({
            data: {
              usuarioId: legacy.id,
              incidenteId: incident.id,
              tipo: "CONFIRMAR",
              ...point,
            },
          });
          await transaction((db) => rewardValidated(db, incident.id));
          assert.equal(
            await prisma.pointEvent.count({
              where: { clave: "confirmacion:" + vote.id },
            }),
            0,
          );
          assert.equal(
            (await request(`/incidents/${incident.id}`, first)).json
              .confirmaciones,
            0,
          );
          const next = await request(
            `/incidents/${incident.id}/confirmar`,
            neighbor,
            point,
          );
          assert.equal(next.status, 200, JSON.stringify(next.json));
          assert.equal(next.json.confirmaciones, 1);
          assert.ok(next.json.validacion < 1);
          assert.equal(
            await prisma.pointEvent.count({
              where: { clave: "confirmacion:" + vote.id },
            }),
            0,
          );
        },
      );
      await t.test(
        "un autor con otro aporte aceptado no pierde una confirmación legítima por una prueba pendiente",
        async () => {
          const first = await actor("mixed_first"),
            contributor = await actor("mixed_contributor");
          const incident = await createIncident();
          await createReport(first, incident);
          await createReport(contributor, incident, "EN_REVISION");
          await createReport(contributor, incident, "PENDIENTE");
          const result = await request(
            `/incidents/${incident.id}/confirmar`,
            contributor,
            point,
          );
          assert.equal(result.status, 200, JSON.stringify(result.json));
          assert.equal(result.json.confirmaciones, 1);
          await transaction((db) => rewardValidated(db, incident.id));
          assert.equal(
            await prisma.pointEvent.count({
              where: {
                usuarioId: contributor.id,
                tipo: "CONFIRMACION_VALIDADA",
              },
            }),
            1,
          );
        },
      );
    } finally {
      try {
        const userWhere = { usuarioId: { in: users } },
          incidentWhere = { incidenteId: { in: incidents } };
        await prisma.appeal.deleteMany({ where: userWhere });
        await prisma.vote.deleteMany({ where: incidentWhere });
        await prisma.review.deleteMany({ where: incidentWhere });
        await prisma.flag.deleteMany({ where: incidentWhere });
        await prisma.notification.deleteMany({
          where: { OR: [userWhere, incidentWhere] },
        });
        await prisma.pointEvent.deleteMany({ where: userWhere });
        await prisma.auditLog.deleteMany({ where: userWhere });
        await prisma.report.deleteMany({ where: userWhere });
        await prisma.incident.deleteMany({ where: { id: { in: incidents } } });
        await prisma.user.deleteMany({ where: { id: { in: users } } });
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await prisma.$disconnect();
      }
    }
  },
);
