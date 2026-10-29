const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
test(
  "Gmail codes: hashed, owner-bound, expiring, single-use; failed attempts commit and failed resends preserve the previous code",
  { skip: !connection },
  async () => {
    assert.ok(
      ["127.0.0.1", "localhost"].includes(new URL(connection).hostname),
    );
    const { PrismaClient } = require("@prisma/client"),
      db = new PrismaClient({ datasourceUrl: connection }),
      { createEmailCodeService } = require("../src/lib/email-code");
    const users = [];
    let clock = Date.parse("2099-04-08T12:00:00Z"),
      code = "123456",
      failSend = false,
      effects = 0,
      sent = [];
    const service = createEmailCodeService({
      db,
      now: () => clock,
      generate: () => code,
      sendEmail: async (to, subject, html) => {
        if (failSend) return false;
        sent.push({ to, subject, html });
        return true;
      },
      refreshEffects: async () => {
        effects++;
      },
    });
    const account = async () => {
      const id = randomUUID();
      const user = await db.user.create({
        data: {
          nombreUsuario: id,
          correo: `${id}@gmail.com`,
          telefono: id,
          password: "not-a-login",
        },
      });
      users.push(user);
      return user;
    };
    try {
      const owner = await account(),
        other = await account();
      let challenge = await service.request(owner.id);
      assert.equal(sent[0].to, owner.correo);
      assert.ok(sent[0].html.includes(code));
      const stored = await db.verification.findUnique({
        where: { id: Number(challenge.challengeId) },
      });
      assert.ok(stored.codigoHash.startsWith("scrypt$"));
      assert.notEqual(stored.codigoHash, code);
      await assert.rejects(
        () => service.request(owner.id),
        (e) => e.code === "EMAIL_CODE_COOLDOWN",
      );
      await assert.rejects(
        () => service.confirm(other.id, challenge.challengeId, code),
        (e) => e.code === "EMAIL_CODE_EXPIRED",
      );
      for (let index = 1; index <= 5; index++) {
        await assert.rejects(() =>
          service.confirm(owner.id, challenge.challengeId, "111111"),
        );
        assert.equal(
          (await db.verification.findUnique({ where: { id: stored.id } }))
            .intentos,
          index,
        );
      }
      await assert.rejects(
        () => service.confirm(owner.id, challenge.challengeId, code),
        (e) => e.code === "EMAIL_CODE_EXPIRED",
      );
      assert.equal(
        (await db.user.findUnique({ where: { id: owner.id } }))
          .correoVerificado,
        false,
      );
      clock += 61000;
      code = "654321";
      challenge = await service.request(owner.id);
      await service.confirm(owner.id, challenge.challengeId, code);
      assert.equal(
        (await db.user.findUnique({ where: { id: owner.id } }))
          .correoVerificado,
        true,
      );
      assert.equal(effects, 1);
      await assert.rejects(() =>
        service.confirm(owner.id, challenge.challengeId, code),
      );
      const resendOwner = await account();
      challenge = await service.request(resendOwner.id);
      clock += 61000;
      failSend = true;
      await assert.rejects(() => service.request(resendOwner.id));
      failSend = false;
      await service.confirm(resendOwner.id, challenge.challengeId, code);
      assert.equal(
        (await db.user.findUnique({ where: { id: resendOwner.id } }))
          .correoVerificado,
        true,
      );
      const changed = await account();
      challenge = await service.request(changed.id);
      await db.user.update({
        where: { id: changed.id },
        data: { correo: randomUUID() + "@gmail.com" },
      });
      await assert.rejects(
        () => service.confirm(changed.id, challenge.challengeId, code),
        (e) => e.code === "EMAIL_CODE_ACCOUNT_CHANGED",
      );
      assert.equal(
        (await db.user.findUnique({ where: { id: changed.id } }))
          .correoVerificado,
        false,
      );
      const expired = await account();
      challenge = await service.request(expired.id);
      clock += 600001;
      await assert.rejects(
        () => service.confirm(expired.id, challenge.challengeId, code),
        (e) => e.code === "EMAIL_CODE_EXPIRED",
      );
      const parallel = await account();
      const results = await Promise.allSettled([
        service.request(parallel.id),
        service.request(parallel.id),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const valid = results.find((r) => r.status === "fulfilled").value;
      const confirmations = await Promise.allSettled([
        service.confirm(parallel.id, valid.challengeId, code),
        service.confirm(parallel.id, valid.challengeId, code),
      ]);
      assert.equal(
        confirmations.filter((r) => r.status === "fulfilled").length,
        1,
      );
      const blocked = await account();
      challenge = await service.request(blocked.id);
      await db.user.update({
        where: { id: blocked.id },
        data: { bloqueado: true },
      });
      await assert.rejects(
        () => service.confirm(blocked.id, challenge.challengeId, code),
        (e) => e.code === "EMAIL_CODE_ACCOUNT_CHANGED",
      );
      assert.equal(
        (await db.user.findUnique({ where: { id: blocked.id } }))
          .correoVerificado,
        false,
      );
      const rate = await account();
      for (let i = 0; i < 5; i++) {
        await service.request(rate.id);
        clock += 61000;
      }
      await assert.rejects(
        () => service.request(rate.id),
        (e) => e.code === "EMAIL_CODE_RATE_LIMITED",
      );
    } finally {
      await db.user.deleteMany({
        where: { id: { in: users.map((u) => u.id) } },
      });
      await db.usageCounter.deleteMany({
        where: { clave: { startsWith: "email-code:daily:2099-04-08" } },
      });
      await db.$disconnect();
    }
  },
);
test(
  "Gmail code HTTP flow works without Firebase, ignores recipient overrides and never returns the code",
  { skip: !connection },
  async () => {
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = "http://localhost:3000";
    const db = require("../src/lib/db"),
      providers = require("../src/lib/providers"),
      { hashToken } = require("../src/lib/auth");
    let captured;
    const originalSend = providers.sendEmail,
      originalServices = providers.services;
    providers.sendEmail = async (to, subject, html) => {
      captured = { to, html };
      return true;
    };
    providers.services = () => ({
      ...originalServices(),
      correo: { configurado: true },
    });
    const app = require("../src/server"),
      server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/users/email/code`,
      id = randomUUID(),
      token = require("node:crypto").randomBytes(32).toString("hex");
    let user;
    const req = (path, body, cookie = true) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          ...(cookie ? { Cookie: `civigo_session=${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    try {
      user = await db.user.create({
        data: {
          nombreUsuario: id,
          correo: id + "@gmail.com",
          telefono: id,
          password: "not-a-login",
        },
      });
      await db.session.create({
        data: {
          id: hashToken(token),
          usuarioId: user.id,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      assert.equal((await req("/request", {}, false)).status, 401);
      assert.equal((await req("/request", [])).status, 400);
      const response = await req("/request", {
        correo: "attacker@gmail.com",
        usuarioId: 999999,
      });
      assert.equal(response.status, 200);
      const challenge = await response.json();
      assert.equal(challenge.codigo, undefined);
      assert.equal(captured.to, user.correo);
      const code = captured.html.match(/letter-spacing:6px">(\d{6})/)[1];
      const verified = await req("/confirm", {
        challengeId: challenge.challengeId,
        codigo: code,
      });
      assert.equal(verified.status, 200);
      assert.equal((await verified.json()).usuario.correoVerificado, true);
      assert.equal(
        (await db.user.findUnique({ where: { id: user.id } })).correoVerificado,
        true,
      );
    } finally {
      providers.sendEmail = originalSend;
      providers.services = originalServices;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (user) await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  },
);
