const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
test(
  "private contact inbox requires verified ownership to send and an administrator to read or attend",
  { skip: !connection },
  async () => {
    assert.ok(
      ["127.0.0.1", "localhost"].includes(new URL(connection).hostname),
    );
    require("./helpers/provider-environment").disableExternalProviders();
    process.env.NODE_ENV = "test";
    const { PrismaClient } = require("@prisma/client"),
      db = new PrismaClient({ datasourceUrl: connection });
    const previous = globalThis.__civigoPrisma;
    globalThis.__civigoPrisma = db;
    const users = [],
      tokens = [],
      uid = randomUUID();
    let server;
    try {
      const { hashToken } = require("../src/lib/auth");
      for (const [index, rol, verified] of [
        [0, "USUARIO", true],
        [1, "ADMIN", true],
        [2, "USUARIO", false],
      ]) {
        const user = await db.user.create({
          data: {
            correo: `contact-${index}-${uid}@example.invalid`,
            nombreUsuario: `contact-${index}-${uid}`,
            telefono: "contact-fixture:" + uid + ":" + index,
            password: "not-used-by-test",
            rol,
            correoVerificado: verified,
          },
        });
        users.push(user);
        const token = String(index + 1).repeat(64);
        tokens.push(token);
        await db.session.create({
          data: {
            id: hashToken(token),
            usuarioId: user.id,
            expiresAt: new Date(Date.now() + 60000),
          },
        });
      }
      const express = require("express"),
        app = express();
      app.use(express.json());
      app.use("/api", require("../src/routes/contact"));
      app.use((error, req, res, next) =>
        res.status(error.status || 500).json({ error: error.message }),
      );
      server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      const call = async (path, actor, method = "GET", body) => {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/api${path}`,
          {
            method,
            headers: {
              "Content-Type": "application/json",
              ...(actor == null
                ? {}
                : { Cookie: `civigo_session=${tokens[actor]}` }),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          },
        );
        return { status: response.status, data: await response.json() };
      };
      const body = {
        asunto: "Consulta privada",
        mensaje: "Necesito ayuda con mi cuenta de CiviGo.",
      };
      assert.equal((await call("/contact", null, "POST", body)).status, 401);
      assert.equal((await call("/contact", 2, "POST", body)).status, 403);
      assert.equal((await call("/admin/contact", 0)).status, 403);
      const sent = await call("/contact", 0, "POST", body);
      assert.equal(sent.status, 201);
      const inbox = await call("/admin/contact", 1);
      assert.equal(inbox.status, 200);
      const entry = inbox.data.find((row) => row.id === sent.data.id);
      assert.equal(entry.correo, users[0].correo);
      assert.equal(
        (await call("/admin/contact", 0, "PATCH", { clave: entry.clave }))
          .status,
        403,
      );
      assert.equal(
        (await call("/admin/contact", 1, "PATCH", { clave: "reglas" })).status,
        400,
      );
      assert.equal(
        (await call("/admin/contact", 1, "PATCH", { clave: entry.clave }))
          .status,
        200,
      );
      assert.equal(
        (await db.appConfig.findUnique({ where: { clave: entry.clave } })).valor
          .estado,
        "ATENDIDO",
      );
      for (let index = 0; index < 4; index++)
        assert.equal((await call("/contact", 0, "POST", body)).status, 201);
      assert.equal((await call("/contact", 0, "POST", body)).status, 429);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.appConfig.deleteMany({
        where: {
          OR: users.map((user) => ({
            clave: { startsWith: `contact:${user.id}:` },
          })),
        },
      });
      await db.session.deleteMany({
        where: { usuarioId: { in: users.map((user) => user.id) } },
      });
      await db.user.deleteMany({
        where: { id: { in: users.map((user) => user.id) } },
      });
      await db.$disconnect();
      if (previous === undefined) delete globalThis.__civigoPrisma;
      else globalThis.__civigoPrisma = previous;
    }
  },
);
