const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;

if (connection) {
  const url = new URL(connection);
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Los anuncios se prueban únicamente en una base local.");
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
}

test(
  "Anuncios HTTP con Prisma real: CRUD programado, Premium, ficha de negocio y auditoría de avisos TomTom",
  { skip: !connection },
  async () => {
    const prisma = require("../src/lib/db");
    const { hashToken } = require("../src/lib/auth");
    const app = require("../src/server");
    const run = crypto.randomBytes(6).toString("hex");
    const users = [],
      ids = [];
    let server, business;
    const externalId = "fixture_" + run;
    try {
      async function actor(label, role, premium = false) {
        const user = await prisma.user.create({
          data: {
            nombreUsuario: run + "_" + label,
          correo: run + "_" + label + "@gmail.com",
          telefono: "+519" + String(crypto.randomInt(10000000, 99999999)),
            password: "fixture-inaccessible-password",
            rol: role,
            correoVerificado: true,
            premium,
            ocultarAnuncios: true,
          },
        });
        users.push(user.id);
        const token = crypto.randomBytes(32).toString("hex");
        await prisma.session.create({
          data: {
            id: hashToken(token),
            usuarioId: user.id,
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        return "civigo_session=" + token;
      }
      const admin = await actor("admin", "ADMIN");
      const premium = await actor("premium", "USUARIO", true);
      const ordinary = await actor("ordinary", "USUARIO");
      business = await prisma.business.create({
        data: {
          nombre: "Negocio fixture " + run,
          descripcion: "Negocio público de prueba local.",
          latitud: -14.06777,
          longitud: -75.7286,
          sitioWeb: "https://example.test/ficha",
          direccion: "Dirección pública de prueba",
        },
      });
      server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      const request = async (route, method = "GET", body, cookie) => {
        const response = await fetch(
          "http://127.0.0.1:" +
            server.address().port +
            "/api/announcements" +
            route,
          {
            method,
            headers: {
              ...(body ? { "Content-Type": "application/json" } : {}),
              ...(cookie ? { Cookie: cookie } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          },
        );
        return {
          status: response.status,
          body: await response.json(),
          cache: response.headers.get("cache-control"),
        };
      };
      assert.equal((await request("/manage")).status, 401);
      assert.equal(
        (await request("/manage", "POST", { titulo: "No permitido" }, ordinary))
          .status,
        403,
      );
      const start = new Date(Date.now() - 60000).toISOString();
      const end = new Date(Date.now() + 3600000).toISOString();
      for (const data of [
        {
          tipo: "NOVEDAD",
          titulo: run + "-novedad",
          enlace: "/mapa",
          inicio: start,
          fin: end,
          orden: 1,
        },
        {
          tipo: "NEGOCIO",
          titulo: run + "-negocio",
          negocioId: business.id,
          orden: 2,
        },
        {
          tipo: "NOVEDAD",
          titulo: run + "-futuro",
          inicio: "2099-10-08T13:00:00Z",
        },
        {
          tipo: "NOVEDAD",
          titulo: run + "-vencido",
          fin: "2020-10-08T13:00:00Z",
        },
      ]) {
        const result = await request("/manage", "POST", data, admin);
        assert.equal(result.status, 201, JSON.stringify(result.body));
        ids.push(result.body.id);
      }
      const patch = await request(
        "/manage/" + ids[0],
        "PATCH",
        { mensaje: "Novedad actualizada" },
        admin,
      );
      assert.equal(patch.status, 200, JSON.stringify(patch.body));
      assert.equal(patch.body.inicio, start);
      const published = await request("");
      assert.equal(published.cache, "no-store");
      const fixtureRows = published.body.filter((row) => ids.includes(row.id));
      assert.deepEqual(
        fixtureRows.map((row) => row.id),
        ids.slice(0, 2),
      );
      assert.equal(fixtureRows[1].negocio.id, business.id);
      assert.equal(
        fixtureRows[1].negocio.direccion,
        "Dirección pública de prueba",
      );
      assert.equal(fixtureRows[1].negocio.activo, undefined);
      const premiumRows = (
        await request("", "GET", undefined, premium)
      ).body.filter((row) => ids.includes(row.id));
      assert.deepEqual(
        premiumRows.map((row) => row.id),
        [ids[0]],
      );
      assert.equal(
        (await request("", "GET", undefined, ordinary)).body.filter((row) =>
          ids.includes(row.id),
        ).length,
        2,
      );
      await prisma.business.update({
        where: { id: business.id },
        data: { activo: false },
      });
      assert.equal(
        (await request("")).body.some((row) => row.id === ids[1]),
        false,
      );
      const hidden = await request(
        "/traffic-moderation",
        "POST",
        {
          externoId: externalId,
          oculto: true,
          motivo: "La vía ya está habilitada según revisión local.",
          datos: { titulo: "Aviso público", apiKey: "must-not-store" },
        },
        admin,
      );
      assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
      assert.deepEqual(hidden.body.datos, { titulo: "Aviso público" });
      const restored = await request(
        "/traffic-moderation",
        "POST",
        {
          externoId: externalId,
          oculto: false,
          motivo: "Restauración solicitada después de evaluar la vía.",
        },
        admin,
      );
      assert.equal(restored.status, 200, JSON.stringify(restored.body));
      assert.equal(restored.body.oculto, false);
      assert.deepEqual(restored.body.datos, hidden.body.datos);
      assert.equal(
        await prisma.auditLog.count({
          where: {
            usuarioId: users[0],
            entidad: "AVISO_TOMTOM",
            entidadId: externalId,
          },
        }),
        2,
      );
      assert.equal(
        (await request("/manage/" + ids[0], "DELETE", undefined, admin)).status,
        200,
      );
      assert.equal(
        (await request("/manage/" + ids[0], "PATCH", { activo: false }, admin))
          .status,
        404,
      );
    } finally {
      await prisma.mapAnnouncement.deleteMany({ where: { id: { in: ids } } });
      await prisma.externalTrafficModeration.deleteMany({
        where: { externoId: externalId },
      });
      await prisma.auditLog.deleteMany({ where: { usuarioId: { in: users } } });
      if (business)
        await prisma.business.delete({ where: { id: business.id } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await prisma.$disconnect();
    }
  },
);
