const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  require("./helpers/provider-environment").disableExternalProviders();
  const url = new URL(connection);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error(
      "Esta regresión de integridad requiere una base local aislada.",
    );
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
  process.env.FIREBASE_PROJECT_ID = "civigo-fixture";
  process.env.ENABLE_JOBS = "false";
  delete process.env.TRUST_PROXY;
}
test(
  "Integridad HTTP: ubicación real, publicación, chat y decisiones humanas",
  { skip: !connection },
  async (t) => {
    const prisma = require("../src/lib/db");
    const app = require("../src/server");
    const { seedCatalog } = require("../src/lib/catalog");
    const { hashToken } = require("../src/lib/auth");
    const { reviewIncident, transaction } = require("../src/lib/workflows");
    const users = [],
      incidents = [],
      types = [];
    let settlementId;
    const run = crypto.randomBytes(6).toString("hex");
    const p = { latitud: -14.06777, longitud: -75.7286 };
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (
      route,
      actor,
      body,
      method = body === undefined ? "GET" : "POST",
    ) => {
      const response = await fetch(base + route, {
        method,
        headers: {
          Cookie: actor.cookie,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    };
    async function actor(label, role = "USUARIO") {
      const user = await prisma.user.create({
        data: {
          nombreUsuario: run + "_" + label,
          nombres: "Prueba",
          apellidos: "Integridad",
          correo: run + "_" + label + "@gmail.com",
          telefono: "+519" + String(crypto.randomInt(10000000, 99999999)),
          password: "scrypt$cuenta_de_prueba_sin_login",
          telefonoVerificado: false,
          correoVerificado: true,
          rol: role,
          ...(role === "AGENTE"
            ? {
                tipoAgente: "COLABORADOR",
                permisos: ["revisar", "resolver", "evidencia"],
              }
            : {}),
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
    async function createIncident(data) {
      const row = await prisma.incident.create({
        data: {
          tipo: "Incidente de prueba",
          descripcion: "Integración aislada",
          ...p,
          ...data,
        },
      });
      incidents.push(row.id);
      return row;
    }
    const report = (who, gps) =>
      request("/reports", who, {
        tipo: "persona-desaparecida",
        descripcion: "",
        ...p,
        fechaEvento: new Date().toISOString(),
        ...(gps ? { gpsLatitud: gps.latitud, gpsLongitud: gps.longitud } : {}),
      });
    try {
      await seedCatalog();
      const admin = await actor("admin", "ADMIN");
      const actors = [];
      for (let n = 0; n < 7; n++) actors.push(await actor("u" + n));
      let grouped;
      await t.test(
        "Reportar a distancia no confirma presencia y tres aportes no publican incidentes ordinarios sin evaluación",
        async () => {
          const first = await report(actors[0]);
          assert.equal(first.status, 201, JSON.stringify(first.json));
          grouped = first.json.incidente.id;
          incidents.push(grouped);
          const remote = await report(actors[1], {
            latitud: -14.1,
            longitud: -75.7,
          });
          assert.equal(remote.status, 201, JSON.stringify(remote.json));
          assert.equal(remote.json.incidente.id, grouped);
          assert.equal(
            await prisma.vote.count({ where: { incidenteId: grouped } }),
            0,
          );
          for (let n = 2; n < 5; n++) {
            const near = await report(actors[n], p);
            assert.equal(near.status, 201, JSON.stringify(near.json));
            assert.equal(near.json.incidente.id, grouped);
          }
          const row = await prisma.incident.findUnique({
            where: { id: grouped },
          });
          assert.equal(row.validacion, 0.5);
          assert.equal(
            await prisma.vote.count({ where: { incidenteId: grouped } }),
            0,
          );
          assert.equal(
            await prisma.report.count({
              where: { incidenteId: grouped, estado: "EN_REVISION" },
            }),
            5,
          );
          assert.equal(row.publicado, false);
          assert.equal(row.estado, "PENDIENTE");
          assert.equal(
            await prisma.pointEvent.count({
              where: { usuarioId: { in: users } },
            }),
            0,
          );
          const contributions = await prisma.report.findMany({
            where: { incidenteId: grouped },
          });
          const held = await request(
            `/admin/incidents/${grouped}/review`,
            admin,
            {
              accion: "VALIDAR",
              nivelRiesgo: 2,
              motivo:
                "No aprobar automáticamente todos los aportes pendientes.",
            },
          );
          assert.equal(held.status, 409);
          for (const contribution of contributions) {
            const reviewedReport = await request(
              `/admin/reports/${contribution.id}/review`,
              admin,
              {
                accion: "VALIDAR",
                nivelRiesgo: 2,
                motivo: "Pruebas revisadas de este aporte individual.",
              },
            );
            assert.equal(
              reviewedReport.status,
              200,
              JSON.stringify(reviewedReport.json),
            );
          }
          const reviewed = await request(
            `/admin/incidents/${grouped}/review`,
            admin,
            {
              accion: "VALIDAR",
              nivelRiesgo: 2,
              motivo: "Evaluación humana de prueba con información suficiente.",
            },
          );
          assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json));
          assert.equal(reviewed.json.publicado, true);
          assert.equal(reviewed.json.estado, "VALIDADO");
          assert(
            (await prisma.pointEvent.count({
              where: { usuarioId: { in: users } },
            })) > 0,
          );
        },
      );
      await t.test(
        "Una confirmación comunitaria adicional conserva la validación completa del agente",
        async () => {
          const row = await createIncident({
            publicado: true,
            estado: "VALIDADO",
            evaluacion: "AGENTE",
            validacion: 1,
          });
          const result = await request(
            `/incidents/${row.id}/confirmar`,
            actors[5],
            p,
          );
          assert.equal(result.status, 200, JSON.stringify(result.json));
          assert.equal(result.json.validacion, 1);
        },
      );
      await t.test(
        "Chat muestra los últimos doscientos mensajes y el personal puede responder antes de publicar",
        async () => {
          const old = new Date(Date.now() - 20 * 86400000);
          const row = await createIncident({
            individual: true,
            publicado: false,
            fechaCreacion: old,
          });
          await prisma.report.create({
            data: {
              usuarioId: actors[5].id,
              incidenteId: row.id,
              tipo: row.tipo,
              descripcion: "",
              ...p,
            },
          });
          await prisma.chatMessage.createMany({
            data: Array.from({ length: 201 }, (_, n) => ({
              usuarioId: actors[5].id,
              incidenteId: row.id,
              mensaje: "historial " + n,
              creadoEn: new Date(Date.now() - 120000 + n),
            })),
          });
          const list = await request(`/incidents/${row.id}/chat`, actors[5]);
          assert.equal(list.status, 200);
          assert.equal(list.json.length, 200);
          assert.equal(list.json[0].mensaje, "historial 1");
          assert.equal(list.json.at(-1).mensaje, "historial 200");
          const reply = await request(`/incidents/${row.id}/chat`, admin, {
            mensaje: "Revisaremos la documentación pendiente de publicación.",
          });
          assert.equal(reply.status, 201, JSON.stringify(reply.json));
          const duplicate = await request(`/incidents/${row.id}/chat`, admin, {
            mensaje: "Revisaremos la documentación pendiente de publicación.",
          });
          assert.equal(duplicate.status, 429);
        },
      );
      await t.test(
        "Una decisión falsa no se revoca por VALIDAR o RESOLVER y se vuelven a comprobar permisos actuales",
        async () => {
          const falseRow = await createIncident({
            estado: "FALSO",
            individual: true,
          });
          for (const accion of ["VALIDAR", "RESOLVER", "REABRIR", "GRAVEDAD"]) {
            const result = await request(
              `/admin/incidents/${falseRow.id}/review`,
              admin,
              {
                accion,
                nivelRiesgo: 2,
                motivo: "Revisión de prueba sin una apelación aceptada.",
              },
            );
            assert.equal(result.status, 409, JSON.stringify(result.json));
          }
          const reviewer = await actor("revoked", "ADMIN");
          const row = await createIncident({});
          await prisma.user.update({
            where: { id: reviewer.id },
            data: { rol: "USUARIO" },
          });
          await assert.rejects(
            transaction((db) =>
              reviewIncident(db, row, reviewer, {
                accion: "VALIDAR",
                nivelRiesgo: 2,
                motivo: "Permiso ya retirado",
              }),
            ),
            (error) => error.status === 403,
          );
          assert.equal(
            (await prisma.incident.findUnique({ where: { id: row.id } }))
              .estado,
            "PENDIENTE",
          );
        },
      );
      await t.test(
        "Una apelación revierte solo su aporte, restaura puntos originales y preserva bloqueos manuales",
        async () => {
          const agent = await actor("agent", "AGENTE");
          const reports = await prisma.report.findMany({
            where: { incidenteId: grouped },
          });
          const votes = await prisma.vote.findMany({
            where: { incidenteId: grouped },
          });
          const keys = reports
            .flatMap((r) => ["reporte:" + r.id, "prueba:" + r.id])
            .concat(votes.map((v) => "confirmacion:" + v.id));
          await prisma.pointEvent.updateMany({
            where: { clave: { in: keys } },
            data: { creadoEn: new Date("1901-01-15T12:00:00Z") },
          });
          const pointsBefore = await prisma.pointEvent.findMany({
            where: { clave: { in: keys } },
            orderBy: { clave: "asc" },
          });
          const snapshot = {
            mes: "1901-01",
            entries: [
              {
                usuarioId: actors[0].id,
                nickname: actors[0].nombreUsuario,
                position: 1,
                puntos: 10,
                monedasEstimadas: 100,
              },
            ],
          };
          await prisma.rankingSettlement.create({
            data: { id: snapshot.mes, datos: snapshot },
          });
          settlementId = snapshot.mes;
          await prisma.user.update({
            where: { id: actors[0].id },
            data: { monedas: 100 },
          });
          await prisma.user.update({
            where: { id: actors[0].id },
            data: { faltas: 3 },
          });
          assert.equal(
            (
              await request(
                `/admin/users/${actors[1].id}`,
                admin,
                { bloqueado: true },
                "PATCH",
              )
            ).status,
            200,
          );
          const falseReview = {
            accion: "FALSO",
            motivo: "Veredicto de prueba posterior a una validación previa.",
          };
          assert.equal(
            (
              await request(
                `/admin/incidents/${grouped}/review`,
                agent,
                falseReview,
              )
            ).status,
            409,
          );
          for (const contribution of reports) {
            const decision = await request(
              `/admin/reports/${contribution.id}/review`,
              agent,
              falseReview,
            );
            assert.equal(decision.status, 200, JSON.stringify(decision.json));
          }
          assert.equal(
            (await prisma.user.findUnique({ where: { id: actors[0].id } }))
              .faltas,
            4,
          );
          assert.equal(
            await prisma.pointEvent.count({ where: { clave: { in: keys } } }),
            pointsBefore.length,
          );
          const withdraw = {
            accion: "RETIRAR_PUNTOS",
            motivo:
              "El administrador evalúa la retirada de puntos por falsedad confirmada.",
          };
          assert.equal(
            (
              await request(
                `/admin/incidents/${grouped}/review`,
                agent,
                withdraw,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                `/admin/incidents/${grouped}/review`,
                admin,
                withdraw,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await request(
                `/admin/incidents/${grouped}/review`,
                admin,
                withdraw,
              )
            ).status,
            200,
          );
          assert.equal(
            await prisma.pointEvent.count({ where: { clave: { in: keys } } }),
            0,
          );
          assert.equal(
            (
              await request(
                `/admin/incidents/${grouped}/review`,
                admin,
                falseReview,
              )
            ).status,
            409,
          );
          assert.equal(
            await prisma.auditLog.count({
              where: {
                accion: "ANULAR_PUNTOS_FALSO",
                entidadId: String(grouped),
              },
            }),
            1,
          );
          const appeals = [];
          for (let n = 0; n < reports.length; n++) {
            const report = reports.find((r) => r.usuarioId === actors[n].id);
            const result = await request(
              `/reports/${report.id}/appeal`,
              actors[n],
              {
                motivo:
                  "Solicito una revisión de la decisión falsa con nuevas pruebas.",
              },
            );
            assert.equal(result.status, 201, JSON.stringify(result.json));
            appeals.push(result.json.id);
          }
          const decision = {
            estado: "ACEPTADA",
            respuesta:
              "Se revierte el veredicto falso únicamente del reporte apelado.",
          };
          const accepted = await request(
            `/admin/appeals/${appeals[0]}`,
            admin,
            decision,
          );
          assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
          const u0 = await prisma.user.findUnique({
            where: { id: actors[0].id },
          });
          const u1 = await prisma.user.findUnique({
            where: { id: actors[1].id },
          });
          assert.equal(u0.faltas, 3);
          assert.equal(u0.bloqueado, false);
          assert.equal(u1.faltas, 1);
          assert.equal(u1.bloqueado, true);
          assert.equal(
            (await prisma.appeal.findUnique({ where: { id: appeals[1] } }))
              .estado,
            "PENDIENTE",
          );
          for (const appealId of appeals.slice(1)) {
            assert.equal(
              (await request(`/admin/appeals/${appealId}`, admin, decision))
                .status,
              200,
            );
          }
          assert.equal(
            (await request(`/admin/appeals/${appeals[0]}`, admin, decision))
              .status,
            409,
          );
          assert.equal(
            (await prisma.incident.findUnique({ where: { id: grouped } }))
              .fechaPublicacion,
            null,
          );
          const validation = {
            accion: "VALIDAR",
            nivelRiesgo: 2,
            motivo:
              "Incidente confirmado tras aceptar la apelación correspondiente.",
          };
          for (const contribution of reports) {
            assert.equal(
              (
                await request(
                  `/admin/reports/${contribution.id}/review`,
                  admin,
                  validation,
                )
              ).status,
              200,
            );
          }
          assert.equal(
            (
              await request(
                `/admin/incidents/${grouped}/review`,
                admin,
                validation,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await request(
                `/admin/incidents/${grouped}/review`,
                admin,
                validation,
              )
            ).status,
            200,
          );
          const pointsAfter = await prisma.pointEvent.findMany({
            where: { clave: { in: keys } },
            orderBy: { clave: "asc" },
          });
          assert.deepEqual(
            pointsAfter.map((p) => [
              p.clave,
              p.puntos,
              p.creadoEn.toISOString(),
            ]),
            pointsBefore.map((p) => [
              p.clave,
              p.puntos,
              p.creadoEn.toISOString(),
            ]),
          );
          const { ranking } = require("../src/lib/ranking");
          assert.deepEqual(
            (await ranking(settlementId)).entries,
            snapshot.entries,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: actors[0].id } }))
              .monedas,
            100,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: actors[0].id } }))
              .faltas,
            3,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: actors[1].id } }))
              .bloqueado,
            true,
          );
        },
      );
      await t.test(
        "Revocar correo recalcula votos y conserva decisiones humanas",
        async () => {
          const author = await actor("verified_author");
          const voters = [
            await actor("verify_v0"),
            await actor("verify_v1"),
            await actor("verify_v2"),
          ];
          const row = await createIncident({
            estado: "VALIDADO",
            publicado: true,
            evaluacion: "IA",
            nivelRiesgo: 3,
            validacion: 1,
          });
          const contribution = await prisma.report.create({
            data: {
              usuarioId: author.id,
              incidenteId: row.id,
              tipo: row.tipo,
              descripcion: "Caso comunitario",
              estado: "VALIDADO",
              ...p,
            },
          });
          const human = await createIncident({
            estado: "VALIDADO",
            publicado: true,
            evaluacion: "AGENTE",
            nivelRiesgo: 3,
            validacion: 1,
          });
          for (const voter of voters)
            for (const incident of [row, human])
              await prisma.vote.create({
                data: {
                  usuarioId: voter.id,
                  incidenteId: incident.id,
                  tipo: "CONFIRMAR",
                  ...p,
                },
              });
          for (const voter of voters) {
            const result = await request(
              `/admin/users/${voter.id}`,
              admin,
              {
                correoVerificado: false,
                motivoVerificacion: "Correo revocado en prueba aislada.",
              },
              "PATCH",
            );
            assert.equal(result.status, 200, JSON.stringify(result.json));
          }
          const updated = await prisma.incident.findUnique({
            where: { id: row.id },
          });
          assert.equal(updated.validacion, 0.5);
          assert.equal(updated.estado, "ACTIVO");
          assert.equal(
            (await prisma.report.findUnique({ where: { id: contribution.id } }))
              .estado,
            "PENDIENTE",
          );
          assert.equal(
            (await prisma.incident.findUnique({ where: { id: human.id } }))
              .validacion,
            1,
          );
          for (const voter of voters)
            assert.equal(
              (
                await request(
                  `/admin/users/${voter.id}`,
                  admin,
                  {
                    correoVerificado: true,
                    motivoVerificacion: "Correo restaurado en prueba aislada.",
                  },
                  "PATCH",
                )
              ).status,
              200,
            );
          assert.equal(
            (await prisma.incident.findUnique({ where: { id: row.id } }))
              .validacion,
            1,
          );
          assert.equal(
            (await prisma.report.findUnique({ where: { id: contribution.id } }))
              .estado,
            "VALIDADO",
          );
        },
      );
      await t.test(
        "Apelaciones notifican al autor y revalidar restaura credibilidad sin duplicar puntos",
        async () => {
          const author = await actor("credibility");
          const contributions = [];
          for (let n = 0; n < 3; n++) {
            const row = await createIncident({
              estado: "VALIDADO",
              publicado: true,
              evaluacion: "AGENTE",
              nivelRiesgo: 2,
              validacion: 1,
            });
            const contribution = await prisma.report.create({
              data: {
                usuarioId: author.id,
                incidenteId: row.id,
                tipo: row.tipo,
                descripcion: "Caso de credibilidad",
                estado: "VALIDADO",
                ...p,
              },
            });
            contributions.push(contribution);
            await prisma.pointEvent.create({
              data: {
                usuarioId: author.id,
                clave: "reporte:" + contribution.id,
                tipo: "REPORTE_VALIDADO",
                puntos: 10,
              },
            });
          }
          const target = contributions[0];
          assert.equal(
            (
              await request(`/admin/reports/${target.id}/review`, admin, {
                accion: "FALSO",
                motivo: "Falsedad de este aporte concreto.",
              })
            ).status,
            200,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: author.id } }))
              .reputacion,
            70,
          );
          const appeal = await request(`/reports/${target.id}/appeal`, author, {
            motivo: "Solicito revisar este aporte con nuevas pruebas.",
          });
          const rejected = await request(
            `/admin/appeals/${appeal.json.id}`,
            admin,
            {
              estado: "RECHAZADA",
              respuesta:
                "Las pruebas aportadas no modifican el resultado inicial.",
            },
          );
          assert.equal(rejected.status, 200, JSON.stringify(rejected.json));
          const mine = await request("/reports/mine", author);
          assert.equal(
            mine.json.find((r) => r.id === target.id).apelaciones[0].estado,
            "RECHAZADA",
          );
          assert.equal(
            await prisma.notification.count({
              where: { usuarioId: author.id, tipo: "APELACION" },
            }),
            1,
          );
          const nextAppeal = await request(
            `/reports/${target.id}/appeal`,
            author,
            {
              motivo:
                "Nueva prueba para solicitar otra oportunidad de revisar.",
            },
          );
          assert.equal(
            (
              await request(`/admin/appeals/${nextAppeal.json.id}`, admin, {
                estado: "ACEPTADA",
                respuesta:
                  "Nueva prueba aceptada; corresponde revisar el aporte.",
              })
            ).status,
            200,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: author.id } }))
              .reputacion,
            null,
          );
          assert.equal(
            (
              await request(`/admin/reports/${target.id}/review`, admin, {
                accion: "VALIDAR",
                nivelRiesgo: 2,
                motivo: "Aporte corroborado tras revisar la nueva evidencia.",
              })
            ).status,
            200,
          );
          const restored = await prisma.user.findUnique({
            where: { id: author.id },
          });
          assert.equal(restored.faltas, 0);
          assert.equal(restored.reputacion, 100);
          assert.equal(
            await prisma.pointEvent.count({ where: { usuarioId: author.id } }),
            3,
          );
        },
      );
      await t.test(
        "Personal sin evidencia ve pendientes pero no puede aprobarlos; avisos guardan revisor",
        async () => {
          const agent = await actor("limited_agent", "AGENTE");
          await prisma.user.update({
            where: { id: agent.id },
            data: {
              permisos: ["revisar"],
              tipoAgente: "POLICIA",
              distrito: "Ica",
            },
          });
          assert.equal(
            (
              await request(
                `/admin/users/${agent.id}`,
                admin,
                { distrito: null },
                "PATCH",
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await request(
                `/admin/users/${agent.id}`,
                admin,
                { permisos: ["usuarios"] },
                "PATCH",
              )
            ).status,
            400,
          );
          const row = await createIncident({
            distrito: "Ica",
            evaluacion: "PENDIENTE",
            publicado: false,
          });
          const contribution = await prisma.report.create({
            data: {
              usuarioId: actors[6].id,
              incidenteId: row.id,
              tipo: row.tipo,
              descripcion: "Aporte reservado",
              estado: "EN_REVISION",
              ...p,
            },
          });
          await prisma.attachment.create({
            data: {
              id: "moderation-" + run,
              usuarioId: actors[6].id,
              reporteId: contribution.id,
              nombre: "prueba.png",
              mimeType: "image/png",
              size: 1,
              path: "fixture-not-used",
              privado: true,
            },
          });
          const inbox = await request(
            `/admin/incidents?page=1&limit=50&q=${row.id}&estado=REVISION`,
            agent,
          );
          assert.equal(inbox.status, 200, JSON.stringify(inbox.json));
          const visible = inbox.json.items.find((i) => i.id === row.id);
          assert.equal(visible.reportes[0].estado, "EN_REVISION");
          assert.equal(visible.reportes[0].evidenciaPrivada, true);
          assert.equal(visible.reportes[0].adjuntos.length, 0);
          assert.equal(
            (
              await request(`/admin/reports/${contribution.id}/review`, agent, {
                accion: "VALIDAR",
                nivelRiesgo: 2,
                motivo: "No debe aprobar sin permiso de prueba privada.",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request(`/admin/incidents/${row.id}/review`, agent, {
                accion: "VALIDAR",
                nivelRiesgo: 2,
                motivo: "La vista general tampoco permite evitar el permiso.",
              })
            ).status,
            403,
          );
          const flag = await prisma.flag.create({
            data: {
              usuarioId: actors[6].id,
              incidenteId: row.id,
              tipo: "FALSO",
              motivo: "Aviso ciudadano para revisar",
            },
          });
          assert.equal(
            (
              await request(
                `/admin/incidents/${row.id}/flags/${flag.id}/review`,
                agent,
                {
                  motivo:
                    "Aviso revisado y evidencia pendiente de otro agente.",
                },
              )
            ).status,
            200,
          );
          assert.equal(
            (await prisma.flag.findUnique({ where: { id: flag.id } })).estado,
            "REVISADO",
          );
          const revised = await request(
            `/admin/incidents?page=1&q=${row.id}`,
            admin,
          );
          assert.equal(
            revised.json.items.find((i) => i.id === row.id).revisiones[0]
              .usuario.nombreUsuario,
            agent.nombreUsuario,
          );
        },
      );
      await t.test(
        "Paginación administrativa consulta todo y valida parámetros",
        async () => {
          const userPage = await request(
            `/admin/users?page=2&limit=2&q=${run}`,
            admin,
          );
          assert.equal(userPage.status, 200, JSON.stringify(userPage.json));
          assert.equal(userPage.json.items.length, 2);
          assert.equal(userPage.json.total, users.length);
          assert.equal(userPage.json.page, 2);
          assert.equal(userPage.json.pageSize, 2);
          assert.equal(
            (await request("/admin/users?page=0", admin)).status,
            400,
          );
          assert.equal(
            (await request("/admin/audit?page=1&limit=101", admin)).status,
            400,
          );
          const auditPage = await request(
            "/admin/audit?page=1&limit=1&q=VALIDAR_CORREO_ADMIN",
            admin,
          );
          assert.equal(auditPage.status, 200, JSON.stringify(auditPage.json));
          assert.equal(auditPage.json.items.length, 1);
          assert.ok(auditPage.json.total >= 3);
          const appealPage = await request(
            "/admin/appeals?page=1&limit=1&estado=RECHAZADA",
            admin,
          );
          assert.equal(appealPage.status, 200, JSON.stringify(appealPage.json));
          assert.equal(appealPage.json.items[0].estado, "RECHAZADA");
          assert.ok(appealPage.json.total >= 1);
        },
      );
      await t.test(
        "Solicitudes de verificación concurrentes comparten enfriamiento y los cambios de perfil respetan la validación inicial",
        async () => {
          const before = await prisma.verification.count({
            where: { usuarioId: actors[6].id, tipo: "CORREO_GOOGLE" },
          });
          const verifiedRequests = await Promise.all([
            request("/users/email/google/request", actors[6], {}),
            request("/users/email/google/request", actors[6], {}),
          ]);
          assert.deepEqual(
            verifiedRequests.map((r) => r.status),
            [200, 200],
          );
          assert.equal(
            await prisma.verification.count({
              where: { usuarioId: actors[6].id, tipo: "CORREO_GOOGLE" },
            }),
            before,
          );
          await prisma.user.update({
            where: { id: actors[6].id },
            data: { correoVerificado: false },
          });
          const attempts = await Promise.all([
            request("/users/email/google/request", actors[6], {}),
            request("/users/email/google/request", actors[6], {}),
          ]);
          assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 429]);
          await prisma.user.update({
            where: { id: actors[6].id },
            data: { correoVerificado: true },
          });
          assert.equal(
            (
              await request(
                "/users/me",
                actors[6],
                { nickname: "<script>" },
                "PATCH",
              )
            ).status,
            400,
          );
        },
      );
      await t.test(
        "Las actualizaciones parciales de tipos no permiten desactivar la ubicación remota de delitos individuales",
        async () => {
          const category = await prisma.category.findFirst();
          const result = await request("/admin/types", admin, {
            nombre: "Integridad " + run,
            categoriaId: category.id,
            individual: true,
            ubicacionRemota: true,
          });
          assert.equal(result.status, 201, JSON.stringify(result.json));
          types.push(result.json.id);
          assert.equal(
            (
              await request(
                `/admin/types/${result.json.id}`,
                admin,
                { ubicacionRemota: false },
                "PATCH",
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await request(
                `/admin/types/${result.json.id}`,
                admin,
                { categoriaId: 2147483647 },
                "PATCH",
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await prisma.incidentType.findUnique({
                where: { id: result.json.id },
              })
            ).ubicacionRemota,
            true,
          );
        },
      );
    } finally {
      try {
        const incidentWhere = { id: { in: incidents } },
          userWhere = { usuarioId: { in: users } };
        await prisma.attachment.deleteMany({ where: userWhere });
        await prisma.appeal.deleteMany({ where: userWhere });
        await prisma.vote.deleteMany({
          where: { incidenteId: { in: incidents } },
        });
        await prisma.chatMessage.deleteMany({
          where: { incidenteId: { in: incidents } },
        });
        await prisma.flag.deleteMany({
          where: { incidenteId: { in: incidents } },
        });
        await prisma.review.deleteMany({
          where: { incidenteId: { in: incidents } },
        });
        await prisma.notification.deleteMany({
          where: { OR: [userWhere, { incidenteId: { in: incidents } }] },
        });
        await prisma.pointEvent.deleteMany({ where: userWhere });
        await prisma.auditLog.deleteMany({ where: userWhere });
        await prisma.report.deleteMany({ where: userWhere });
        await prisma.incident.deleteMany({ where: incidentWhere });
        await prisma.incidentType.deleteMany({ where: { id: { in: types } } });
        if (settlementId)
          await prisma.rankingSettlement.delete({
            where: { id: settlementId },
          });
        await prisma.user.deleteMany({ where: { id: { in: users } } });
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await prisma.$disconnect();
      }
    }
  },
);
