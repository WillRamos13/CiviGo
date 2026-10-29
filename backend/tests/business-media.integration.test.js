const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  if (!["localhost", "127.0.0.1"].includes(new URL(connection).hostname))
    throw Error("Solo base local");
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
}
test(
  "Banners de negocios: permisos, propiedad, privacidad, asociación y cambios atómicos",
  { skip: !connection },
  async () => {
    const db = require("../src/lib/db"),
      { hashToken } = require("../src/lib/auth"),
      app = require("../src/server"),
      run = crypto.randomBytes(5).toString("hex"),
      users = [],
      files = [],
      businesses = [];
    let server;
    try {
      const actor = async (rol) => {
        const u = await db.user.create({
          data: {
            nombreUsuario: run + "_" + rol,
            correo: run + "_" + rol + "@gmail.com",
            telefono: "+519" + String(crypto.randomInt(10000000, 99999999)),
            password: "fixture",
            rol,
            correoVerificado: true,
          },
        });
        users.push(u.id);
        const token = crypto.randomBytes(32).toString("hex");
        await db.session.create({
          data: {
            id: hashToken(token),
            usuarioId: u.id,
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        return { user: u.id, cookie: "civigo_session=" + token };
      };
      const admin = await actor("ADMIN"),
        ordinary = await actor("USUARIO");
      const image = async (owner, extra = {}) => {
        const id = crypto.randomUUID();
        await db.attachment.create({
          data: {
            id,
            usuarioId: owner,
            nombre: "fixture.webp",
            mimeType: "image/webp",
            size: 100,
            path: "fixture",
            tipo: "ANUNCIO",
            privado: false,
            ...extra,
          },
        });
        files.push(id);
        return id;
      };
      const own = await image(admin.user),
        foreign = await image(ordinary.user),
        privateId = await image(admin.user, { privado: true });
      server = app.listen(0, "127.0.0.1");
      await new Promise((ok) => server.once("listening", ok));
      const request = async (
        path,
        method = "GET",
        body,
        cookie = admin.cookie,
      ) => {
        const response = await fetch(
          "http://127.0.0.1:" + server.address().port + "/api" + path,
          {
            method,
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
          },
        );
        return { status: response.status, body: await response.json() };
      };
      const data = {
        nombre: run + " negocio",
        descripcion: "Negocio de prueba local",
        direccion: "Avenida fixture",
        latitud: -14.0678,
        longitud: -75.7286,
        imagenId: own,
      };
      assert.equal(
        (await request("/admin/businesses", "POST", data, ordinary.cookie))
          .status,
        403,
      );
      for (const id of [foreign, privateId])
        assert.equal(
          (
            await request("/admin/businesses", "POST", {
              ...data,
              imagenId: id,
            })
          ).status,
          400,
        );
      assert.equal(
        await db.business.count({ where: { nombre: data.nombre } }),
        0,
        "Un banner inválido no deja negocios parciales",
      );
      const created = await request("/admin/businesses", "POST", data);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const id = created.body.id;
      businesses.push(id);
      const adminRows = (await request("/admin/businesses")).body,
        row = adminRows.find((row) => row.id === id);
      assert.equal(row.imagenId, own);
      assert.ok(row.banner.url.startsWith("/api/announcements/"));
      const publicRow = (await request("/businesses")).body.find(
        (row) => row.id === id,
      );
      assert.equal(publicRow.banner.id, own);
      assert.equal(publicRow.imagenId, undefined);
      assert.equal(publicRow.anunciosMapa, undefined);
      assert.equal(
        (await request("/announcements/manage")).body.some(
          (row) => row.id === adminRows.find((row) => row.id === id).bannerId,
        ),
        false,
        "El banner de ruta se gestiona desde Negocios",
      );
      assert.equal(
        (
          await request("/admin/businesses", "POST", {
            ...data,
            nombre: run + " duplicate",
          })
        ).status,
        400,
        "Una imagen no se comparte entre anuncios",
      );
      assert.equal(
        (
          await request("/admin/businesses/" + id, "PATCH", {
            nombre: "Cambio que debe revertirse",
            imagenId: privateId,
          })
        ).status,
        400,
      );
      assert.equal(
        (await db.business.findUnique({ where: { id } })).nombre,
        data.nombre,
      );
      assert.equal(
        (await request("/admin/businesses/" + id, "PATCH", { activo: false }))
          .status,
        200,
      );
      assert.equal(
        (await request("/businesses")).body.some((row) => row.id === id),
        false,
      );
      assert.equal(
        (
          await request("/admin/businesses/" + id, "PATCH", {
            activo: true,
            imagenId: null,
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/businesses")).body.find((row) => row.id === id).banner,
        null,
      );
      assert.equal(
        await db.mapAnnouncement.count({
          where: { negocioId: id, ubicacion: "RUTA" },
        }),
        0,
      );
    } finally {
      if (server) await new Promise((ok) => server.close(ok));
      await db.mapAnnouncement.deleteMany({
        where: { negocioId: { in: businesses } },
      });
      await db.business.deleteMany({ where: { id: { in: businesses } } });
      await db.attachment.deleteMany({ where: { id: { in: files } } });
      await db.auditLog.deleteMany({ where: { usuarioId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  },
);
