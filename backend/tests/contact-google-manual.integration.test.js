const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { HttpError } = require("../src/lib/http");

const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  require("./helpers/provider-environment").disableExternalProviders();
  const url = new URL(connection);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error(
      "Esta integración de contactos requiere una base local aislada.",
    );
  url.searchParams.set("pgbouncer", "true");
  url.searchParams.set("statement_cache_size", "0");
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = "test";
  process.env.DEMO_VERIFICATION = "false";
  process.env.PHONE_VERIFICATION_PROVIDER = "whatsapp-manual";
  process.env.WHATSAPP_VERIFICATION_NUMBER = "+51900000009";
  process.env.FIREBASE_PROJECT_ID = "civigo-fixture";
  delete process.env.TRUST_PROXY;
}

test(
  "Contactos HTTP y base local: WhatsApp revisado por administrador y correo mediante Google",
  { skip: !connection },
  async (t) => {
    const prisma = require("../src/lib/db");
    const providers = require("../src/lib/providers");
    const { hashToken } = require("../src/lib/auth");
    const userIds = [];
    const calls = [];
    const run = crypto.randomBytes(6).toString("hex");
    const nextPhone = () =>
      "+519" + String(crypto.randomInt(10000000, 99999999));
    const proof = (value) =>
      crypto
        .createHash("sha256")
        .update("fixture-google:" + value)
        .digest("hex");
    let verifier = async (token) => ({ proofHash: proof(token) });
    t.mock.method(providers, "verifyFirebaseEmail", async (...args) => {
      calls.push(args);
      return verifier(...args);
    });
    const originalFetch = global.fetch;
    t.mock.method(global, "fetch", (input, options) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(
        url.protocol,
        "http:",
        "La integración no llama proveedores reales.",
      );
      assert.equal(
        url.hostname,
        "127.0.0.1",
        "Sólo se permite HTTP local de prueba.",
      );
      return originalFetch(input, options);
    });
    const app = require("../src/server");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = "http://127.0.0.1:" + server.address().port + "/api";
    async function request(route, who, body) {
      const response = await fetch(base + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(who ? { Cookie: who.cookie } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    }
    async function sessionCookie(userId) {
      const session = crypto.randomBytes(32).toString("hex");
      await prisma.session.create({
        data: {
          id: hashToken(session),
          usuarioId: userId,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return "civigo_session=" + session;
    }
    async function actor(label, rol = "USUARIO") {
      const user = await prisma.user.create({
        data: {
          nombreUsuario: run + "_" + label,
          nombres: "Prueba",
          apellidos: "Contactos locales",
          correo: run + "_" + label + "@gmail.com",
          telefono: nextPhone(),
          password: "scrypt$fixture_without_password_login",
          telefonoVerificado: false,
          correoVerificado: false,
          rol,
        },
      });
      userIds.push(user.id);
      return { ...user, cookie: await sessionCookie(user.id) };
    }
    const storedUser = (who) =>
      prisma.user.findUnique({ where: { id: who.id } });
    const storedChallenge = (current) =>
      prisma.verification.findUnique({ where: { id: current.id } });
    async function phoneChallenge(who) {
      const result = await request("/users/phone/request", who, {
        canal: "whatsapp",
      });
      assert.equal(result.status, 200, JSON.stringify(result.json));
      const url = new URL(result.json.whatsappUrl);
      assert.equal(url.origin, "https://wa.me");
      assert.equal(url.pathname, "/51900000009");
      const code = url.searchParams
        .get("text")
        ?.match(/\b[a-f0-9]{24}\b/i)?.[0];
      assert.ok(
        code,
        "El mensaje de WhatsApp contiene el código aleatorio de la solicitud.",
      );
      const row = await prisma.verification.findFirst({
        where: { usuarioId: who.id, tipo: "TELEFONO_WHATSAPP", usado: false },
        orderBy: { id: "desc" },
      });
      assert.ok(row);
      assert.equal(row.destino, who.telefono);
      assert.equal(row.codigoHash, hashToken(code));
      assert.ok(row.expiresAt > new Date());
      assert.ok(Math.abs(+row.expiresAt - +row.creadoEn - 86400000) < 5000);
      assert.equal(result.json.codigoDemo, undefined);
      return { ...row, code };
    }
    async function emailChallenge(who) {
      const result = await request("/users/email/google/request", who, {});
      assert.equal(result.status, 200, JSON.stringify(result.json));
      assert.match(result.json.challengeId, /^[1-9]\d*$/);
      const row = await prisma.verification.findUnique({
        where: { id: Number(result.json.challengeId) },
      });
      assert.equal(row.usuarioId, who.id);
      assert.equal(row.tipo, "CORREO_GOOGLE");
      assert.equal(row.destino, who.correo);
      assert.equal(row.usado, false);
      assert.ok(Math.abs(+row.expiresAt - +row.creadoEn - 600000) < 5000);
      return { ...row, challengeId: result.json.challengeId };
    }
    const verifyEmail = (
      who,
      current,
      token = "fixture-google-token-not-a-real-provider-credential",
    ) =>
      request("/users/email/google/verify", who, {
        challengeId: current.challengeId,
        idToken: token,
      });
    const approve = (admin, who, current, extra = {}) =>
      request(`/admin/phone-verifications/${current.id}/approve`, admin, {
        codigo: current.code,
        telefonoRemitente: who.telefono,
        ...extra,
      });
    function rejected(result) {
      assert.ok(
        result.status >= 400 && result.status < 500,
        JSON.stringify(result),
      );
    }

    try {
      const admin = await actor("admin", "ADMIN");
      const user = await actor("owner");
      const other = await actor("other");
      let phone;
      await t.test(
        "Las comprobaciones de contacto requieren sesión y el administrador controla la bandeja",
        async () => {
          assert.equal((await request("/users/phone/config")).status, 401);
          assert.equal(
            (await request("/users/email/google/config")).status,
            401,
          );
          assert.equal(
            (await request("/users/email/google/request", null, {})).status,
            401,
          );
          assert.equal(
            (await request("/users/phone/request", null, {})).status,
            401,
          );
          assert.equal(
            (await request("/admin/phone-verifications", user)).status,
            403,
          );
          const config = await request("/users/phone/config", user);
          assert.equal(config.status, 200);
          assert.equal(config.json.proveedor, "whatsapp-manual");
          assert.equal(config.json.configurado, true);
          const google = await request("/users/email/google/config", user);
          assert.equal(google.status, 200);
          assert.equal(google.json.projectId, "civigo-fixture");
          assert.equal(calls.length, 0);
        },
      );

      await t.test(
        "WhatsApp prepara una solicitud con hash y no verifica ni envía mensajes automáticamente",
        async () => {
          rejected(
            await request("/users/phone/request", user, { canal: "sms" }),
          );
          assert.equal(
            await prisma.verification.count({ where: { usuarioId: user.id } }),
            0,
          );
          phone = await phoneChallenge(user);
          assert.equal((await storedUser(user)).telefonoVerificado, false);
          assert.equal(
            (await request("/users/phone/verify", user, { codigo: "123456" }))
              .status,
            409,
            "El antiguo endpoint SMS no aprueba solicitudes manuales.",
          );
          assert.equal(
            (await request("/users/phone/request", user, { canal: "whatsapp" }))
              .status,
            429,
          );
          const pending = await request("/admin/phone-verifications", admin);
          assert.equal(pending.status, 200);
          assert.ok(Array.isArray(pending.json));
          const entry = pending.json.find((item) => item.id === phone.id);
          assert.ok(entry);
          assert.equal(entry.usuario.id, user.id);
          assert.equal(entry.codigoHash, undefined);
          assert.ok(!JSON.stringify(pending.json).includes(phone.code));
          assert.equal(calls.length, 0);
        },
      );

      await t.test(
        "Sólo ADMIN puede aprobar y el remitente, el código y el dueño deben coincidir",
        async () => {
          assert.equal((await approve(other, user, phone)).status, 403);
          rejected(
            await approve(admin, user, phone, { codigo: "0".repeat(24) }),
          );
          rejected(
            await approve(admin, user, phone, {
              telefonoRemitente: other.telefono,
            }),
          );
          const otherPhone = await phoneChallenge(other);
          rejected(
            await approve(admin, other, otherPhone, { codigo: phone.code }),
          );
          assert.equal((await storedChallenge(phone)).usado, false);
          assert.equal((await storedUser(user)).telefonoVerificado, false);
          assert.equal((await storedUser(other)).telefonoVerificado, false);
        },
      );

      await t.test(
        "La aprobación manual consume una vez, registra auditoría y conserva la sesión",
        async () => {
          const before = await prisma.auditLog.count({
            where: { usuarioId: admin.id },
          });
          const result = await approve(admin, user, phone);
          assert.equal(result.status, 200, JSON.stringify(result.json));
          assert.equal((await storedUser(user)).telefonoVerificado, true);
          assert.equal((await storedChallenge(phone)).usado, true);
          assert.equal(
            await prisma.auditLog.count({ where: { usuarioId: admin.id } }),
            before + 1,
          );
          rejected(await approve(admin, user, phone));
          assert.equal(
            await prisma.auditLog.count({ where: { usuarioId: admin.id } }),
            before + 1,
          );
          assert.equal(
            (await request("/users/me", user)).json.usuario.telefonoVerificado,
            true,
          );
          assert.equal(
            await prisma.session.count({ where: { usuarioId: user.id } }),
            1,
          );
        },
      );

      await t.test(
        "La solicitud vencida, un teléfono cambiado o una cuenta bloqueada no se aprueban",
        async () => {
          for (const condition of ["expired", "changed", "blocked"]) {
            const who = await actor("phone_" + condition);
            const current = await phoneChallenge(who);
            if (condition === "expired")
              await prisma.verification.update({
                where: { id: current.id },
                data: { expiresAt: new Date(Date.now() - 1000) },
              });
            else
              await prisma.user.update({
                where: { id: who.id },
                data:
                  condition === "changed"
                    ? { telefono: nextPhone() }
                    : { bloqueado: true },
              });
            rejected(await approve(admin, who, current));
            assert.equal((await storedUser(who)).telefonoVerificado, false);
            assert.equal((await storedChallenge(current)).usado, false);
          }
        },
      );

      await t.test(
        "Un administrador degradado o bloqueado tras el middleware no consume ni aprueba una solicitud",
        async (context) => {
          for (const condition of ["demoted", "blocked"]) {
            const approver = await actor("admin_" + condition, "ADMIN");
            const who = await actor("admin_race_" + condition);
            const current = await phoneChallenge(who);
            const originalTransaction = prisma.$transaction;
            // Prisma exposes this method through a dynamic proxy descriptor;
            // node:test can intercept a plain delegate, then the proxy forwards
            // to it until the finally block restores the original method.
            const transactionDelegate = {
              transaction: (...args) => originalTransaction.apply(prisma, args),
            };
            let changed = false;
            const intercepted = context.mock.method(
              transactionDelegate,
              "transaction",
              async (...args) => {
                if (!changed) {
                  changed = true;
                  await prisma.user.update({
                    where: { id: approver.id },
                    data:
                      condition === "demoted"
                        ? { rol: "USUARIO" }
                        : { bloqueado: true },
                  });
                }
                return originalTransaction.apply(prisma, args);
              },
            );
            prisma.$transaction = (...args) =>
              transactionDelegate.transaction(...args);
            try {
              const result = await approve(approver, who, current);
              assert.equal(
                changed,
                true,
                "El cambio ocurre después de autenticar al administrador.",
              );
              assert.equal(result.status, 403, JSON.stringify(result.json));
            } finally {
              prisma.$transaction = originalTransaction;
              intercepted.mock.restore();
            }
            assert.equal((await storedChallenge(current)).usado, false);
            assert.equal((await storedUser(who)).telefonoVerificado, false);
            assert.equal(
              await prisma.auditLog.count({
                where: { usuarioId: approver.id },
              }),
              0,
            );
          }
        },
      );

      await t.test(
        "La recuperación aceptada invalida códigos anteriores, revoca la sesión y libera la bandeja de solicitudes",
        async () => {
          const who = await actor("phone_recovery");
          const old = await phoneChallenge(who);
          const created = new Date(Date.now() - 2 * 3600000);
          const expires = new Date(+created + 86400000);
          await prisma.verification.update({
            where: { id: old.id },
            data: { creadoEn: created, expiresAt: expires },
          });
          await prisma.verification.createMany({
            data: Array.from({ length: 199 }, (_, n) => ({
              usuarioId: who.id,
              tipo: "TELEFONO_WHATSAPP",
              destino: who.telefono,
              codigoHash: hashToken("fixture-stale-whatsapp-" + n),
              creadoEn: created,
              expiresAt: expires,
            })),
          });
          const sms = await prisma.verification.create({
            data: {
              usuarioId: who.id,
              tipo: "TELEFONO",
              destino: who.telefono,
              codigoHash: hashToken("fixture-stale-sms"),
              expiresAt: new Date(Date.now() + 600000),
            },
          });
          const pendingEmail = await prisma.verification.create({
            data: {
              usuarioId: who.id,
              tipo: "CORREO_GOOGLE",
              destino: who.correo,
              codigoHash: hashToken(
                "fixture-email-not-related-to-phone-recovery",
              ),
              expiresAt: new Date(Date.now() + 600000),
            },
          });
          const waitingUser = await actor("phone_waiting_after_recovery");
          const waiting = await phoneChallenge(waitingUser);
          const newPhone = nextPhone();
          const recovery = await prisma.recovery.create({
            data: {
              usuarioId: who.id,
              telefonoNuevo: newPhone,
              motivo:
                "Recuperación de prueba local para comprobar la invalidación de códigos anteriores.",
            },
          });
          const result = await request(
            `/admin/recoveries/${recovery.id}`,
            admin,
            { estado: "ACEPTADA" },
          );
          assert.equal(result.status, 200, JSON.stringify(result.json));
          assert.equal(result.json.estado, "ACEPTADA");
          const changedUser = await storedUser(who);
          assert.equal(changedUser.telefono, newPhone);
          assert.equal(changedUser.telefonoVerificado, false);
          assert.equal(
            await prisma.session.count({ where: { usuarioId: who.id } }),
            0,
          );
          assert.equal((await request("/users/me", who)).status, 401);
          assert.equal(
            await prisma.verification.count({
              where: {
                usuarioId: who.id,
                tipo: "TELEFONO_WHATSAPP",
                usado: true,
              },
            }),
            200,
          );
          assert.equal((await storedChallenge(sms)).usado, true);
          assert.equal((await storedChallenge(pendingEmail)).usado, false);
          const list = await request("/admin/phone-verifications", admin);
          assert.equal(list.status, 200);
          assert.ok(!list.json.some((item) => item.usuario.id === who.id));
          assert.ok(
            list.json.some((item) => item.id === waiting.id),
            "Los códigos viejos no ocupan el límite de doscientas filas.",
          );
          rejected(await approve(admin, who, old));
          const recovered = {
            ...changedUser,
            cookie: await sessionCookie(who.id),
          };
          const fresh = await phoneChallenge(recovered);
          assert.equal(fresh.destino, newPhone);
          assert.equal(fresh.usado, false);
          assert.equal((await storedUser(recovered)).telefonoVerificado, false);
        },
      );

      await t.test(
        "Dos administradores concurrentes consumen una sola solicitud manual",
        async () => {
          const who = await actor("phone_concurrent");
          const current = await phoneChallenge(who);
          const secondAdmin = await actor("admin_second", "ADMIN");
          const before = await prisma.auditLog.count({
            where: { usuarioId: { in: [admin.id, secondAdmin.id] } },
          });
          const results = await Promise.all([
            approve(admin, who, current),
            approve(secondAdmin, who, current),
          ]);
          assert.equal(
            results.filter((result) => result.status === 200).length,
            1,
            JSON.stringify(results),
          );
          assert.equal(
            results.filter(
              (result) => result.status >= 400 && result.status < 500,
            ).length,
            1,
          );
          assert.equal((await storedChallenge(current)).usado, true);
          assert.equal((await storedUser(who)).telefonoVerificado, true);
          assert.equal(
            await prisma.auditLog.count({
              where: { usuarioId: { in: [admin.id, secondAdmin.id] } },
            }),
            before + 1,
          );
        },
      );

      let email;
      await t.test(
        "El desafío Google pertenece al correo de la sesión y otra cuenta no puede consumirlo",
        async () => {
          email = await emailChallenge(user);
          assert.equal(
            (await request("/users/email/google/request", user, {})).status,
            429,
          );
          const before = calls.length;
          rejected(await verifyEmail(other, email));
          assert.equal(calls.length, before);
          assert.equal((await storedChallenge(email)).intentos, 0);
          assert.equal((await storedUser(other)).correoVerificado, false);
        },
      );

      await t.test(
        "La prueba Google aprobada verifica el correo actual sin cambiar la sesión ni publicar tokens",
        async () => {
          const token = "fixture-google-approved-authentication-event-local";
          const before = calls.length;
          const result = await verifyEmail(user, email, token);
          assert.equal(result.status, 200, JSON.stringify(result.json));
          assert.equal(result.json.usuario.correoVerificado, true);
          assert.equal(calls.length, before + 1);
          assert.equal(calls.at(-1)[1], user.correo);
          assert.equal(+calls.at(-1)[2], +email.creadoEn);
          const row = await storedChallenge(email);
          assert.equal(row.usado, true);
          assert.equal(row.codigoHash, proof(token));
          assert.ok(!JSON.stringify(result.json).includes(token));
          assert.equal((await verifyEmail(user, email, token)).status, 200);
          assert.equal(calls.length, before + 1);
          assert.equal(
            await prisma.session.count({ where: { usuarioId: user.id } }),
            1,
          );
        },
      );

      await t.test(
        "Verificar Gmail no verifica el teléfono ni concede permisos para publicar reportes",
        async () => {
          const who = await actor("google_only");
          const pending = await emailChallenge(who);
          const result = await verifyEmail(
            who,
            pending,
            "fixture-google-only-email-approved-without-phone-proof",
          );
          assert.equal(result.status, 200, JSON.stringify(result.json));
          const user = await storedUser(who);
          assert.equal(user.correoVerificado, true);
          assert.equal(user.telefonoVerificado, false);
          const report = await request("/reports", who, {});
          assert.equal(report.status, 403);
          assert.equal(report.json.code, "PHONE_REQUIRED");
        },
      );

      await t.test(
        "Un JWT renovado del mismo evento Google no aprueba un desafío nuevo",
        async () => {
          const used = await storedChallenge(email);
          await prisma.user.update({
            where: { id: user.id },
            data: { correoVerificado: false },
          });
          await prisma.verification.update({
            where: { id: used.id },
            data: { creadoEn: new Date(Date.now() - 120000) },
          });
          const pending = await emailChallenge(user);
          verifier = async () => ({ proofHash: used.codigoHash });
          const result = await verifyEmail(
            user,
            pending,
            "fixture-google-refreshed-token-for-used-event",
          );
          assert.equal(result.status, 409, JSON.stringify(result.json));
          const row = await storedChallenge(pending);
          assert.equal(row.usado, false);
          assert.equal(row.codigoHash, pending.codigoHash);
          assert.equal((await storedUser(user)).correoVerificado, false);
          verifier = async (token) => ({ proofHash: proof(token) });
        },
      );

      await t.test(
        "Cinco comprobaciones Google inválidas agotan el desafío y los vencidos no llaman al proveedor",
        async () => {
          const who = await actor("google_attempts");
          const pending = await emailChallenge(who);
          const before = calls.length;
          verifier = async () => {
            throw new HttpError(
              400,
              "Prueba Google rechazada.",
              "EMAIL_GOOGLE_INVALID_TOKEN",
            );
          };
          for (let n = 0; n < 6; n++)
            assert.equal((await verifyEmail(who, pending)).status, 400);
          assert.equal(calls.length, before + 5);
          assert.equal((await storedChallenge(pending)).intentos, 5);
          assert.equal((await storedUser(who)).correoVerificado, false);
          verifier = async (token) => ({ proofHash: proof(token) });
          const expired = await actor("google_expired");
          const expiredChallenge = await emailChallenge(expired);
          await prisma.verification.update({
            where: { id: expiredChallenge.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
          const afterAttempts = calls.length;
          rejected(await verifyEmail(expired, expiredChallenge));
          assert.equal(calls.length, afterAttempts);
        },
      );

      await t.test(
        "El cambio de correo o bloqueo durante la comprobación Google revierte consumo y aprobación",
        async () => {
          for (const condition of ["changed", "blocked"]) {
            const who = await actor("google_" + condition);
            const pending = await emailChallenge(who);
            verifier = async () => {
              await prisma.user.update({
                where: { id: who.id },
                data:
                  condition === "changed"
                    ? { correo: run + "_changed@gmail.com" }
                    : { bloqueado: true },
              });
              return { proofHash: proof("google-" + condition) };
            };
            assert.equal((await verifyEmail(who, pending)).status, 409);
            const row = await storedChallenge(pending);
            assert.equal(row.usado, false);
            assert.equal(row.codigoHash, pending.codigoHash);
            assert.equal((await storedUser(who)).correoVerificado, false);
          }
          verifier = async (token) => ({ proofHash: proof(token) });
        },
      );

      await t.test(
        "Dos comprobaciones Google simultáneas aprueban y consumen una sola vez",
        async () => {
          const who = await actor("google_concurrent");
          const pending = await emailChallenge(who);
          let entered = 0;
          let release;
          const barrier = new Promise((resolve) => {
            release = resolve;
          });
          const timer = setTimeout(release, 2000);
          verifier = async () => {
            if (++entered === 2) {
              clearTimeout(timer);
              release();
            }
            await barrier;
            return { proofHash: proof("google-concurrent-event") };
          };
          try {
            const results = await Promise.all([
              verifyEmail(who, pending),
              verifyEmail(who, pending),
            ]);
            assert.equal(entered, 2);
            assert.equal(
              results.filter((result) => result.status === 200).length,
              1,
              JSON.stringify(results),
            );
            assert.equal(
              results.filter(
                (result) => result.status >= 400 && result.status < 500,
              ).length,
              1,
            );
            const row = await storedChallenge(pending);
            assert.equal(row.usado, true);
            assert.equal(row.intentos, 2);
            assert.equal(row.codigoHash, proof("google-concurrent-event"));
            assert.equal((await storedUser(who)).correoVerificado, true);
          } finally {
            clearTimeout(timer);
            release();
            verifier = async (token) => ({ proofHash: proof(token) });
          }
        },
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      if (userIds.length) {
        await prisma.auditLog.deleteMany({
          where: { usuarioId: { in: userIds } },
        });
        await prisma.recovery.deleteMany({
          where: { usuarioId: { in: userIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      await prisma.$disconnect();
    }
  },
);
