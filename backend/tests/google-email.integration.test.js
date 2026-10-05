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
  process.env.FIREBASE_PROJECT_ID = "civigo-fixture";
  delete process.env.TRUST_PROXY;
}

test(
  "Correo Google HTTP y base local: sesión, consumo y participación",
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
    function rejected(result) {
      assert.ok(
        result.status >= 400 && result.status < 500,
        JSON.stringify(result),
      );
    }

    try {
      const user = await actor("owner");
      const other = await actor("other");
      await t.test(
        "Google requiere sesión y los endpoints telefónicos y OTP fueron retirados",
        async () => {
          assert.equal(
            (await request("/users/email/google/config")).status,
            401,
          );
          assert.equal(
            (await request("/users/email/google/request", null, {})).status,
            401,
          );
          for (const route of [
            "/users/phone/request",
            "/users/phone/verify",
            "/users/email/request",
            "/users/email/verify",
            "/admin/phone-verifications/1/approve",
          ])
            assert.equal((await request(route, user, {})).status, 404);
          assert.equal(
            (await request("/users/phone/config", user)).status,
            404,
          );
          assert.equal(
          (await request("/admin/phone-verifications", user)).status,
          404,
          );
        },
      );
      await t.test(
        "Teléfono legado verificado no concede participación sin correo verificado",
        async () => {
          await prisma.user.update({
            where: { id: other.id },
            data: { telefonoVerificado: true },
          });
          const result = await request("/reports", other, {});
          assert.equal(result.status, 403);
          assert.equal(result.json.code, "EMAIL_REQUIRED");
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
        "Correo verificado permite participar aunque el teléfono no esté verificado",
        async () => {
          const who = await actor("google_only");
          const pending = await emailChallenge(who);
          const result = await verifyEmail(
            who,
            pending,
            "fixture-google-only-email-approved-without-phone-proof",
          );
          assert.equal(result.status, 200, JSON.stringify(result.json));
          assert.equal("telefonoVerificado" in result.json.usuario, false);
          const user = await storedUser(who);
          assert.equal(user.correoVerificado, true);
          assert.equal(user.telefonoVerificado, false);
          const report = await request("/reports", who, {});
          assert.equal(report.status, 400);
          assert.notEqual(report.json.code, "EMAIL_REQUIRED");
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
