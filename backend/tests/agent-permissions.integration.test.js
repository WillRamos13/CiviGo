const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Esta prueba usa únicamente una base local aislada.");
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
  process.env.ENABLE_JOBS = "false";
}

test(
  "Permisos granulares del agente: acciones HTTP, privacidad, alcance y moderación reversible",
  { skip: !connection },
  async (t) => {
    const prisma = require("../src/lib/db");
    const { hashToken } = require("../src/lib/auth");
    const { seedCatalog } = require("../src/lib/catalog");
    const { hashPassword } = require("../src/lib/password");
    await seedCatalog();
    const server = require("../src/server").listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const run = crypto.randomBytes(5).toString("hex");
    const users = [],
      incidents = [];
    const password = await hashPassword(
      crypto.randomBytes(24).toString("base64url"),
    );
    const bache = await prisma.incidentType.findUnique({
      where: { slug: "bache" },
    });
    const robo = await prisma.incidentType.findUnique({
      where: { slug: "robo" },
    });
    const extorsion = await prisma.incidentType.findUnique({
      where: { slug: "extorsion" },
    });
    const another = await prisma.incidentType.findFirst({
      where: { activo: true, individual: false, id: { not: bache.id } },
    });
    async function actor(role, grants = [], overrides = {}) {
      const index = users.length,
        token = crypto.randomBytes(32).toString("hex");
      const user = await prisma.user.create({
        data: {
          nombreUsuario: `ap_${run}_${index}`,
          correo: `ap_${run}_${index}@gmail.com`,
          telefono: `+519${crypto.randomInt(10000000, 99999999)}`,
          password,
          correoVerificado: true,
          rol: role,
          ...(role === "AGENTE"
            ? { tipoAgente: "POLICIA", distrito: "Ica", permisos: grants }
            : {}),
          ...overrides,
        },
      });
      users.push(user.id);
      await prisma.session.create({
        data: {
          id: hashToken(token),
          usuarioId: user.id,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      return { ...user, cookie: `civigo_session=${token}` };
    }
    async function request(
      path,
      user,
      body,
      method = body === undefined ? "GET" : "POST",
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(user ? { Cookie: user.cookie } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, json: await response.json() };
    }
    let owner;
    async function incident({
      district = "Ica",
      type = bache,
      status = "ACTIVO",
      evidence = false,
    } = {}) {
      const row = await prisma.incident.create({
        data: {
          tipo: type.nombre,
          tipoId: type.id,
          individual: type.individual,
          distrito: district,
          descripcion: "Contexto de prueba local",
          latitud: -14.0678,
          longitud: -75.7286,
          estado: status,
          nivelRiesgo: 2,
          publicado: true,
          evaluacion: "IA",
          reportes: {
            create: {
              usuarioId: owner.id,
              tipo: type.nombre,
              tipoId: type.id,
              descripcion: "Contexto de prueba local",
              latitud: -14.0678,
              longitud: -75.7286,
              estado: "PENDIENTE",
              ...(evidence
                ? {
                    adjuntos: {
                      create: {
                        id: crypto.randomUUID(),
                        usuarioId: owner.id,
                        nombre: "privada.jpg",
                        mimeType: "image/jpeg",
                        size: 5,
                        path: "fixture-only.jpg",
                        privado: true,
                        tipo: "EVIDENCIA",
                      },
                    },
                  }
                : {}),
            },
          },
        },
        include: { reportes: { include: { adjuntos: true } } },
      });
      incidents.push(row.id);
      return row;
    }
    try {
      const admin = await actor("ADMIN");
      owner = await actor("USUARIO");
      const reader = await actor("AGENTE", ["consultar"]);
      const local = await incident(),
        remote = await incident({ district: "Parcona" });
      await t.test(
        "Catálogo central solo administrativo y consulta sin decisiones",
        async () => {
          const catalog = await request("/admin/permissions", admin);
          assert.equal(catalog.status, 200);
          assert.equal(catalog.json.length, 10);
          assert.equal(
            (await request("/admin/permissions", reader)).status,
            403,
          );
          assert.equal((await request("/admin/incidents", owner)).status, 403);
          const list = await request("/admin/incidents", reader);
          assert.equal(list.status, 200);
          assert(list.json.some((row) => row.id === local.id));
          assert(!list.json.some((row) => row.id === remote.id));
          for (const accion of [
            "VALIDAR",
            "GRAVEDAD",
            "FALSO",
            "RESOLVER",
            "REABRIR",
          ])
            assert.equal(
              (
                await request(`/admin/incidents/${local.id}/review`, reader, {
                  accion,
                  nivelRiesgo: 3,
                  motivo: "Revisión local justificada",
                })
              ).status,
              403,
            );
          assert.equal(
            (
              await request(`/admin/incidents/${local.id}/classify`, reader, {
                tipoId: another.id,
                motivo: "Clasificación revisada",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                `/admin/reports/${local.reportes[0].id}/review`,
                reader,
                {
                  accion: "VALIDAR",
                  nivelRiesgo: 3,
                  motivo: "Revisión local justificada",
                },
              )
            ).status,
            403,
          );
          assert.equal((await request("/admin/users", reader)).status, 403);
        },
      );
      await t.test(
        "Cada función funciona sin heredar las otras y respeta el distrito",
        async () => {
          const actions = [
            ["validar", "VALIDAR"],
            ["gravedad", "GRAVEDAD"],
            ["resolver", "RESOLVER"],
            ["reabrir", "REABRIR"],
          ];
          for (const [permission, accion] of actions) {
            const agent = await actor("AGENTE", [permission]);
            const row = await incident({
              status: accion === "REABRIR" ? "RESUELTO" : "ACTIVO",
            });
            const input = {
              accion,
              nivelRiesgo: 4,
              motivo: "Decisión humana comprobada",
            };
            const accepted = await request(
              `/admin/incidents/${row.id}/review`,
              agent,
              input,
            );
            assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
            assert.equal(
              (
                await request(
                  `/admin/incidents/${remote.id}/review`,
                  agent,
                  input,
                )
              ).status,
              403,
            );
            if (permission !== "gravedad")
              assert.equal(
                (
                  await request(`/admin/incidents/${row.id}/review`, agent, {
                    ...input,
                    accion: "GRAVEDAD",
                  })
                ).status,
                403,
              );
          }
          const classifier = await actor("AGENTE", ["clasificar"]);
          assert.equal(
            (
              await request(
                `/admin/incidents/${local.id}/classify`,
                classifier,
                { tipoId: another.id, motivo: "Tipo corregido tras revisión" },
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await request(
                `/admin/incidents/${remote.id}/classify`,
                classifier,
                { tipoId: another.id, motivo: "Tipo corregido tras revisión" },
              )
            ).status,
            403,
          );
          const approved = await incident();
          await prisma.incident.update({
            where: { id: approved.id },
            data: { evaluacion: "AGENTE", estado: "VALIDADO", validacion: 1 },
          });
          await prisma.report.update({
            where: { id: approved.reportes[0].id },
            data: { estado: "VALIDADO" },
          });
          assert.equal(
            (
              await request(
                `/admin/incidents/${approved.id}/classify`,
                classifier,
                { tipoId: robo.id, motivo: "Delito individual reclasificado" },
              )
            ).status,
            403,
          );
          await prisma.user.update({
            where: { id: classifier.id },
            data: { permisos: ["clasificar", "evidencia"] },
          });
          const converted = await request(
            `/admin/incidents/${approved.id}/classify`,
            classifier,
            { tipoId: robo.id, motivo: "Delito individual reclasificado" },
          );
          assert.equal(converted.status, 200, JSON.stringify(converted.json));
          const convertedRow = await prisma.incident.findUnique({
            where: { id: approved.id },
            include: { reportes: true },
          });
          assert.equal(convertedRow.publicado, false);
          assert.equal(convertedRow.evaluacion, "PENDIENTE");
          assert.equal(convertedRow.nivelRiesgo, null);
          assert.equal(convertedRow.reportes[0].estado, "EN_REVISION");
          assert.equal(
            (
              await request(
                `/admin/incidents/${approved.id}/review`,
                classifier,
                {
                  accion: "VALIDAR",
                  nivelRiesgo: 3,
                  motivo: "Clasificar no permite aprobar",
                },
              )
            ).status,
            403,
          );
          const province = await actor("AGENTE", ["gravedad"], {
            tipoAgente: "COLABORADOR",
            distrito: null,
          });
          assert.equal(
            (
              await request(`/admin/incidents/${remote.id}/review`, province, {
                accion: "GRAVEDAD",
                nivelRiesgo: 3,
                motivo: "Ámbito provincial autorizado",
              })
            ).status,
            200,
          );
        },
      );
      await t.test(
        "Reclasificar entre delitos individuales requiere nueva revisión; el mismo tipo conserva su aprobación",
        async () => {
          const classifier = await actor("AGENTE", ["clasificar", "evidencia"]);
          const row = await incident({
            type: robo,
            status: "VALIDADO",
            evidence: true,
          });
          await prisma.incident.update({
            where: { id: row.id },
            data: { evaluacion: "AGENTE", validacion: 1 },
          });
          await prisma.report.update({
            where: { id: row.reportes[0].id },
            data: { estado: "VALIDADO", nivelRiesgo: 2 },
          });
          const unchanged = await request(
            `/admin/incidents/${row.id}/classify`,
            classifier,
            { tipoId: robo.id, motivo: "Se confirma el mismo tipo de delito" },
          );
          assert.equal(unchanged.status, 200, JSON.stringify(unchanged.json));
          const before = await prisma.incident.findUnique({
            where: { id: row.id },
            include: { reportes: true },
          });
          assert.equal(before.estado, "VALIDADO");
          assert.equal(before.evaluacion, "AGENTE");
          assert.equal(before.publicado, true);
          assert.equal(before.reportes[0].estado, "VALIDADO");

          const converted = await request(
            `/admin/incidents/${row.id}/classify`,
            classifier,
            {
              tipoId: extorsion.id,
              motivo: "Las pruebas corresponden a otro tipo de delito",
            },
          );
          assert.equal(converted.status, 200, JSON.stringify(converted.json));
          const after = await prisma.incident.findUnique({
            where: { id: row.id },
            include: { reportes: { include: { adjuntos: true } } },
          });
          assert.equal(after.tipoId, extorsion.id);
          assert.equal(after.estado, "PENDIENTE");
          assert.equal(after.evaluacion, "PENDIENTE");
          assert.equal(after.publicado, false);
          assert.equal(after.nivelRiesgo, null);
          assert.equal(after.reportes[0].tipoId, extorsion.id);
          assert.equal(after.reportes[0].estado, "EN_REVISION");
          assert.equal(after.reportes[0].adjuntos[0].privado, true);
          assert.equal(
            (
              await request(`/admin/incidents/${row.id}/review`, classifier, {
                accion: "VALIDAR",
                nivelRiesgo: 3,
                motivo: "Clasificar no concede validación",
              })
            ).status,
            403,
          );
        },
      );
      await t.test(
        "Falsedad y validación requieren el permiso separado de pruebas privadas",
        async () => {
          const row = await incident({ type: robo, evidence: true });
          const sanction = await actor("AGENTE", ["falsedad"]);
          const list = await request("/admin/incidents", sanction);
          assert.equal(
            list.json.find((item) => item.id === row.id).adjuntos.length,
            0,
          );
          const input = {
            accion: "FALSO",
            motivo: "Pruebas revisadas individualmente",
          };
          assert.equal(
            (
              await request(
                `/admin/reports/${row.reportes[0].id}/review`,
                sanction,
                input,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                `/admin/incidents/${row.id}/review`,
                sanction,
                input,
              )
            ).status,
            403,
          );
          await prisma.user.update({
            where: { id: sanction.id },
            data: { permisos: ["falsedad", "evidencia"] },
          });
          const reviewed = await request(
            `/admin/reports/${row.reportes[0].id}/review`,
            sanction,
            input,
          );
          assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json));
          assert.equal(
            (await prisma.user.findUnique({ where: { id: owner.id } })).faltas,
            1,
          );
          assert.equal(
            (
              await request(
                `/admin/reports/${row.reportes[0].id}/review`,
                sanction,
                input,
              )
            ).status,
            409,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: owner.id } })).faltas,
            1,
          );
          assert.equal(
            (
              await request(`/admin/incidents/${local.id}/review`, sanction, {
                accion: "RETIRAR_PUNTOS",
                motivo: "No es atribución del agente",
              })
            ).status,
            403,
          );
          const privatePending = await incident({ type: robo, evidence: true });
          const validator = await actor("AGENTE", ["validar"]);
          assert.equal(
            (
              await request(
                `/admin/reports/${privatePending.reportes[0].id}/review`,
                validator,
                {
                  accion: "VALIDAR",
                  nivelRiesgo: 3,
                  motivo: "Necesita evidencia separada",
                },
              )
            ).status,
            403,
          );
          await prisma.user.update({
            where: { id: validator.id },
            data: { permisos: ["validar", "evidencia"] },
          });
          assert.equal(
            (
              await request(
                `/admin/reports/${privatePending.reportes[0].id}/review`,
                validator,
                {
                  accion: "VALIDAR",
                  nivelRiesgo: 3,
                  motivo: "Pruebas comprobadas por agente",
                },
              )
            ).status,
            200,
          );
          const privateCommunity = await incident({ evidence: true });
          const communityValidator = await actor("AGENTE", ["validar"]);
          assert.equal(
            (
              await request(
                `/admin/incidents/${privateCommunity.id}/review`,
                communityValidator,
                {
                  accion: "VALIDAR",
                  nivelRiesgo: 3,
                  motivo: "Aporte pendiente contiene evidencia",
                },
              )
            ).status,
            403,
          );
        },
      );
      await t.test(
        "Avisos y moderación tienen decisiones reales y restauración auditada",
        async () => {
          const flag = await prisma.flag.create({
            data: {
              usuarioId: owner.id,
              incidenteId: local.id,
              tipo: "FALSO",
              motivo: "Solicito comprobar el aporte",
            },
          });
          assert.equal(
            (
              await request(
                `/admin/incidents/${local.id}/flags/${flag.id}/review`,
                reader,
                { motivo: "Aviso revisado con el autor" },
              )
            ).status,
            403,
          );
          const handler = await actor("AGENTE", ["avisos"]);
          assert.equal(
            (
              await request(
                `/admin/incidents/${local.id}/flags/${flag.id}/review`,
                handler,
                { motivo: "Aviso revisado con el autor" },
              )
            ).status,
            200,
          );
          const moderator = await actor("AGENTE", ["moderar"]);
          const message = await prisma.chatMessage.create({
            data: {
              usuarioId: owner.id,
              incidenteId: local.id,
              mensaje: "Texto original que requiere revisión",
            },
          });
          const route = `/admin/incidents/${local.id}/messages/${message.id}/moderate`;
          assert.equal(
            (
              await request(route, reader, {
                accion: "RETIRAR",
                motivo: "Contenido inapropiado comprobado",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                `/admin/incidents/${remote.id}/messages/${message.id}/moderate`,
                moderator,
                {
                  accion: "RETIRAR",
                  motivo: "Contenido inapropiado comprobado",
                },
              )
            ).status,
            403,
          );
          const removed = await request(route, moderator, {
            accion: "RETIRAR",
            motivo: "Contenido inapropiado comprobado",
          });
          assert.equal(removed.status, 200);
          assert.equal(removed.json.retirado, true);
          const messages = await request(
            `/admin/incidents/${local.id}/messages`,
            reader,
          );
          assert.equal(messages.status, 200);
          assert.equal(messages.json[0].retirado, true);
          assert(!JSON.stringify(messages.json).includes(message.mensaje));
          const list = await request("/admin/incidents", moderator);
          assert(
            !JSON.stringify(
              list.json.find((row) => row.id === local.id).revisiones,
            ).includes(message.mensaje),
          );
          assert.equal(
            (
              await request(route, moderator, {
                accion: "RETIRAR",
                motivo: "Contenido inapropiado comprobado",
              })
            ).status,
            409,
          );
          const restored = await request(route, moderator, {
            accion: "RESTAURAR",
            motivo: "La revisión permite restaurarlo",
          });
          assert.equal(restored.status, 200);
          assert.equal(restored.json.mensaje, message.mensaje);
          assert.equal(restored.json.retirado, false);
          assert.equal(
            await prisma.auditLog.count({
              where: { entidad: "MENSAJE", entidadId: String(message.id) },
            }),
            2,
          );
        },
      );
      await t.test(
        "Administrar permisos conserva cuentas anteriores y revoca decisiones inmediatamente",
        async () => {
          const legacy = await actor("AGENTE", ["revisar"]);
          const me = await request("/users/me", legacy);
          assert(me.json.usuario.permisos.includes("validar"));
          assert(!me.json.usuario.permisos.includes("moderar"));
          const assigned = await request(
            `/admin/users/${legacy.id}`,
            admin,
            { permisos: ["gravedad"] },
            "PATCH",
          );
          assert.equal(assigned.status, 200);
          assert.deepEqual(assigned.json.usuario.permisos, [
            "consultar",
            "gravedad",
          ]);
          assert.equal(
            (
              await request(`/admin/incidents/${local.id}/review`, legacy, {
                accion: "VALIDAR",
                nivelRiesgo: 3,
                motivo: "Permiso previamente revocado",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                `/admin/users/${legacy.id}`,
                admin,
                { permisos: ["usuarios"] },
                "PATCH",
              )
            ).status,
            400,
          );
          const disabled = await request(
            `/admin/users/${legacy.id}`,
            admin,
            { rol: "USUARIO" },
            "PATCH",
          );
          assert.equal(disabled.status, 200);
          assert.deepEqual(disabled.json.usuario.permisos, []);
          assert.equal(disabled.json.usuario.tipoAgente, null);
          assert.equal((await request("/admin/incidents", legacy)).status, 403);
        },
      );
    } finally {
      const incidentWhere = { incidenteId: { in: incidents } };
      await prisma.attachment.deleteMany({
        where: { usuarioId: { in: users } },
      });
      for (const model of ["review", "flag", "chatMessage", "vote"])
        await prisma[model].deleteMany({ where: incidentWhere });
      await prisma.report.deleteMany({ where: incidentWhere });
      await prisma.incident.deleteMany({ where: { id: { in: incidents } } });
      await prisma.notification.deleteMany({
        where: { usuarioId: { in: users } },
      });
      await prisma.pointEvent.deleteMany({
        where: { usuarioId: { in: users } },
      });
      await prisma.auditLog.deleteMany({ where: { usuarioId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await new Promise((resolve) => server.close(resolve));
      await prisma.$disconnect();
    }
  },
);
