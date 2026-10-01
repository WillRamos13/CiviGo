const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const connection = process.env.TEST_DATABASE_URL;
const enabled = !!connection;
if (enabled) {
  const u = new URL(connection);
  if (
    !["127.0.0.1", "localhost"].includes(u.hostname) &&
    process.env.ALLOW_REMOTE_TESTS !== "true"
  )
    throw new Error(
      "Las pruebas remotas requieren ALLOW_REMOTE_TESTS=true y una base de prueba autorizada.",
    );
  const dbUrl = new URL(connection);
  dbUrl.searchParams.set("pgbouncer", "true");
  dbUrl.searchParams.set("statement_cache_size", "0");
  process.env.DATABASE_URL = dbUrl.toString();
  process.env.DEMO_VERIFICATION = "true";
  process.env.NODE_ENV = "test";
  process.env.ENABLE_JOBS = "false";
  process.env.UPLOAD_DIR = path.join(__dirname, "../.test-uploads");
  delete process.env.AI_API_KEY;
}
test(
  "Integración HTTP real: cuentas, archivos, reportes, votos, revisión, premios y anuncios",
  { skip: !enabled },
  async (t) => {
    const prisma = require("../src/lib/db");
    const app = require("../src/server");
    const { seedCatalog } = require("../src/lib/catalog");
    const { hashPassword } = require("../src/lib/password");
    const { processLifecycle } = require("../src/lib/lifecycle");
    await seedCatalog();
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = "http://127.0.0.1:" + server.address().port + "/api";
    const run = crypto.randomBytes(5).toString("hex");
    const users = [];
    const uploadIds = [];
    const incidentIds = [];
    const rewardIds = [];
    const businessIds = [];
    const password = "Contraseña prueba HTTP 2026";
    async function request(route, { method = "GET", body, cookie, form } = {}) {
      const r = await fetch(base + route, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: form || (body ? JSON.stringify(body) : undefined),
      });
      const json = r.headers.get("content-type")?.includes("application/json")
        ? await r.json()
        : null;
      return {
        status: r.status,
        json,
        cookie: r.headers.get("set-cookie")?.split(";")[0],
      };
    }
    async function actor(label, role = "USUARIO", district = null) {
      const registered = await request("/users/register", {
        method: "POST",
        body: {
          nombre: "Prueba",
          apellidos: "Integración",
          nickname: run + "_" + label,
          correo: run + "_" + label + "@tests.civigo.local",
          telefono: "+519" + String(crypto.randomInt(10000000, 99999999)),
          password,
          fechaNacimiento: "2000-01-01",
        },
      });
      assert.equal(registered.status, 201, JSON.stringify(registered.json));
      users.push(registered.json.usuario.id);
      const a = { id: registered.json.usuario.id, cookie: registered.cookie };
      if (role !== "USUARIO")
        await prisma.user.update({
          where: { id: a.id },
          data: {
            rol: role,
            distrito: district,
            tipoAgente: role === "AGENTE" ? "SERENAZGO" : null,
            permisos:
              role === "AGENTE"
                ? ["revisar", "evidencia", "resolver", "reabrir"]
                : [],
          },
        });
      return a;
    }
    async function verify(a) {
      const code = await request("/users/phone/request", {
        method: "POST",
        cookie: a.cookie,
        body: {},
      });
      assert.equal(code.status, 200);
      assert.equal(code.json.modo, "demo");
      const result = await request("/users/phone/verify", {
        method: "POST",
        cookie: a.cookie,
        body: { codigo: code.json.codigoDemo },
      });
      assert.equal(result.status, 200);
    }
    const p = { latitud: -14.06777, longitud: -75.7286 };
    async function postReport(a, tipo, extra = {}) {
      const r = await request("/reports", {
        method: "POST",
        cookie: a.cookie,
        body: {
          tipo,
          descripcion:
            "Hecho de prueba de integración, no es un incidente real.",
          ...p,
          gpsLatitud: p.latitud,
          gpsLongitud: p.longitud,
          fechaEvento: new Date().toISOString(),
          ...extra,
        },
      });
      if (r.status === 201) incidentIds.push(r.json.incidente.id);
      return r;
    }
    try {
      const admin = await actor("admin", "ADMIN"),
        agent = await actor("agent", "AGENTE", "Parcona");
      const actors = [];
      for (let i = 0; i < 6; i++) actors.push(await actor("u" + i));
      await t.test(
        "Sesiones reales, edad, contraseña protegida y teléfono requerido",
        async () => {
          assert.equal((await request("/users/me")).status, 401);
          const me = await request("/users/me", { cookie: actors[0].cookie });
          assert.equal(me.json.usuario.password, undefined);
          assert.equal((await postReport(actors[0], "robo")).status, 403);
          assert.equal(
            (
              await request("/users/register", {
                method: "POST",
                body: {
                  nombre: "A",
                  apellidos: "B",
                  nickname: "menor_" + run,
                  correo: run + "@test.local",
                  telefono: "+51999999001",
                  password,
                  fechaNacimiento: new Date().toISOString(),
                },
              })
            ).status,
            400,
          );
          const stored = await prisma.user.findUnique({
            where: { id: actors[0].id },
          });
          assert.notEqual(stored.password, password);
          for (const a of [admin, agent, ...actors]) await verify(a);
        },
      );
      let grouped, privateOne, privateTwo;
      await t.test(
        "Agrupación de emergencia, confianza gradual y confirmaciones únicas",
        async () => {
          const first = await postReport(actors[0], "persona-sospechosa");
          assert.equal(first.status, 201, JSON.stringify(first.json));
          grouped = first.json.incidente.id;
          assert.equal(first.json.incidente.nivelRiesgo, null);
          assert.equal(first.json.incidente.publicado, true);
          const second = await postReport(actors[1], "persona-sospechosa");
          assert.equal(second.status, 201);
          assert.equal(second.json.incidente.id, grouped);
          assert(Math.abs(second.json.incidente.validacion - 2 / 3) < 1e-8);
          const duplicate = await request(
            "/incidents/" + grouped + "/confirmar",
            { method: "POST", cookie: actors[1].cookie, body: p },
          );
          assert.equal(duplicate.status, 409);
          assert.equal(
            (
              await request("/incidents/" + grouped + "/confirmar", {
                method: "POST",
                cookie: actors[0].cookie,
                body: p,
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await request("/incidents/" + grouped + "/confirmar", {
                method: "POST",
                cookie: actors[2].cookie,
                body: { latitud: -14.1, longitud: -75.7 },
              })
            ).status,
            403,
          );
          const third = await postReport(actors[2], "persona-sospechosa");
          assert.equal(third.status, 201);
          assert(Math.abs(third.json.incidente.validacion - 5 / 6) < 1e-8);
          const fourth = await request("/incidents/" + grouped + "/confirmar", {
            method: "POST",
            cookie: actors[3].cookie,
            body: p,
          });
          assert.equal(fourth.status, 200);
          assert.equal(fourth.json.validacion, 1);
        },
      );
      await t.test(
        "Delitos individuales no se agrupan ni admiten votos",
        async () => {
          privateOne = await postReport(actors[0], "robo");
          privateTwo = await postReport(actors[1], "robo");
          assert.equal(privateOne.status, 201);
          assert.equal(privateTwo.status, 201);
          assert.notEqual(
            privateOne.json.incidente.id,
            privateTwo.json.incidente.id,
          );
          assert.equal(privateOne.json.incidente.publicado, false);
          const review = await request(
            "/admin/incidents/" + privateOne.json.incidente.id + "/review",
            {
              method: "POST",
              cookie: admin.cookie,
              body: {
                accion: "VALIDAR",
                nivelRiesgo: 4,
                motivo: "Pruebas revisadas para el ensayo de integración",
              },
            },
          );
          assert.equal(review.status, 200, JSON.stringify(review.json));
          assert.equal(
            (
              await request(
                "/incidents/" + privateOne.json.incidente.id + "/confirmar",
                { method: "POST", cookie: actors[2].cookie, body: p },
              )
            ).status,
            400,
          );
        },
      );
      await t.test(
        "Pruebas privadas solo autor y revisor autorizado; firmas de archivo reales",
        async () => {
          const f = new FormData();
          f.append(
            "archivo",
            new Blob(["%PDF-1.7\nPrueba privada de integración"], {
              type: "application/pdf",
            }),
            "prueba.pdf",
          );
          f.append("privado", "true");
          f.append("tipo", "EVIDENCIA");
          const uploaded = await request("/uploads", {
            method: "POST",
            cookie: actors[0].cookie,
            form: f,
          });
          assert.equal(uploaded.status, 201, JSON.stringify(uploaded.json));
          uploadIds.push(uploaded.json.id);
          assert.equal(
            (
              await request(
                "/reports/" + privateOne.json.reporte.id + "/evidence",
                {
                  method: "POST",
                  cookie: actors[0].cookie,
                  body: { adjuntosIds: [uploaded.json.id] },
                },
              )
            ).status,
            200,
          );
          assert.equal(
            (await request("/uploads/" + uploaded.json.id)).status,
            403,
          );
          assert.equal(
            (
              await request("/uploads/" + uploaded.json.id, {
                cookie: actors[1].cookie,
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request("/uploads/" + uploaded.json.id, {
                cookie: admin.cookie,
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await request("/uploads/" + uploaded.json.id, {
                cookie: agent.cookie,
              })
            ).status,
            403,
          );
          const pub = await request(
            "/incidents/" + privateOne.json.incidente.id,
          );
          assert.equal(pub.json.adjuntos.length, 0);
          const mov = new FormData();
          const ftyp = Buffer.alloc(16);
          ftyp.writeUInt32BE(16);
          ftyp.write("ftyp", 4);
          ftyp.write("qt  ", 8);
          const moov = Buffer.alloc(8);
          moov.writeUInt32BE(36);
          moov.write("moov", 4);
          const mvhd = Buffer.alloc(28);
          mvhd.writeUInt32BE(28);
          mvhd.write("mvhd", 4);
          mvhd.writeUInt32BE(1000, 20);
          mvhd.writeUInt32BE(12000, 24);
          mov.append(
            "archivo",
            new Blob([Buffer.concat([ftyp, moov, mvhd])], {
              type: "video/quicktime",
            }),
            "camara.mov",
          );
          const camera = await request("/uploads", {
            method: "POST",
            cookie: actors[0].cookie,
            form: mov,
          });
          assert.equal(camera.status, 201, JSON.stringify(camera.json));
          uploadIds.push(camera.json.id);
          const spoof = new FormData();
          spoof.append(
            "archivo",
            new Blob(["<script>bad</script>"], { type: "image/png" }),
            "fake.png",
          );
          assert.equal(
            (
              await request("/uploads", {
                method: "POST",
                cookie: actors[0].cookie,
                form: spoof,
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "Distrito, corrección humana prevalente y control de spam",
        async () => {
          assert.equal(
            (
              await request("/admin/incidents/" + grouped + "/review", {
                method: "POST",
                cookie: agent.cookie,
                body: {
                  accion: "VALIDAR",
                  nivelRiesgo: 4,
                  motivo: "Revisión de otra jurisdicción",
                },
              })
            ).status,
            403,
          );
          const review = await request(
            "/admin/incidents/" + grouped + "/review",
            {
              method: "POST",
              cookie: admin.cookie,
              body: {
                accion: "VALIDAR",
                nivelRiesgo: 4,
                motivo: "Evaluación humana documentada para prueba",
              },
            },
          );
          assert.equal(review.status, 200);
          const chat = await request("/incidents/" + grouped + "/chat", {
            method: "POST",
            cookie: actors[0].cookie,
            body: { mensaje: "Mensaje único de prueba" },
          });
          assert.equal(chat.status, 201);
          assert.equal(
            (
              await request("/incidents/" + grouped + "/chat", {
                method: "POST",
                cookie: actors[0].cookie,
                body: { mensaje: "Mensaje único de prueba" },
              })
            ).status,
            429,
          );
          const fifth = await postReport(actors[4], "persona-sospechosa");
          assert.equal(fifth.status, 201);
          assert.equal(fifth.json.incidente.nivelRiesgo, 4);
        },
      );
      await t.test(
        "Resolución por cinco personas, cierre y reapertura autorizada",
        async () => {
          for (const a of actors.slice(0, 5)) {
            const r = await request("/incidents/" + grouped + "/resolver", {
              method: "POST",
              cookie: a.cookie,
              body: p,
            });
            assert.equal(r.status, 200);
          }
          const resolved = await prisma.incident.findUnique({
            where: { id: grouped },
          });
          assert.equal(resolved.estado, "RESUELTO");
          assert.equal(resolved.publicado, false);
          assert.equal(
            (
              await request("/incidents/" + grouped + "/chat", {
                method: "POST",
                cookie: actors[0].cookie,
                body: { mensaje: "No debe entrar" },
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await request("/admin/incidents/" + grouped + "/review", {
                method: "POST",
                cookie: admin.cookie,
                body: {
                  accion: "REABRIR",
                  motivo: "Reapertura comprobada en integración",
                },
              })
            ).status,
            200,
          );
          assert.equal(
            await prisma.vote.count({
              where: { incidenteId: grouped, tipo: "RESOLVER" },
            }),
            0,
          );
        },
      );
      await t.test(
        "Falsedad requiere revisión, apelación y cuarta falta bloquea",
        async () => {
          const r = await request(
            "/admin/incidents/" + privateOne.json.incidente.id + "/review",
            {
              method: "POST",
              cookie: admin.cookie,
              body: {
                accion: "FALSO",
                motivo: "Falsedad confirmada únicamente para ensayo",
              },
            },
          );
          assert.equal(r.status, 200);
          assert.equal(
            (await prisma.user.findUnique({ where: { id: actors[0].id } }))
              .faltas,
            1,
          );
          const appeal = await request(
            "/reports/" + privateOne.json.reporte.id + "/appeal",
            {
              method: "POST",
              cookie: actors[0].cookie,
              body: { motivo: "Solicito revisar esta decisión de prueba" },
            },
          );
          assert.equal(appeal.status, 201);
          assert.equal(
            (
              await request("/admin/appeals/" + appeal.json.id, {
                method: "POST",
                cookie: admin.cookie,
                body: {
                  estado: "ACEPTADA",
                  respuesta: "Se revierte la decisión para el ensayo",
                },
              })
            ).status,
            200,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: actors[0].id } }))
              .faltas,
            0,
          );
        },
      );
      await t.test(
        "Ranking mensual, canje demo sin saldo negativo e inventario",
        async () => {
          const rank = await request("/ranking");
          assert.equal(rank.status, 200);
          assert(
            rank.json.entries.some(
              (e) => e.nickname === run + "_u1" && e.puntos >= 7.5,
            ),
          );
          const reward = await prisma.reward.create({
            data: {
              nombre: "Premio demo integración " + run,
              descripcion: "No constituye entrega real",
              costoMonedas: 10,
              stock: 1,
            },
          });
          rewardIds.push(reward.id);
          await prisma.user.update({
            where: { id: actors[1].id },
            data: { monedas: 10 },
          });
          const canje = await request(
            "/recompensas/" + reward.id + "/canjear",
            { method: "POST", cookie: actors[1].cookie, body: {} },
          );
          assert.equal(canje.status, 201);
          assert.equal(canje.json.estado, "SOLICITADO_DEMO");
          assert.equal(
            (
              await request("/recompensas/" + reward.id + "/canjear", {
                method: "POST",
                cookie: actors[2].cookie,
                body: {},
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await request("/admin/redemptions/" + canje.json.id, {
                method: "POST",
                cookie: admin.cookie,
                body: { estado: "CANCELADO" },
              })
            ).status,
            200,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: actors[1].id } }))
              .monedas,
            10,
          );
          assert.equal(
            (await prisma.reward.findUnique({ where: { id: reward.id } }))
              .stock,
            1,
          );
        },
      );
      await t.test(
        "Publicidad solo cerca del negocio e impresión única por recorrido",
        async () => {
          const b = await prisma.business.create({
            data: {
              nombre: "Negocio demo " + run,
              descripcion: "Demostración",
              direccion: "Ubicación de prueba",
              ...p,
            },
          });
          businessIds.push(b.id);
          assert.equal(
            (
              await request("/businesses/" + b.id + "/impressions", {
                method: "POST",
                cookie: actors[0].cookie,
                body: { latitud: -14.1, longitud: -75.7, recorridoId: run },
              })
            ).status,
            400,
          );
          for (let i = 0; i < 2; i++)
            assert.equal(
              (
                await request("/businesses/" + b.id + "/impressions", {
                  method: "POST",
                  cookie: actors[0].cookie,
                  body: { ...p, recorridoId: run },
                })
              ).status,
              200,
            );
          assert.equal(
            await prisma.adImpression.count({ where: { negocioId: b.id } }),
            1,
          );
        },
      );
      await t.test(
        "Caducidad de pruebas y rutas reales con cuenta sin exigir teléfono",
        async () => {
          await prisma.report.update({
            where: { id: privateTwo.json.reporte.id },
            data: { fechaCreacion: new Date(Date.now() - 8 * 86400000) },
          });
          await prisma.incident.update({
            where: { id: privateTwo.json.incidente.id },
            data: {
              publicado: true,
              estado: "ACTIVO",
              nivelRiesgo: 4,
              evaluacion: "IA",
              fechaCreacion: new Date(Date.now() - 8 * 86400000),
              fechaPublicacion: new Date(Date.now() - 8 * 86400000),
            },
          });
          await processLifecycle();
          assert.equal(
            (
              await prisma.incident.findUnique({
                where: { id: privateTwo.json.incidente.id },
              })
            ).estado,
            "RETIRADO",
          );
          const reopened = await request(
            "/admin/incidents/" + privateTwo.json.incidente.id + "/review",
            {
              method: "POST",
              cookie: admin.cookie,
              body: {
                accion: "REABRIR",
                motivo:
                  "Reapertura con una nueva ventana para presentar pruebas",
              },
            },
          );
          assert.equal(reopened.status, 200, JSON.stringify(reopened.json));
          assert.equal(reopened.json.chatAbierto, true);
          assert.equal(reopened.json.validacion, 0.5);
          assert.ok(
            +new Date(reopened.json.fechaPublicacion) > Date.now() - 60000,
          );
          await processLifecycle();
          assert.equal(
            (
              await prisma.incident.findUnique({
                where: { id: privateTwo.json.incidente.id },
              })
            ).estado,
            "ACTIVO",
          );
          const r = await request("/navigation/plan", {
            method: "POST",
            cookie: actors[5].cookie,
            body: {
              origen: p,
              destino: { latitud: -14.074, longitud: -75.725 },
              modo: "walking",
            },
          });
          assert.equal(r.status, 200, JSON.stringify(r.json));
          assert(r.json.rutas.length >= 1);
        },
      );
    } finally {
      try {
        const ids = [...new Set(incidentIds)];
        await prisma.adImpression.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.redemption.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.attachment.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.appeal.deleteMany({ where: { usuarioId: { in: users } } });
        await prisma.recovery.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.vote.deleteMany({ where: { usuarioId: { in: users } } });
        await prisma.chatMessage.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.flag.deleteMany({ where: { usuarioId: { in: users } } });
        await prisma.review.deleteMany({ where: { usuarioId: { in: users } } });
        await prisma.notification.deleteMany({
          where: {
            OR: [{ usuarioId: { in: users } }, { incidenteId: { in: ids } }],
          },
        });
        await prisma.pointEvent.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.auditLog.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.routeFavorite.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.routeHistory.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.report.deleteMany({ where: { usuarioId: { in: users } } });
        await prisma.incident.deleteMany({ where: { id: { in: ids } } });
        await prisma.reward.deleteMany({ where: { id: { in: rewardIds } } });
        await prisma.business.deleteMany({
          where: { id: { in: businessIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: users } } });
        for (const filename of uploadIds)
          await fs.promises
            .unlink(path.join(process.env.UPLOAD_DIR, filename))
            .catch(() => {});
      } catch (cleanupError) {
        console.error(
          "Limpieza local pendiente:",
          cleanupError.code || cleanupError.name,
        );
      } finally {
        await new Promise((r) => server.close(r));
        await prisma.$disconnect();
      }
    }
  },
);
