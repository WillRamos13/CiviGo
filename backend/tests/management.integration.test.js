"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  require("./helpers/provider-environment").disableExternalProviders();
  const url = new URL(connection);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) &&
    process.env.ALLOW_REMOTE_TESTS !== "true"
  )
    throw new Error(
      "Las pruebas administrativas remotas requieren ALLOW_REMOTE_TESTS=true y una base de prueba autorizada.",
    );
  url.searchParams.set("pgbouncer", "true");
  url.searchParams.set("statement_cache_size", "0");
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = "test";
  process.env.DEMO_VERIFICATION = "true";
  process.env.ENABLE_JOBS = "false";
}

test(
  "Integración administrativa real: permisos, catálogo, Premium, canjes, ranking e importación",
  { skip: !connection },
  async (t) => {
    const prisma = require("../src/lib/db");
    const app = require("../src/server");
    const { seedCatalog } = require("../src/lib/catalog");
    await seedCatalog();
    const initialConfig = await prisma.appConfig.findUnique({
      where: { clave: "reglas" },
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const run = crypto.randomBytes(6).toString("hex");
    const password = crypto.randomBytes(24).toString("base64url");
    const userIds = [],
      categoryIds = [],
      typeIds = [],
      rewardIds = [],
      businessIds = [],
      historicalIds = [],
      importKeys = [];
    const month = "1998-07";
    let settlementCreated = false;
    let counter = 0;
    let admin, citizen, agent, type;
    const point = { latitud: -14.06777, longitud: -75.7286 };

    async function request(path, { cookie, method = "GET", body } = {}) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await response.json();
      return {
        status: response.status,
        json,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    }
    async function actor(label) {
      const phone = `+519${String(crypto.randomInt(10000000, 99999999))}`;
      const result = await request("/users/register", {
        method: "POST",
        body: {
          nombres: "Ensayo local",
          apellidos: "Administración",
          nickname: `mgmt_${run}_${++counter}`,
          correo: `mgmt_${run}_${label}@tests.civigo.local`,
          telefono: phone,
          fechaNacimiento: "2000-01-01",
          password,
          rol: "ADMIN",
          premium: true,
          telefonoVerificado: true,
        },
      });
      assert.equal(result.status, 201, JSON.stringify(result.json));
      assert.equal(
        result.json.usuario.rol,
        "USUARIO",
        "El registro no debe aceptar privilegios enviados por el cliente.",
      );
      assert.equal(result.json.usuario.premium, false);
      assert.equal(result.json.usuario.telefonoVerificado, false);
      const value = {
        id: result.json.usuario.id,
        cookie: result.cookie,
        nickname: result.json.usuario.nickname,
      };
      userIds.push(value.id);
      return value;
    }
    async function verifyPhone(user) {
      const challenge = await request("/users/phone/request", {
        cookie: user.cookie,
        method: "POST",
        body: {},
      });
      assert.equal(challenge.status, 200);
      assert.equal(challenge.json.modo, "demo");
      assert.equal(
        (
          await request("/users/phone/verify", {
            cookie: user.cookie,
            method: "POST",
            body: { codigo: challenge.json.codigoDemo },
          })
        ).status,
        200,
      );
    }

    try {
      admin = await actor("admin");
      citizen = await actor("citizen");
      agent = await actor("agent");
      await prisma.user.update({
        where: { id: admin.id },
        data: { rol: "ADMIN" },
      });
      await verifyPhone(citizen);

      await t.test(
        "Acceso administrativo, roles, distrito, permisos y perfiles privados",
        async () => {
          assert.equal((await request("/admin")).status, 401);
          assert.equal((await request("/admin/integrations")).status, 401);
          for (const actor of [citizen, agent]) {
            assert.equal(
              (await request("/admin/integrations", { cookie: actor.cookie }))
                .status,
              403,
            );
          }
          const integrations = await request("/admin/integrations", {
            cookie: admin.cookie,
          });
          assert.equal(integrations.status, 200);
          assert.equal(integrations.json.alcance, "configuracion");
          assert.equal(integrations.json.conexionesProbadas, false);
          assert.deepEqual(
            integrations.json.proveedores.map((p) => p.id),
            ["ia", "telefono", "correo", "almacenamiento", "correoGoogle"],
          );
          assert.equal(integrations.json.proveedores[0].configurado, false);
          assert.equal(
            (await request("/admin/users", { cookie: citizen.cookie })).status,
            403,
          );
          assert.equal(
            (await request("/admin/catalog", { cookie: citizen.cookie }))
              .status,
            403,
          );
          const assigned = await request(`/admin/users/${agent.id}`, {
            cookie: admin.cookie,
            method: "PATCH",
            body: {
              rol: "AGENTE",
              tipoAgente: "POLICIA",
              distrito: "Ica",
              permisos: ["revisar", "evidencia", "resolver", "reabrir"],
            },
          });
          assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
          assert.equal(assigned.json.usuario.tipoAgente, "POLICIA");
          assert.equal(
            (await request("/admin/incidents", { cookie: agent.cookie }))
              .status,
            200,
          );
          assert.equal(
            (
              await request(`/admin/users/${agent.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { bloqueado: true },
              })
            ).status,
            200,
          );
          assert.equal(
            (await request("/admin/incidents", { cookie: agent.cookie }))
              .status,
            403,
          );
          assert.equal(
            (
              await request(`/admin/users/${agent.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { bloqueado: false },
              })
            ).status,
            200,
          );
          assert.equal(
            (await request("/admin/recoveries", { cookie: agent.cookie }))
              .status,
            403,
          );
          assert.equal(
            (
              await request(`/admin/users/${agent.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { distrito: "Distrito inexistente" },
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request(`/admin/users/${admin.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { bloqueado: true },
              })
            ).status,
            409,
          );
          const list = await request("/admin/users", { cookie: admin.cookie });
          assert.equal(list.status, 200);
          assert(list.json.every((user) => !Object.hasOwn(user, "password")));
        },
      );

      await t.test(
        "Catálogo editable, tipos desactivados y configuración con validación",
        async () => {
          const created = await request("/admin/categories", {
            cookie: admin.cookie,
            method: "POST",
            body: { nombre: `Ensayo local ${run}`, orden: 99 },
          });
          assert.equal(created.status, 201, JSON.stringify(created.json));
          categoryIds.push(created.json.id);
          assert.equal(
            (
              await request(`/admin/categories/${created.json.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { nombre: `Categoría verificada ${run}`, orden: 98 },
              })
            ).status,
            200,
          );
          const createdType = await request("/admin/types", {
            cookie: admin.cookie,
            method: "POST",
            body: {
              nombre: `Antecedente de ensayo ${run}`,
              slug: `historico-mgmt-${run}`,
              categoriaId: created.json.id,
              emergencia: false,
              historico: true,
              fotoObligatoria: false,
              individual: true,
              ubicacionRemota: true,
              persistente: false,
              activo: true,
            },
          });
          assert.equal(
            createdType.status,
            201,
            JSON.stringify(createdType.json),
          );
          type = createdType.json;
          typeIds.push(type.id);
          assert.equal(
            (
              await request(`/admin/types/${type.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { activo: false },
              })
            ).status,
            200,
          );
          const publicCatalog = await request("/catalog");
          assert(
            !publicCatalog.json.categorias.some((category) =>
              category.tipos.some((entry) => entry.id === type.id),
            ),
          );
          const privateCatalog = await request("/admin/catalog", {
            cookie: admin.cookie,
          });
          assert(
            privateCatalog.json.categorias.some((category) =>
              category.tipos.some(
                (entry) => entry.id === type.id && !entry.activo,
              ),
            ),
          );
          assert.equal(
            (
              await request(`/admin/types/${type.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { activo: true },
              })
            ).status,
            200,
          );
          assert.equal(
            (await request("/admin/config", { cookie: citizen.cookie })).status,
            403,
          );
          assert.equal(
            (
              await request("/admin/config", {
                cookie: admin.cookie,
                method: "PATCH",
                body: { confirmaciones: 2.5 },
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request("/admin/config", {
                cookie: admin.cookie,
                method: "PATCH",
                body: { desconocido: 5 },
              })
            ).status,
            400,
          );
          const updated = await request("/admin/config", {
            cookie: admin.cookie,
            method: "PATCH",
            body: {
              puntosReporte: 12,
              premiosRanking: [100, 80, 60, 50, 40, 30, 20, 15, 10, 5],
            },
          });
          assert.equal(updated.status, 200);
          assert.equal(updated.json.puntosReporte, 12);
        },
      );

      await t.test(
        "Negocios y recompensas editables; canje de demostración, stock y devolución",
        async () => {
          assert.equal(
            (await request("/admin/businesses", { cookie: agent.cookie }))
              .status,
            403,
          );
          const business = await request("/admin/businesses", {
            cookie: admin.cookie,
            method: "POST",
            body: {
              nombre: `Negocio local ensayo ${run}`,
              descripcion: "Anuncio de ensayo local, sin convenio real",
              direccion: "Ubicación de ensayo",
              horario: "Sin atención real",
              telefono: "",
              sitioWeb: null,
              ...point,
              activo: true,
            },
          });
          assert.equal(business.status, 201, JSON.stringify(business.json));
          businessIds.push(business.json.id);
          assert.equal(business.json.demo, true);
          assert.equal(
            (
              await request(`/admin/businesses/${business.json.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { activo: false },
              })
            ).status,
            200,
          );
          assert(
            !(await request("/businesses")).json.some(
              (entry) => entry.id === business.json.id,
            ),
          );
          assert.equal(
            (
              await request(`/admin/businesses/${business.json.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { sitioWeb: "javascript:alert(1)" },
              })
            ).status,
            400,
          );
          const reward = await request("/admin/rewards", {
            cookie: admin.cookie,
            method: "POST",
            body: {
              nombre: `Cupón de ensayo ${run}`,
              descripcion: "No constituye una entrega real",
              costoMonedas: 10,
              stock: 1,
              activo: true,
            },
          });
          assert.equal(reward.status, 201, JSON.stringify(reward.json));
          rewardIds.push(reward.json.id);
          assert.equal(reward.json.demo, true);
          await prisma.user.update({
            where: { id: citizen.id },
            data: { monedas: 20 },
          });
          const attempts = await Promise.all(
            [0, 1].map(() =>
              request(`/recompensas/${reward.json.id}/canjear`, {
                cookie: citizen.cookie,
                method: "POST",
                body: {},
              }),
            ),
          );
          assert.deepEqual(
            attempts.map((entry) => entry.status).sort(),
            [201, 409],
            "Dos solicitudes simultáneas no pueden reservar la misma unidad.",
          );
          const canje = attempts.find((entry) => entry.status === 201);
          assert.equal(canje.status, 201, JSON.stringify(canje.json));
          assert.equal(canje.json.estado, "SOLICITADO_DEMO");
          assert.equal(
            (
              await request(`/recompensas/${reward.json.id}/canjear`, {
                cookie: citizen.cookie,
                method: "POST",
                body: {},
              })
            ).status,
            409,
          );
          const own = await request("/recompensas", { cookie: citizen.cookie });
          assert.equal(own.json.monedas, 10);
          assert(own.json.canjes.some((entry) => entry.id === canje.json.id));
          assert.equal(
            (await request("/admin/redemptions", { cookie: citizen.cookie }))
              .status,
            403,
          );
          assert.equal(
            (
              await request(`/admin/redemptions/${canje.json.id}`, {
                cookie: admin.cookie,
                method: "POST",
                body: { estado: "CANCELADO" },
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await request(`/admin/redemptions/${canje.json.id}`, {
                cookie: admin.cookie,
                method: "POST",
                body: { estado: "CANCELADO" },
              })
            ).status,
            409,
          );
          assert.equal(
            (await prisma.user.findUnique({ where: { id: citizen.id } }))
              .monedas,
            20,
          );
          assert.equal(
            (await prisma.reward.findUnique({ where: { id: reward.json.id } }))
              .stock,
            1,
          );
          const again = await request(
            `/recompensas/${reward.json.id}/canjear`,
            { cookie: citizen.cookie, method: "POST", body: {} },
          );
          assert.equal(again.status, 201);
          assert.equal(
            (
              await request(`/admin/redemptions/${again.json.id}`, {
                cookie: admin.cookie,
                method: "POST",
                body: { estado: "APROBADO_DEMO" },
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await prisma.redemption.findUnique({
                where: { id: again.json.id },
              })
            ).estado,
            "APROBADO_DEMO",
          );
        },
      );

      await t.test(
        "Premium de demostración y favoritos 3/20 con datos personales aislados",
        async () => {
          const route = {
            nombre: "Recorrido de ensayo",
            modo: "walking",
            origen: point,
            destino: { latitud: -14.074, longitud: -75.725 },
            ruta: {
              id: "ensayo",
              nombre: "Ensayo local",
              tipo: "corta",
              geometria: {
                type: "LineString",
                coordinates: [
                  [point.longitud, point.latitud],
                  [-75.725, -14.074],
                ],
              },
              distancia: 1000,
              duracion: 600,
            },
            tags: ["ensayo"],
          };
          assert.equal(
            (await request("/navigation/stats", { cookie: citizen.cookie }))
              .status,
            403,
          );
          for (let index = 0; index < 3; index++) {
            const favorite = await request("/navigation/favorites", {
              cookie: citizen.cookie,
              method: "POST",
              body: { ...route, nombre: `Ensayo ${index}` },
            });
            assert.equal(favorite.status, 201);
            assert.deepEqual(favorite.json.tags, []);
          }
          assert.equal(
            (
              await request("/navigation/favorites", {
                cookie: citizen.cookie,
                method: "POST",
                body: route,
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await request(`/admin/users/${citizen.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { premium: true },
              })
            ).status,
            200,
          );
          assert.equal(
            (await request("/users/me", { cookie: citizen.cookie })).json
              .usuario.premium,
            true,
          );
          const premiumFavorite = await request("/navigation/favorites", {
            cookie: citizen.cookie,
            method: "POST",
            body: route,
          });
          assert.equal(premiumFavorite.status, 201);
          assert.deepEqual(premiumFavorite.json.tags, ["ensayo"]);
          assert.equal(
            (
              await request("/navigation/history", {
                cookie: citizen.cookie,
                method: "POST",
                body: route,
              })
            ).status,
            201,
          );
          assert.equal(
            (await request("/navigation/history", { cookie: agent.cookie }))
              .json.length,
            0,
          );
          assert.equal(
            (await request("/navigation/favorites", { cookie: agent.cookie }))
              .json.length,
            0,
          );
          assert.equal(
            (
              await request(
                `/navigation/favorites/${premiumFavorite.json.id}`,
                { cookie: agent.cookie, method: "DELETE" },
              )
            ).status,
            404,
          );
          const stats = await request("/navigation/stats", {
            cookie: citizen.cookie,
          });
          assert.equal(stats.status, 200);
          assert.equal(stats.json.recorridos, 1);
          assert.equal(stats.json.metros, 1000);
          assert.equal(
            (
              await request("/users/me", {
                cookie: citizen.cookie,
                method: "PATCH",
                body: { ocultarAnuncios: true },
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await request(`/admin/users/${citizen.id}`, {
                cookie: admin.cookie,
                method: "PATCH",
                body: { premium: false },
              })
            ).status,
            200,
          );
          assert.equal(
            (await request("/users/me", { cookie: citizen.cookie })).json
              .usuario.ocultarAnuncios,
            false,
          );
        },
      );

      await t.test(
        "Ajustes evaluados: autorización, motivo, puntos y saldo nunca negativo",
        async () => {
          const route = `/admin/users/${citizen.id}/adjustments`;
          assert.equal(
            (
              await request(route, {
                cookie: agent.cookie,
                method: "POST",
                body: {
                  puntos: 2,
                  monedas: 2,
                  motivo: "Corrección exclusiva de ensayo local",
                },
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request(route, {
                cookie: admin.cookie,
                method: "POST",
                body: { puntos: 2, monedas: 2, motivo: "Corto" },
              })
            ).status,
            400,
          );
          await prisma.pointEvent.create({
            data: {
              usuarioId: citizen.id,
              clave: `mgmt:${run}:adjustment-base`,
              tipo: "ENSAYO_LOCAL",
              puntos: 10,
            },
          });
          const before = await prisma.user.findUnique({
            where: { id: citizen.id },
          });
          const result = await request(route, {
            cookie: admin.cookie,
            method: "POST",
            body: {
              puntos: -3,
              monedas: 2,
              motivo: "Corrección exclusiva de ensayo local",
            },
          });
          assert.equal(result.status, 200, JSON.stringify(result.json));
          const after = await prisma.user.findUnique({
            where: { id: citizen.id },
          });
          assert.equal(after.monedas, before.monedas + 2);
          assert.equal(after.reputacion, before.reputacion);
          assert.equal(
            (
              await prisma.pointEvent.aggregate({
                where: { usuarioId: citizen.id },
                _sum: { puntos: true },
              })
            )._sum.puntos,
            7,
          );
          const invalid = await request(route, {
            cookie: admin.cookie,
            method: "POST",
            body: {
              puntos: 0,
              monedas: -(after.monedas + 1),
              motivo: "No se debe permitir un saldo negativo",
            },
          });
          assert([400, 409].includes(invalid.status));
          assert.equal(
            (await prisma.user.findUnique({ where: { id: citizen.id } }))
              .monedas,
            after.monedas,
          );
        },
      );

      await t.test(
        "Históricos con vista previa, procedencia, repetición y acceso exclusivo de administradores",
        async () => {
          const input = {
            fuente: `Ensayo histórico local ${run}`,
            formato: "json",
            contenido: JSON.stringify([
              {
                tipo: type.slug,
                fechaEvento: "2025-10-01",
                ...point,
                nivelRiesgo: 4,
                descripcion:
                  "Registro ficticio para ensayo local; se elimina al terminar.",
                referencia: run,
              },
            ]),
          };
          assert.equal(
            (
              await request("/history/import/preview", {
                cookie: agent.cookie,
                method: "POST",
                body: input,
              })
            ).status,
            403,
          );
          const preview = await request("/history/import/preview", {
            cookie: admin.cookie,
            method: "POST",
            body: input,
          });
          assert.equal(preview.status, 200, JSON.stringify(preview.json));
          assert.equal(preview.json.totalValidos, 1);
          assert.equal(preview.json.errores.length, 0);
          importKeys.push(preview.json.registros[0].clave);
          assert.equal(
            preview.json.registros[0].fechaEvento,
            "2025-10-01T05:00:00.000Z",
          );
          const committed = await request("/history/import/commit", {
            cookie: admin.cookie,
            method: "POST",
            body: input,
          });
          assert.equal(committed.status, 201, JSON.stringify(committed.json));
          assert.equal(committed.json.importados, 1);
          const rows = await prisma.incident.findMany({
            where: { fuente: input.fuente },
          });
          historicalIds.push(...rows.map((row) => row.id));
          assert.equal(rows.length, 1);
          assert.equal(rows[0].validacion, 1);
          assert.equal(rows[0].totalReportes, 0);
          assert.equal(rows[0].historico, true);
          const repeated = await request("/history/import/commit", {
            cookie: admin.cookie,
            method: "POST",
            body: input,
          });
          assert.equal(repeated.status, 201);
          assert.equal(repeated.json.importados, 0);
          assert.equal(repeated.json.duplicados, 1);
          assert.equal(
            await prisma.pointEvent.count({ where: { usuarioId: admin.id } }),
            0,
          );
          const invalid = await request("/history/import/preview", {
            cookie: admin.cookie,
            method: "POST",
            body: {
              ...input,
              contenido: JSON.stringify([
                {
                  tipo: type.slug,
                  fechaEvento: "2025-10-01",
                  latitud: -12.0464,
                  longitud: -77.0428,
                  nivelRiesgo: 4,
                },
              ]),
            },
          });
          assert.equal(invalid.status, 200);
          assert.equal(invalid.json.totalValidos, 0);
          assert.equal(invalid.json.errores.length, 1);
          const csv = await request("/history/import/preview", {
            cookie: admin.cookie,
            method: "POST",
            body: {
              fuente: input.fuente,
              formato: "csv",
              contenido: `tipo;fechaEvento;latitud;longitud;nivelRiesgo;descripcion\n${type.slug};2025-10-02;-14.06777;-75.7286;3;"Ensayo con punto y coma; interno"`,
            },
          });
          assert.equal(csv.status, 200);
          assert.equal(csv.json.totalValidos, 1);
        },
      );

      await t.test(
        "Empate en puestos 9 a 11, cierre único, privacidad y premios históricos estables",
        async () => {
          assert.equal(
            await prisma.rankingSettlement.count({ where: { id: month } }),
            0,
            "El mes de ensayo debe estar libre.",
          );
          const ranked = [];
          for (let index = 0; index < 11; index++) {
            const user =
              index === 0
                ? citizen
                : index === 1
                  ? agent
                  : await actor(`ranking${index}`);
            ranked.push(user);
            await prisma.pointEvent.create({
              data: {
                usuarioId: user.id,
                clave: `mgmt:${run}:ranking:${index}`,
                tipo: "ENSAYO_LOCAL",
                puntos: index < 8 ? 110 - index * 10 : 20,
                creadoEn: new Date("1998-07-15T12:00:00-05:00"),
              },
            });
          }
          const before = await request(`/ranking?mes=${month}`);
          assert.equal(before.status, 200);
          const tie = before.json.entries.filter((entry) =>
            ranked.slice(8).some((user) => user.nickname === entry.nickname),
          );
          assert.equal(tie.length, 3);
          assert(
            tie.every(
              (entry) => entry.position === 9 && entry.monedasEstimadas === 5,
            ),
          );
          assert(
            before.json.entries.every(
              (entry) =>
                !["correo", "telefono", "nombres", "usuarioId"].some((key) =>
                  Object.hasOwn(entry, key),
                ),
            ),
          );
          assert.equal(
            (
              await request("/admin/ranking/settle", {
                cookie: citizen.cookie,
                method: "POST",
                body: { mes: month },
              })
            ).status,
            403,
          );
          const closed = await request("/admin/ranking/settle", {
            cookie: admin.cookie,
            method: "POST",
            body: { mes: month },
          });
          assert.equal(closed.status, 200, JSON.stringify(closed.json));
          settlementCreated = true;
          const balances = await prisma.user.findMany({
            where: { id: { in: ranked.slice(8).map((user) => user.id) } },
            select: { monedas: true },
          });
          assert(balances.every((user) => user.monedas === 5));
          assert.equal(
            (
              await request("/admin/ranking/settle", {
                cookie: admin.cookie,
                method: "POST",
                body: { mes: month },
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await request("/admin/config", {
                cookie: admin.cookie,
                method: "PATCH",
                body: { premiosRanking: Array(10).fill(1) },
              })
            ).status,
            200,
          );
          const stable = await request(`/ranking?mes=${month}`);
          assert.equal(stable.json.finalized, true);
          assert(
            stable.json.entries
              .filter((entry) => entry.position === 9)
              .every((entry) => entry.monedasEstimadas === 5),
          );
        },
      );

      await t.test(
        "Recuperación privada, invalidación de sesiones y auditoría consultable",
        async () => {
          await prisma.user.update({
            where: { id: citizen.id },
            data: { correoVerificado: true },
          });
          const recovery = await request("/users/recovery", {
            cookie: citizen.cookie,
            method: "POST",
            body: {
              telefonoNuevo: `+519${String(crypto.randomInt(10000000, 99999999))}`,
              motivo: "Cambio de teléfono exclusivo de ensayo local",
            },
          });
          assert.equal(recovery.status, 201, JSON.stringify(recovery.json));
          assert.equal(
            (await request("/admin/recoveries", { cookie: agent.cookie }))
              .status,
            403,
          );
          const list = await request("/admin/recoveries", {
            cookie: admin.cookie,
          });
          assert.equal(list.status, 200);
          assert(list.json.some((entry) => entry.id === recovery.json.id));
          assert.equal(
            (
              await request(`/admin/recoveries/${recovery.json.id}`, {
                cookie: admin.cookie,
                method: "POST",
                body: { estado: "ACEPTADA" },
              })
            ).status,
            200,
          );
          assert.equal(
            (await request("/users/me", { cookie: citizen.cookie })).status,
            401,
          );
          const stored = await prisma.user.findUnique({
            where: { id: citizen.id },
          });
          assert.equal(stored.telefonoVerificado, false);
          const audit = await request("/admin/audit", { cookie: admin.cookie });
          assert.equal(audit.status, 200);
          assert(
            audit.json.some(
              (entry) =>
                entry.usuarioId === admin.id &&
                entry.entidad === "RECUPERACION",
            ),
          );
          assert.equal(
            (await request("/admin/audit", { cookie: agent.cookie })).status,
            403,
          );
        },
      );
    } finally {
      try {
        for (const model of [
          "adImpression",
          "redemption",
          "attachment",
          "appeal",
          "recovery",
          "vote",
          "chatMessage",
          "flag",
          "review",
          "notification",
          "pointEvent",
          "auditLog",
          "routeFavorite",
          "routeHistory",
          "report",
        ])
          await prisma[model].deleteMany({
            where: { usuarioId: { in: userIds } },
          });
        await prisma.incident.deleteMany({
          where: { id: { in: historicalIds } },
        });
        await prisma.reward.deleteMany({ where: { id: { in: rewardIds } } });
        await prisma.business.deleteMany({
          where: { id: { in: businessIds } },
        });
        await prisma.incidentType.deleteMany({
          where: { id: { in: typeIds } },
        });
        await prisma.category.deleteMany({
          where: { id: { in: categoryIds } },
        });
        await prisma.appConfig.deleteMany({
          where: { clave: { in: importKeys } },
        });
        if (initialConfig)
          await prisma.appConfig.upsert({
            where: { clave: "reglas" },
            update: { valor: initialConfig.valor },
            create: { clave: "reglas", valor: initialConfig.valor },
          });
        else await prisma.appConfig.deleteMany({ where: { clave: "reglas" } });
        if (settlementCreated)
          await prisma.rankingSettlement.deleteMany({ where: { id: month } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await prisma.$disconnect();
      }
    }
  },
);
