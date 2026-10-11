const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Esta prueba exige PostgreSQL local aislado.");
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.DIRECT_URL = connection;
  process.env.NODE_ENV = "test";
  delete process.env.TRUST_PROXY;
}

test(
  "Mapa paginado y aislamiento RLS sobre PostgreSQL local",
  { skip: !connection },
  async (t) => {
    const prisma = require("../src/lib/db");
    const app = require("../src/server");
    const run = crypto.randomBytes(7).toString("hex");
    const role = "map_privacy_" + run;
    const point = { latitud: -14.06777, longitud: -75.7286 };
    const bbox = "-75.73,-14.07,-75.72,-14.06";
    const users = [],
      types = [],
      incidentIds = [];
    let category,
      roleCreated = false;
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const endpoint = `http://127.0.0.1:${server.address().port}/api/incidents`;
    const request = async (parameters) => {
      const response = await fetch(
        endpoint + "?" + new URLSearchParams(parameters),
      );
      return { status: response.status, data: await response.json() };
    };
    const addIncident = async (data) => {
      const row = await prisma.incident.create({
        data: { tipo: "Mapa " + run, descripcion: run, ...point, ...data },
      });
      incidentIds.push(row.id);
      return row;
    };
    try {
      category = await prisma.category.create({
        data: { nombre: "Mapa aislado", slug: "map-" + run },
      });
      for (const suffix of ["alpha", "beta"])
        types.push(
          await prisma.incidentType.create({
            data: {
              nombre: "Mapa " + suffix,
              slug: "map-" + run + "-" + suffix,
              categoriaId: category.id,
            },
          }),
        );
      await prisma.incident.createMany({
        data: Array.from({ length: 523 }, (_, n) => ({
          tipo: "Mapa " + run,
          descripcion: run,
          tipoId: types[n % 2].id,
          ...point,
          publicado: true,
          estado: "VALIDADO",
          evaluacion: "AGENTE",
          nivelRiesgo: 2,
        })),
      });
      const publicRows = await prisma.incident.findMany({
        where: { descripcion: run },
        select: { id: true, tipoId: true },
      });
      incidentIds.push(...publicRows.map((row) => row.id));
      const historical = await addIncident({
        tipoId: types[0].id,
        publicado: true,
        historico: true,
        estado: "RESUELTO",
        fechaEvento: new Date(Date.now() - 365 * 86400000),
      });
      const unpublished = await addIncident({
        tipoId: types[0].id,
        publicado: false,
        estado: "PENDIENTE",
      });
      const outside = await addIncident({
        tipoId: types[0].id,
        publicado: true,
        latitud: -14.2,
      });
      const expired = await addIncident({
        tipoId: types[0].id,
        publicado: true,
        historico: true,
        estado: "RESUELTO",
        fechaEvento: new Date("2000-01-01T00:00:00Z"),
      });
      const resolved = await addIncident({
        tipoId: types[0].id,
        publicado: true,
        historico: false,
        estado: "RESUELTO",
      });
      const falseIncident = await addIncident({
        tipoId: types[0].id,
        publicado: false,
        estado: "FALSO",
      });
      const unverified = await prisma.user.create({
        data: {
          nombreUsuario: "map_" + run,
          correo: "map_" + run + "@gmail.com",
          telefono: "+519" + String(crypto.randomInt(10000000, 99999999)),
          password: "scrypt$fixture_without_login",
          correoVerificado: false,
        },
      });
      users.push(unverified.id);
      const unverifiedIncident = await addIncident({
        tipoId: types[0].id,
        publicado: true,
        estado: "ACTIVO",
      });
      const report = await prisma.report.create({
        data: {
          tipo: "Privado",
          descripcion: "Documento confidencial de prueba",
          usuarioId: unverified.id,
          incidenteId: unverifiedIncident.id,
          ...point,
        },
      });
      await prisma.session.create({
        data: {
          id: "map-session-" + run,
          usuarioId: unverified.id,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      await prisma.verification.create({
        data: {
          usuarioId: unverified.id,
          tipo: "CORREO_GOOGLE",
          destino: unverified.correo,
          codigoHash: "fixture-hash-" + run,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      await prisma.attachment.create({
        data: {
          id: "map-evidence-" + run,
          usuarioId: unverified.id,
          reporteId: report.id,
          nombre: "evidencia.png",
          path: "fixture-no-file",
          mimeType: "image/png",
          size: 1,
          privado: true,
        },
      });
      const verified = await prisma.user.create({
        data: {
          nombreUsuario: "map_verified_" + run,
          correo: "map_verified_" + run + "@gmail.com",
          telefono: "+519" + String(crypto.randomInt(10000000, 99999999)),
          password: "scrypt$fixture_without_login",
          correoVerificado: true,
        },
      });
      users.push(verified.id);
      await prisma.report.create({
        data: {
          usuarioId: verified.id,
          incidenteId: publicRows[0].id,
          tipo: "Aceptado",
          descripcion: "Aporte visible",
          estado: "VALIDADO",
          ...point,
        },
      });
      const withheldFiles = [];
      for (const state of ["FALSO", "RETIRADO", "EN_REVISION"]) {
        const contribution = await prisma.report.create({
          data: {
            usuarioId: verified.id,
            incidenteId: publicRows[0].id,
            tipo: "Aporte reservado",
            descripcion: "No debe mostrarse",
            estado: state,
            ...point,
          },
        });
        const file = await prisma.attachment.create({
          data: {
            id: "withheld-" + state.toLowerCase() + "-" + run,
            usuarioId: verified.id,
            reporteId: contribution.id,
            nombre: "previa-publicacion.png",
            path: "fixture-not-read",
            mimeType: "image/png",
            size: 1,
            privado: false,
            tipo: "PUBLICO",
          },
        });
        withheldFiles.push(file.id);
      }

      await t.test(
        "Más de 500 incidentes se recorren sin duplicados, sin privados y conservando el histórico",
        async () => {
          const expected = new Set([
            ...publicRows.map((row) => row.id),
            historical.id,
          ]);
          const received = [],
            cursors = [];
          let cursor = null;
          do {
            assert.ok(cursors.length < 10, "La paginación debe terminar");
            const result = await request({
              bbox,
              ...(cursor ? { after: String(cursor) } : {}),
            });
            assert.equal(result.status, 200, JSON.stringify(result.data));
            assert.ok(result.data.items.length <= 250);
            received.push(...result.data.items.map((row) => row.id));
            if (result.data.nextCursor !== null) {
              assert.ok(cursor === null || result.data.nextCursor < cursor);
              cursors.push(result.data.nextCursor);
            }
            cursor = result.data.nextCursor;
          } while (cursor !== null);
          assert.equal(cursors.length, 2);
          assert.equal(received.length, 524);
          assert.equal(new Set(received).size, received.length);
          assert.deepEqual(new Set(received), expected);
          for (const hidden of [
            unpublished,
            outside,
            expired,
            resolved,
            falseIncident,
            unverifiedIncident,
          ])
            assert.ok(!received.includes(hidden.id));
        },
      );

      await t.test(
        "Adjuntos antes públicos de aportes falsos, retirados o retenidos quedan protegidos aunque el grupo siga visible",
        async () => {
          const group = await fetch(endpoint + "/" + publicRows[0].id);
          assert.equal(group.status, 200);
          const detail = await group.json();
          assert.equal(detail.publicado, true);
          assert.equal(detail.reportes.length, 1);
          assert.equal(detail.reportes[0].estado, "VALIDADO");
          for (const fileId of withheldFiles) {
            const response = await fetch(
              endpoint.replace(/\/incidents$/, "/uploads/") + fileId,
            );
            assert.equal(response.status, 403, fileId);
            await response.arrayBuffer();
          }
        },
      );

      await t.test(
        "El filtro de tipo se conserva en todas las páginas y los cursores inválidos son 400",
        async () => {
          const found = [];
          let cursor = null;
          let pageCount = 0;
          do {
            assert.ok(++pageCount < 10, "La paginación filtrada debe terminar");
            const result = await request({
              bbox,
              tipo: types[0].slug,
              ...(cursor ? { after: String(cursor) } : {}),
            });
            assert.equal(result.status, 200, JSON.stringify(result.data));
            assert.ok(
              result.data.items.every((row) => row.tipoId === types[0].id),
            );
            found.push(...result.data.items.map((row) => row.id));
            cursor = result.data.nextCursor;
          } while (cursor !== null);
          assert.deepEqual(
            new Set(found),
            new Set([
              ...publicRows
                .filter((row) => row.tipoId === types[0].id)
                .map((row) => row.id),
              historical.id,
            ]),
          );
          for (const after of [
            "2147483648",
            "9007199254740991",
            "0",
            "-1",
            "1.5",
            "invalid",
          ])
            assert.equal(
              (await request({ bbox, after })).status,
              400,
              "after=" + after,
            );
        },
      );

      await t.test(
        "RLS activa protege las tablas aunque se conceda SELECT a un rol ajeno al propietario",
        async () => {
          const protectedTables = [
            "User",
            "Session",
            "Verification",
            "Report",
            "Attachment",
            "ChatMessage",
            "Notification",
            "Appeal",
            "Recovery",
            "RouteHistory",
            "RouteFavorite",
            "AuditLog",
            "UsageCounter",
          ];
          const tables =
            await prisma.$queryRaw`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`;
          for (const name of protectedTables) {
            const row = tables.find((table) => table.relname === name);
            assert.ok(row, name + " existe");
            assert.equal(row.relrowsecurity, true, name + " tiene RLS");
            assert.notEqual(row.owner, role);
          }
          await prisma.$executeRawUnsafe(
            `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`,
          );
          roleCreated = true;
          await prisma.$executeRawUnsafe(
            `GRANT USAGE ON SCHEMA public TO "${role}"`,
          );
          await prisma.$executeRawUnsafe(
            `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"`,
          );
          await prisma.$transaction(async (db) => {
            await db.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
            const [identity] = await db.$queryRaw`SELECT current_user AS role`;
            assert.equal(identity.role, role);
            for (const name of protectedTables) {
              const [count] = await db.$queryRawUnsafe(
                `SELECT COUNT(*)::int AS count FROM "${name}"`,
              );
              assert.equal(
                count.count,
                0,
                name + " no expone registros al rol con SELECT",
              );
            }
          });
          // SET LOCAL ROLE termina con la transacción; Prisma conserva acceso backend.
          assert.equal(
            (await prisma.user.findUnique({ where: { id: unverified.id } }))
              .correo,
            unverified.correo,
          );
          assert.equal(
            await prisma.report.count({ where: { id: report.id } }),
            1,
          );
          assert.equal(
            await prisma.attachment.count({ where: { reporteId: report.id } }),
            1,
          );
          assert.equal(
            (await request({ bbox, tipo: types[1].slug })).status,
            200,
          );
        },
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      try {
        if (roleCreated) {
          await prisma.$executeRawUnsafe(
            `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "${role}"`,
          );
          await prisma.$executeRawUnsafe(
            `REVOKE USAGE ON SCHEMA public FROM "${role}"`,
          );
          await prisma.$executeRawUnsafe(`DROP ROLE "${role}"`);
        }
        await prisma.attachment.deleteMany({
          where: { usuarioId: { in: users } },
        });
        await prisma.report.deleteMany({ where: { usuarioId: { in: users } } });
        await prisma.incident.deleteMany({
          where: { id: { in: incidentIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: users } } });
        await prisma.incidentType.deleteMany({
          where: { id: { in: types.map((row) => row.id) } },
        });
        if (category)
          await prisma.category.delete({ where: { id: category.id } });
      } finally {
        await prisma.$disconnect();
      }
    }
  },
);
