const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const {
  announcementData,
  announcementPlacement,
  safeLink,
  scheduledDate,
  trafficModerationData,
  publicAnnouncement,
  validateAnnouncementImage,
} = require("../src/lib/announcements");
const fixture = {
  titulo: "Nueva función del mapa",
  mensaje: "Consulta los avisos viales.",
  tipo: "NOVEDAD",
};

test("anuncios validan texto, enlaces, orden y programación inequívoca", () => {
  const result = announcementData({
    ...fixture,
    inicio: "2026-10-08T08:00:00-05:00",
    fin: "2026-10-09T08:00:00-05:00",
    enlace: "/mapa",
  });
  assert.equal(result.inicio.toISOString(), "2026-10-08T13:00:00.000Z");
  assert.equal(result.enlace, "/mapa");
  assert.equal(safeLink('/comunidad'), '/ranking');
  assert.equal(result.negocioId, null);
  assert.equal(result.ubicacion, 'CABECERA');
  assert.equal(announcementData({ ...fixture, ubicacion: 'REPORTAR' }).ubicacion, 'REPORTAR');
  assert.equal(announcementData({ mensaje: 'Editado' }, { ...result, ubicacion: 'REPORTAR' }).ubicacion, 'REPORTAR');
  assert.equal(announcementPlacement(), 'CABECERA');
  for (const patch of [
    { titulo: "<script>alert(1)</script>" },
    { activo: "true" },
    { orden: -1 },
    { orden: 1.5 },
    { tipo: "OTRO" },
    { ubicacion: 'OTRA' },
    { ubicacion: null },
    { ubicacion: ['REPORTAR'] },
    { tipo: "NEGOCIO", negocioId: null },
    { enlace: "javascript:alert(1)" },
    { inicio: "2026-10-08T13:00" },
    { inicio: "2026-02-30T13:00:00Z" },
    { inicio: "2026-10-08T13:00:00Z", fin: "2026-10-08T12:00:00Z" },
  ])
    assert.throws(() => announcementData({ ...fixture, ...patch }), {
      status: 400,
    });
  for (const unsafe of [
    "//evil.test",
    "http://example.test",
    "https://a:b@example.test",
    "https://example.test/\\evil",
    "/admin",
    "/mapa?next=evil",
    "data:text/html,hi",
  ])
    assert.throws(() => safeLink(unsafe));
  assert.equal(
    safeLink("https://example.test/novedad"),
    "https://example.test/novedad",
  );
  assert.equal(scheduledDate(null), null);
  const advert = announcementData({
    ...fixture,
    tipo: "NEGOCIO",
    negocioId: 10,
    enlace: "https://example.test",
  });
  assert.equal(advert.negocioId, 10);
  assert.equal(advert.enlace, null);
  const switched = announcementData({ tipo: "NOVEDAD" }, advert);
  assert.equal(switched.negocioId, null);
});

test("la moderación requiere motivo y guarda solo un snapshot público limitado", () => {
  assert.throws(
    () =>
      trafficModerationData({ externoId: "1", oculto: true, motivo: "corto" }),
    { status: 400 },
  );
  const result = trafficModerationData({
    externoId: "TT_123",
    oculto: true,
    motivo: "La vía ya está habilitada.",
    datos: {
      titulo: "Cierre",
      tipo: "ROAD_CLOSED",
      latitud: -14.06,
      longitud: -75.72,
      apiKey: "never-store",
      usuario: "private",
      geometria: [],
    },
  });
  assert.deepEqual(result.datos, {
    titulo: "Cierre",
    tipo: "ROAD_CLOSED",
    latitud: -14.06,
    longitud: -75.72,
  });
  assert.equal(result.proveedor, "TOMTOM");
});

function loadRouter(state) {
  const businesses = [
    { id: 10, nombre: "Comercio", activo: true },
    { id: 11, nombre: "Inactivo", activo: false },
  ];
  let sequence = 0;
  const clone = (row) => ({
    ...row,
    negocio: businesses.find((b) => b.id === row.negocioId) ?? null,
    imagen: state.images?.find(image => image.id === row.imagenId) ?? null,
  });
  const db = {
    mapAnnouncement: {
      findMany: async ({ where }) => {
        let rows = state.rows;
        if (where?.ubicacion) rows = rows.filter(row => (row.ubicacion ?? 'CABECERA') === where.ubicacion);
        if (where?.activo) {
          const now = where.AND[0].OR[1].inicio.lte;
          assert.equal(where.activo, true);
          assert.ok(where.AND[1].OR[1].fin.gt instanceof Date);
          const hideAds = where.AND[2].tipo === "NOVEDAD";
          rows = rows.filter(
            (row) =>
              row.activo &&
              (!row.inicio || row.inicio <= now) &&
              (!row.fin || row.fin > now) &&
              (row.tipo === "NOVEDAD" ||
                (!hideAds &&
                  businesses.find((b) => b.id === row.negocioId)?.activo)),
          );
        }
        return rows
          .slice()
          .sort((a, b) => a.orden - b.orden || a.id - b.id)
          .map(clone);
      },
      findUnique: async ({ where }) =>
        state.rows.find((row) => row.id === where.id) ? clone(state.rows.find((row) => row.id === where.id)) : null,
      create: async ({ data }) => {
        const row = { id: ++sequence, ...data };
        state.rows.push(row);
        return clone(row);
      },
      update: async ({ where, data }) => {
        const row = state.rows.find((row) => row.id === where.id);
        Object.assign(row, data);
        return clone(row);
      },
      delete: async ({ where }) => {
        state.rows = state.rows.filter((row) => row.id !== where.id);
      },
    },
    attachment: { findUnique: async ({where}) => {
      const image = state.images?.find(row => row.id === where.id);
      return image ? { ...image, anuncio: state.rows.find(row => row.imagenId === where.id) ?? null } : null;
    } },
    business: {
      findUnique: async ({ where }) =>
        businesses.find((row) => row.id === where.id) ?? null,
    },
    auditLog: {
      create: async ({ data }) => {
        state.audit.push(data);
        return data;
      },
    },
    externalTrafficModeration: {
      findMany: async () => state.moderation,
      upsert: async ({ where, create, update }) => {
        let row = state.moderation.find(
          (row) => row.externoId === where.proveedor_externoId.externoId,
        );
        if (row) Object.assign(row, update);
        else {
          row = { id: 1, ...create };
          state.moderation.push(row);
        }
        return row;
      },
    },
    $transaction: async (callback) => callback(db),
  };
  const setUser = (req, res, next) => {
    req.user = req.headers["x-role"]
      ? {
          id: 1,
          rol: req.headers["x-role"],
          premium: req.headers["x-premium"] === "yes",
          ocultarAnuncios: req.headers["x-hide"] === "yes",
        }
      : null;
    next();
  };
  const auth = (req, res, next) =>
    setUser(req, res, () =>
      req.user ? next() : res.status(401).json({ error: "Inicia sesión." }),
    );
  const overrides = {
    "../src/lib/db": db,
    "../src/lib/auth": { auth, optionalAuth: setUser },
    "../src/lib/storage": { createStorage: () => ({ send: async (row, req, res) => { state.imageReads = (state.imageReads || 0) + 1; res.send(Buffer.from('authorized-image')); } }) },
  };
  const saved = [];
  const routeId = require.resolve("../src/routes/announcements");
  try {
    saved.push([routeId, require.cache[routeId]]);
    delete require.cache[routeId];
    for (const [name, exports] of Object.entries(overrides)) {
      const id = require.resolve(name);
      saved.push([id, require.cache[id]]);
      require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    return require(routeId);
  } finally {
    for (const [id, previous] of saved.reverse()) {
      if (previous) require.cache[id] = previous;
      else delete require.cache[id];
    }
  }
}

test("API de anuncios publica solo vigentes, protege CRUD y audita moderación", async (t) => {
  const state = { rows: [], audit: [], moderation: [], images: [] };
  const app = express();
  app.use(express.json());
  app.use("/api/announcements", loadRouter(state));
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/announcements`;
  const request = (path, method = "GET", body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: {
        Connection: "close",
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const admin = { "x-role": "ADMIN" };
  try {
    await t.test(
      "anónimos y usuarios no pueden gestionar ni ocultar avisos",
      async () => {
        assert.equal((await request("/manage")).status, 401);
        assert.equal(
          (await request("/manage", "POST", fixture, { "x-role": "USUARIO" }))
            .status,
          403,
        );
        assert.equal(
          (
            await request(
              "/traffic-moderation",
              "POST",
              {},
              { "x-role": "AGENTE" },
            )
          ).status,
          403,
        );
      },
    );
    await t.test('imágenes de anuncios se publican solo vigentes y no admiten pruebas privadas ni ajenas', async () => {
      const image = { id: '12345678-1234-1234-1234-123456789012', usuarioId: 1, estado: 'LISTO', tipo: 'ANUNCIO', privado: false, reporteId: null, mimeType: 'image/png', size: 100, nombre: 'promocion.png' };
      state.images.push(image);
      const created = await request('/manage', 'POST', { ...fixture, imagenId: image.id, imagenAlt: 'Promoción accesible' }, admin);
      assert.equal(created.status, 201);
      const row = await created.json();
      const published = (await (await request('/')).json()).find(a => a.id === row.id);
      assert.equal(published.imagen.alt, 'Promoción accesible');
      assert.equal(published.imagen.url, `/api/announcements/${row.id}/image`);
      assert.equal('path' in published.imagen, false);
      const rendered = await request(`/${row.id}/image`);
      assert.equal(rendered.status, 200); assert.equal(rendered.headers.get('content-type').startsWith('image/png'), true);
      assert.equal(rendered.headers.get('cache-control'), 'no-store');
      assert.equal(rendered.headers.get('x-content-type-options'), 'nosniff');
      assert.equal((await request('/manage', 'POST', { ...fixture, imagenId: image.id }, admin)).status, 400, 'una imagen no se reutiliza en otro anuncio');
      assert.equal((await request(`/manage/${row.id}`, 'PATCH', { activo: false }, admin)).status, 200);
      const reads = state.imageReads;
      assert.equal((await request(`/${row.id}/image`)).status, 404);
      assert.equal(state.imageReads, reads, 'anuncio desactivado no consulta almacenamiento');
      await request(`/manage/${row.id}`, 'PATCH', { activo: true, tipo: 'NEGOCIO', negocioId: 10 }, admin);
      assert.equal((await request(`/${row.id}/image`, 'GET', null, { 'x-role': 'USUARIO', 'x-premium': 'yes', 'x-hide': 'yes' })).status, 404);
      await request(`/manage/${row.id}`, 'PATCH', { negocioId: 11 }, admin);
      assert.equal((await request(`/${row.id}/image`)).status, 404, 'negocio inactivo no publica imagen');
      await request(`/manage/${row.id}`, 'PATCH', { tipo: 'NOVEDAD', inicio: '2099-10-08T13:00:00Z' }, admin);
      assert.equal((await request(`/${row.id}/image`)).status, 404, 'programación aplica también a la imagen');
      await request(`/manage/${row.id}`, 'PATCH', { inicio: null, imagenId: null }, admin);
      assert.equal((await request(`/${row.id}/image`)).status, 404);
      assert.equal((await request('/manage', 'POST', { ...fixture, imagenId: image.id }, {'x-role':'AGENTE'})).status, 403);
      image.privado = true;
      assert.equal((await request('/manage', 'POST', { ...fixture, imagenId: image.id }, admin)).status, 400);
      await request(`/manage/${row.id}`, 'DELETE', null, admin);
    });
    await t.test("crear, editar, ordenar y programación pública", async () => {
      const create = await request("/manage", "POST", fixture, admin);
      assert.equal(create.status, 201);
      const news = await create.json();
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            {
              ...fixture,
              titulo: "Comercio",
              tipo: "NEGOCIO",
              negocioId: 10,
              orden: 1,
            },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            {
              ...fixture,
              titulo: "Negocio inactivo",
              tipo: "NEGOCIO",
              negocioId: 11,
            },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            {
              ...fixture,
              titulo: "Anuncio futuro",
              inicio: "2099-10-08T13:00:00Z",
            },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            {
              ...fixture,
              titulo: "Anuncio expirado",
              fin: "2020-10-08T13:00:00Z",
            },
            admin,
          )
        ).status,
        201,
      );
      assert.equal(
        (await request("/manage", "POST", { ...fixture, activo: false }, admin))
          .status,
        201,
      );
      const publicList = await request("/");
      assert.equal(publicList.headers.get("cache-control"), "no-store");
      assert.deepEqual(
        (await publicList.json()).map((row) => row.titulo),
        [fixture.titulo, "Comercio"],
      );
      const premium = await request("/", "GET", null, {
        "x-role": "USUARIO",
        "x-premium": "yes",
        "x-hide": "yes",
      });
      assert.deepEqual(
        (await premium.json()).map((row) => row.tipo),
        ["NOVEDAD"],
      );
      const ordinary = await request("/", "GET", null, {
        "x-role": "USUARIO",
        "x-hide": "yes",
      });
      assert.equal((await ordinary.json()).length, 2);
      assert.equal(
        (
          await request(
            `/manage/${news.id}`,
            "PATCH",
            { orden: 2, titulo: "Título editado" },
            admin,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/manage",
            "POST",
            { ...fixture, tipo: "NEGOCIO", negocioId: 999 },
            admin,
          )
        ).status,
        400,
      );
      assert.equal(
        (await request(`/manage/${news.id}`, "DELETE", null, admin)).status,
        200,
      );
      assert.equal(
        (await request(`/manage/${news.id}`, "PATCH", fixture, admin)).status,
        404,
      );
      assert.ok(
        state.audit.some(
          (row) => row.accion === "ELIMINAR" && row.entidad === "ANUNCIO_MAPA",
        ),
      );
    });
    await t.test(
      'ubicaciones son persistentes y separadas del cliente legado de cabecera',
      async () => {
        const created = await request('/manage', 'POST', { ...fixture, titulo: 'Banner lateral', ubicacion: 'REPORTAR' }, admin);
        assert.equal(created.status, 201);
        const row = await created.json();
        assert.equal(row.ubicacion, 'REPORTAR');
        assert.equal((await (await request('/')).json()).some(item => item.id === row.id), false);
        assert.deepEqual((await (await request('/?ubicacion=REPORTAR')).json()).map(item => item.id), [row.id]);
        assert.deepEqual((await (await request('/manage?ubicacion=REPORTAR', 'GET', null, admin)).json()).map(item => item.id), [row.id]);
        assert.equal((await request('/?ubicacion=OTRA')).status, 400);
        assert.equal((await request('/?ubicacion=REPORTAR&ubicacion=CABECERA')).status, 400);
        assert.equal((await request('/manage?ubicacion=OTRA', 'GET', null, admin)).status, 400);
        assert.equal((await request('/manage/' + row.id, 'PATCH', { titulo: 'Lateral editado' }, admin)).status, 200);
        assert.equal(state.rows.find(item => item.id === row.id).ubicacion, 'REPORTAR');
        assert.equal((await request('/manage/' + row.id, 'PATCH', { ubicacion: 'CABECERA' }, admin)).status, 200);
        assert.equal((await (await request('/?ubicacion=REPORTAR')).json()).length, 0);
        assert.equal((await (await request('/')).json()).some(item => item.id === row.id), true);
        assert.ok(state.audit.some(item => item.entidadId === String(row.id) && item.datos.ubicacion === 'REPORTAR'));
        await request('/manage/' + row.id, 'DELETE', null, admin);
      },
    );
    await t.test(
      "ocultar y restaurar conserva motivo y fuente sin crear incidentes ciudadanos",
      async () => {
        const payload = {
          externoId: "tt_123",
          oculto: true,
          motivo: "Aviso incorrecto comprobado en la vía.",
          datos: { titulo: "Accidente" },
        };
        assert.equal(
          (await request("/traffic-moderation", "POST", payload, admin)).status,
          200,
        );
        assert.equal(state.moderation[0].oculto, true);
        assert.equal(
          (
            await request(
              "/traffic-moderation",
              "POST",
              {
                ...payload,
                oculto: false,
                datos: undefined,
                motivo: "La información externa volvió a ser vigente.",
              },
              admin,
            )
          ).status,
          200,
        );
        assert.equal(state.moderation[0].oculto, false);
        assert.equal(state.moderation[0].datos.titulo, "Accidente");
        assert.equal(state.moderation.length, 1);
        assert.deepEqual(
          state.audit
            .filter((row) => row.entidad === "AVISO_TOMTOM")
            .map((row) => row.accion),
          ["OCULTAR", "RESTAURAR"],
        );
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('imagen publicitaria requiere identificador propio, formato seguro y nunca reutiliza pruebas de reportes', async () => {
  const image = { id: '12345678-1234-1234-1234-123456789012', usuarioId: 1, estado: 'LISTO', tipo: 'ANUNCIO', privado: false, reporteId: null, mimeType: 'image/png', size: 100 };
  const data = announcementData({ ...fixture, imagenId: image.id });
  assert.equal(data.imagenAlt, '');
  assert.throws(() => announcementData({...fixture, imagenId:'https://example.test/photo.png'}), {status:400});
  assert.throws(() => announcementData({...fixture, imagenId:image.id, imagenAlt:'<script>bad</script>'}), {status:400});
  const db = row => ({ attachment: { findUnique: async () => row } });
  await validateAnnouncementImage(db(image), data, 1);
  for (const patch of [{estado:'BORRANDO'}, {privado:true}, {tipo:'EVIDENCIA'}, {reporteId:5}, {mimeType:'image/svg+xml'}, {mimeType:'video/mp4'}, {size:0}, {size:5*1024*1024+1}, {usuarioId:2}, {anuncio:{id:10}}])
    await assert.rejects(validateAnnouncementImage(db({...image,...patch}), data, 1), {status:400});
  await validateAnnouncementImage(db({...image, usuarioId:2, anuncio:{id:10}}), data, 1, {id:10, imagenId:image.id});
  const publicRow = publicAnnouncement({ ...fixture, id:10, imagen:{...image, path:'supabase://private/example'}, imagenAlt:'Publicidad' });
  assert.equal('path' in publicRow.imagen, false); assert.equal('usuarioId' in publicRow.imagen, false);
});

test("migración local conserva relación de negocios y valida horarios y cuota", async () => {
  const { PGlite } = require("@electric-sql/pglite");
  const fs = require("node:fs");
  const path = require("node:path");
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE TABLE "Business" ("id" INTEGER PRIMARY KEY); INSERT INTO "Business" VALUES (1);',
    );
    await db.exec(
      fs.readFileSync(
        path.join(
          __dirname,
          "../prisma/migrations/20261008000100_map_announcements_and_traffic/migration.sql",
        ),
        "utf8",
      ),
    );
    await db.exec(
      `INSERT INTO "MapAnnouncement" ("tipo", "titulo", "negocioId", "actualizadoEn") VALUES ('NEGOCIO', 'Publicidad', 1, NOW());`,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "MapAnnouncement" ("tipo", "titulo", "actualizadoEn") VALUES ('NEGOCIO', 'Inválido', NOW());`,
      ),
      /negocio_check/,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "MapAnnouncement" ("titulo", "inicio", "fin", "actualizadoEn") VALUES ('Fechas', '2026-10-09', '2026-10-08', NOW());`,
      ),
      /fechas_check/,
    );
    await db.exec(
      `INSERT INTO "ExternalApiUsage" ("proveedor", "producto", "mes", "actualizadoEn") VALUES ('TOMTOM', 'routing', '2026-10', NOW());`,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO "ExternalApiUsage" ("proveedor", "producto", "mes", "actualizadoEn") VALUES ('TOMTOM', 'routing', '2026-10', NOW());`,
      ),
      /unique constraint/,
    );
    await assert.rejects(
      db.exec(`UPDATE "ExternalApiUsage" SET "usadas" = -1;`),
      /usadas_check/,
    );
    await db.exec('CREATE TABLE "Attachment" ("id" TEXT PRIMARY KEY);');
    await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261013000200_announcement_images/migration.sql'), 'utf8'));
    await db.exec(`INSERT INTO "Attachment" VALUES ('image-fixture'); UPDATE "MapAnnouncement" SET "imagenId" = 'image-fixture', "imagenAlt" = 'Promoción';`);
    await assert.rejects(db.exec(`DELETE FROM "Attachment" WHERE "id" = 'image-fixture';`), /foreign key/);
    await assert.rejects(db.exec(`INSERT INTO "MapAnnouncement" ("titulo", "imagenId", "actualizadoEn") VALUES ('Duplicado', 'image-fixture', NOW());`), /unique constraint/);
    assert.equal((await db.query('SELECT "titulo" FROM "MapAnnouncement"')).rows[0].titulo, 'Publicidad', 'migración conserva anuncios existentes');
    await db.exec('DELETE FROM "Business" WHERE "id" = 1;');
    assert.equal(
      (await db.query('SELECT * FROM "MapAnnouncement"')).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test('limpieza de cargas no reclama imágenes asociadas a anuncios', async () => {
  const { claimOrphan } = require('../src/lib/upload-quota');
  let writes = 0;
  const db = { $transaction: async work => work(db), attachment: { findUnique: async () => ({id:'image-fixture', usuarioId:1, reporteId:null, anuncio:{id:1}, creadoEn:new Date(0)}), update: async () => { writes++; } } };
  assert.equal(await claimOrphan(db, 'image-fixture', null, 1), null); assert.equal(writes, 0);
});
