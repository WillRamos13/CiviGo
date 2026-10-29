const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
test(
  "control, global statistics and provider probes require ADMIN; public telemetry cannot supply an account identity",
  { skip: !connection },
  async () => {
    assert.ok(
      ["localhost", "127.0.0.1"].includes(new URL(connection).hostname),
    );
    const db = require("../src/lib/db"),
      app = require("../src/server"),
      { hashToken } = require("../src/lib/auth"),
      users = [];
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    try {
      for (const role of ["ADMIN", "AGENTE"]) {
        const id = crypto.randomUUID(),
          token = crypto.randomBytes(32).toString("hex");
        const user = await db.user.create({
          data: {
            nombreUsuario: id,
            correo: id + "@fixture.invalid",
            telefono: id,
            password: "not-a-login",
            rol: role,
            correoVerificado: true,
          },
        });
        users.push({ ...user, token });
        await db.session.create({
          data: {
            id: hashToken(token),
            usuarioId: user.id,
            expiresAt: new Date(Date.now() + 60000),
          },
        });
      }
      for (const path of [
        "/admin/control",
        "/admin/site-statistics",
        "/admin/integration-probes",
      ]) {
        assert.equal((await fetch(base + path)).status, 401);
        assert.equal(
          (
            await fetch(base + path, {
              headers: { Cookie: `civigo_session=${users[1].token}` },
            })
          ).status,
          403,
        );
      }
      for (const path of ["/admin/control", "/admin/site-statistics"]) {
        const r = await fetch(base + path, {
          headers: { Cookie: `civigo_session=${users[0].token}` },
        });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get("cache-control"), "no-store");
        const text = await r.text();
        assert.ok(!text.includes(users[0].correo));
        assert.ok(!text.includes(users[0].token));
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.user.deleteMany({
        where: { id: { in: users.map((row) => row.id) } },
      });
      await db.$disconnect();
    }
  },
);
