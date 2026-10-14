"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  if (!["localhost", "127.0.0.1"].includes(new URL(connection).hostname))
    throw new Error(
      "Estadísticas y exportaciones sólo se prueban en PostgreSQL local aislado.",
    );
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
}
test(
  "administrative statistics and complete snapshot exports against PostgreSQL",
  { skip: !connection },
  async (t) => {
    const db = require("../src/lib/db");
    const app = require("../src/server");
    const { adminStatistics } = require("../src/lib/admin-statistics");
    const {
      createExportService,
      COLUMNS,
    } = require("../src/lib/admin-exports");
    const { hashToken } = require("../src/lib/auth");
    const run = crypto.randomBytes(6).toString("hex");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/admin`;
    const users = [],
      incidentIds = [],
      typeIds = [],
      categoryIds = [];
    const services = [];
    async function request(path, cookie) {
      const response = await fetch(base + path, {
        headers: cookie ? { Cookie: cookie } : {},
      });
      return {
        status: response.status,
        data: await response.json(),
        cache: response.headers.get("cache-control"),
      };
    }
    try {
      for (let index = 0; index < 5; index++) {
        const user = await db.user.create({
          data: {
            nombreUsuario: `stats_${run}_${index}`,
            correo: `stats_${run}_${index}@fixture.invalid`,
            telefono: `+999${crypto.randomInt(100000000, 999999999)}`,
            password: "SECRET_NOT_EXPORTED",
            rol: index === 4 ? "AGENTE" : "ADMIN",
            tipoAgente: index === 4 ? "COLABORADOR" : null,
            correoVerificado: index !== 3,
            fechaCreacion: new Date("2000-01-01"),
          },
        });
        users.push(user);
      }
      const cookieFor = async (user) => {
        const token = crypto.randomBytes(32).toString("hex");
        await db.session.create({
          data: {
            id: hashToken(token),
            usuarioId: user.id,
            expiresAt: new Date(Date.now() + 3600000),
          },
        });
        return `civigo_session=${token}`;
      };
      const adminCookie = await cookieFor(users[0]),
        agentCookie = await cookieFor(users[4]);
      const security = await db.category.upsert({
        where: { slug: "seguridad" },
        create: { slug: "seguridad", nombre: "Seguridad y delitos" },
        update: {},
      });
      // This isolated test runner owns the database; keep a pre-existing category
      // intact when this file is included in the full integration suite.
      const infrastructure = await db.category.create({
        data: { slug: `stats-${run}`, nombre: "Infraestructura" },
      });
      categoryIds.push(infrastructure.id);
      const crime = await db.incidentType.create({
        data: {
          slug: `stats-robo-${run}`,
          nombre: "Robo fixture",
          categoriaId: security.id,
        },
      });
      const pothole = await db.incidentType.create({
        data: {
          slug: `stats-bache-${run}`,
          nombre: "Bache fixture",
          categoriaId: infrastructure.id,
        },
      });
      typeIds.push(crime.id, pothole.id);
      const clock = new Date("2026-10-13T17:00:00.000Z");
      const eventDates = [
        "2026-05-01T04:59:59Z",
        "2026-05-01T05:00:00Z",
        "2026-09-01T04:59:59Z",
        "2026-09-01T05:00:00Z",
        "2026-09-13T16:59:59Z",
        "2026-09-13T17:00:00Z",
        "2026-09-30T23:00:00Z",
        "2026-10-01T04:59:59Z",
        "2026-10-01T05:00:00Z",
        "2026-10-13T16:59:59Z",
        "2026-10-13T17:00:00Z",
        "2026-11-01T12:00:00Z",
      ];
      async function pair(type, date, district = "Ica", options = {}) {
        const row = await db.incident.create({
          data: {
            tipo: type.nombre,
            tipoId: type.id,
            distrito: district,
            descripcion: "Descripción de hecho completa para la exportación.",
            latitud: -14.072,
            longitud: -75.736,
            estado: "VALIDADO",
            publicado: true,
            evaluacion: "AGENTE",
            nivelRiesgo: 3,
            fechaEvento: new Date(date),
            fechaCreacion: new Date("2000-01-01"),
            ...options,
          },
        });
        incidentIds.push(row.id);
        await db.report.create({
          data: {
            tipo: type.nombre,
            tipoId: type.id,
            usuarioId: users[0].id,
            incidenteId: row.id,
            descripcion: row.descripcion,
            latitud: row.latitud,
            longitud: row.longitud,
            estado: "VALIDADO",
            nivelRiesgo: 3,
            imagen: "https://private.invalid/no-export",
            gpsLatitud: -14.1,
            gpsLongitud: -75.7,
            fechaEvento: row.fechaEvento,
            fechaCreacion: new Date("2000-01-01"),
          },
        });
        return row;
      }
      for (const date of eventDates) await pair(crime, date);
      await pair(pothole, "2026-10-05T12:00:00Z", "Parcona", {
        estado: "RESUELTO",
        nivelRiesgo: null,
      });
      await pair(pothole, "2026-09-05T12:00:00Z", "Tate");
      await pair(pothole, "2026-10-05T12:00:00Z", "Tate");
      await pair(pothole, "2026-10-06T12:00:00Z", "Tate");
      await t.test(
        "event dates respect UTC-5 boundaries, same-day crime comparison and zero baseline",
        async () => {
          const stats = await adminStatistics(db, { type: crime.slug }, clock);
          assert.equal(stats.totals.incidents, 9);
          assert.equal(stats.totals.reports, 9);
          assert.equal(stats.totals.accounts, 5);
          assert.equal(stats.totals.verifiedAccounts, 4);
          assert.deepEqual(stats.crimeComparison, {
            current: 2,
            previousSameDays: 2,
            previousFullMonth: 5,
            deltaPercent: 0,
          });
          assert.deepEqual(stats.incidentComparison, stats.crimeComparison);
          assert.deepEqual(
            stats.datasets.timeline.map((row) => row.incidents),
            [1, 0, 0, 1, 5, 2],
          );
          assert.equal(stats.period.dateField, "fechaEvento");
          assert.equal(stats.accountScope, "ALL_ACCOUNTS");
          assert.equal(
            stats.datasets.accounts.find((row) => row.role === "ADMIN")
              .verified,
            3,
          );
          assert.equal(
            stats.datasets.accounts.find((row) => row.role === "AGENTE").count,
            1,
          );
          const district = await adminStatistics(
            db,
            { type: pothole.slug, district: "Parcona" },
            clock,
          );
          assert.equal(district.totals.incidents, 1);
          assert.deepEqual(district.datasets.severities, [
            { key: "sin-evaluar", label: "Sin evaluar", count: 1 },
          ]);
          assert.equal(district.crimeComparison.deltaPercent, null);
          assert.deepEqual(district.incidentComparison, {
            current: 1,
            previousSameDays: 0,
            previousFullMonth: 0,
            deltaPercent: null,
          });
          assert.equal(JSON.stringify(stats).includes(users[0].correo), false);
          assert.equal(
            JSON.stringify(stats).includes("SECRET_NOT_EXPORTED"),
            false,
          );
        },
      );
      await t.test(
        "non-security incidents compare their own counts independently of the security subset",
        async () => {
          const stats = await adminStatistics(
            db,
            { type: pothole.slug, district: "Tate" },
            clock,
          );
          assert.deepEqual(stats.incidentComparison, {
            current: 2,
            previousSameDays: 1,
            previousFullMonth: 1,
            deltaPercent: 100,
          });
          assert.deepEqual(stats.crimeComparison, {
            current: 0,
            previousSameDays: 0,
            previousFullMonth: 0,
            deltaPercent: null,
          });
          assert.equal(stats.totals.incidents, 3);
          const { statisticsRows } = require("../src/lib/admin-exports");
          const rows = statisticsRows(stats);
          const all = rows.filter((row) => row.grupo === "incidentComparison");
          const security = rows.filter(
            (row) => row.grupo === "crimeComparison",
          );
          assert.equal(all.length, 4);
          assert.equal(security.length, 4);
          assert.equal(all.find((row) => row.clave === "current").cantidad, 2);
          assert.equal(
            all.find((row) => row.clave === "deltaPercent").cantidad,
            100,
          );
          assert.equal(
            security.find((row) => row.clave === "current").cantidad,
            0,
          );
          assert.equal(
            security.find((row) => row.clave === "deltaPercent").cantidad,
            null,
          );
          assert.equal(
            all.every((row) =>
              row.etiqueta.startsWith("Todos los incidentes: "),
            ),
            true,
          );
          assert.equal(
            security.every((row) =>
              row.etiqueta.startsWith("Incidentes de seguridad: "),
            ),
            true,
          );
        },
      );
      await t.test(
        "both endpoints require ADMIN before any filter/query work and never cache",
        async () => {
          for (const path of [
            "/statistics?district=invalid",
            "/exports?table=invalid",
          ]) {
            assert.equal((await request(path)).status, 401);
            assert.equal((await request(path, agentCookie)).status, 403);
          }
          const response = await request(
            `/statistics?type=${crime.slug}`,
            adminCookie,
          );
          assert.equal(response.status, 200);
          assert.equal(response.cache, "no-store");
          for (const path of [
            "/statistics?district=unknown",
            "/statistics?type=unknown",
            "/statistics?district=Ica&district=Parcona",
            "/exports?table=sesiones",
            "/exports?table=incidentes&limit=0",
            "/exports?table=usuarios&limit=251",
          ])
            assert.equal((await request(path, adminCookie)).status, 400, path);
        },
      );
      // Complete 550 incidents and associated reports with immutable fixture rows.
      for (let index = incidentIds.length; index < 550; index++)
        await pair(
          crime,
          "2026-10-05T12:00:00Z",
          index % 2 ? "Ica" : "Parcona",
        );
      await t.test(
        "550 rows export in stable pages, excluding new rows and retaining original values after updates",
        async () => {
          const response = await request(
            "/exports?table=incidentes",
            adminCookie,
          );
          assert.equal(response.status, 200);
          assert.equal(response.data.rows.length, 250);
          assert.equal(response.data.snapshot.totalRows, 550);
          const firstId = response.data.rows[0].id;
          await db.incident.update({
            where: { id: incidentIds[300] },
            data: { descripcion: "CHANGED AFTER SNAPSHOT" },
          });
          const added = await pair(crime, "2026-10-06T12:00:00Z");
          const collected = [...response.data.rows];
          let cursor = response.data.nextCursor;
          while (cursor) {
            const page = await request(
              `/exports?table=incidentes&cursor=${encodeURIComponent(cursor)}`,
              adminCookie,
            );
            assert.equal(page.status, 200, JSON.stringify(page.data));
            assert.equal(page.data.snapshot.id, response.data.snapshot.id);
            collected.push(...page.data.rows);
            cursor = page.data.nextCursor;
          }
          assert.equal(collected.length, 550);
          assert.equal(new Set(collected.map((row) => row.id)).size, 550);
          assert.equal(collected[0].id, firstId);
          assert.equal(
            collected.some((row) => row.id === added.id),
            false,
          );
          assert.equal(
            collected.some(
              (row) => row.descripcion === "CHANGED AFTER SNAPSHOT",
            ),
            false,
          );
          const data = JSON.stringify(collected);
          assert.equal(
            /SECRET_NOT_EXPORTED|private\.invalid|gpsLatitud|password|firebase|token|session/i.test(
              data,
            ),
            false,
          );
        },
      );
      await t.test(
        "all export tables whitelist scalar fields and include all report/catalog/account rows",
        async () => {
          const service = createExportService();
          services.push(service);
          const actor = {
            id: users[0].id,
            rol: "ADMIN",
            sessionId: "direct-fixture",
          };
          for (const table of [
            "usuarios",
            "reportes",
            "catalogo",
            "estadisticas",
          ]) {
            const collected = [];
            let page = await service.exportPage(db, actor, { table });
            const snapshotId = page.snapshot.id;
            for (;;) {
              collected.push(...page.rows);
              assert.deepEqual(page.columns, COLUMNS[table]);
              for (const row of page.rows) {
                assert.deepEqual(
                  Object.keys(row),
                  COLUMNS[table].map(({ key }) => key),
                );
                assert.equal(
                  Object.values(row).every(
                    (cell) =>
                      cell === null ||
                      ["string", "number", "boolean"].includes(typeof cell),
                  ),
                  true,
                );
              }
              if (!page.nextCursor) break;
              page = await service.exportPage(db, actor, {
                table,
                cursor: page.nextCursor,
              });
              assert.equal(page.snapshot.id, snapshotId);
            }
            if (table === "usuarios") assert.equal(collected.length, 5);
            if (table === "reportes") assert.equal(collected.length, 551);
            if (table === "catalogo")
              assert.equal(collected.length, await db.incidentType.count());
            if (table === "estadisticas")
              assert.equal(
                collected.filter((row) => row.grupo === "timeline").length,
                6,
              );
            assert.equal(
              JSON.stringify(collected).includes("SECRET_NOT_EXPORTED"),
              false,
            );
            assert.equal(
              JSON.stringify(collected).includes("private.invalid"),
              false,
            );
          }
          const filtered = await service.exportPage(db, actor, {
            table: "incidentes",
            district: "Parcona",
            type: crime.slug,
          });
          const expected = await db.incident.count({
            where: { distrito: "Parcona", tipoId: crime.id },
          });
          assert.equal(filtered.snapshot.totalRows, expected);
          assert.equal(
            filtered.rows.every(
              (row) => row.distrito === "Parcona" && row.tipoId === crime.id,
            ),
            true,
          );
        },
      );
      await t.test(
        "oversized snapshots fail explicitly rather than truncate and free failed reservations",
        async () => {
          const limited = createExportService({
            maxRows: 500,
            maxOwnerSnapshots: 1,
          });
          services.push(limited);
          await assert.rejects(
            limited.exportPage(
              db,
              { id: users[0].id, rol: "ADMIN" },
              { table: "incidentes" },
            ),
            (error) => error.status === 413,
          );
          const result = await limited.exportPage(
            db,
            { id: users[0].id, rol: "ADMIN" },
            { table: "usuarios" },
          );
          assert.equal(result.rows.length, 5);
        },
      );
    } finally {
      for (const service of services) service.close();
      await new Promise((resolve) => server.close(resolve));
      await db.report.deleteMany({
        where: { incidenteId: { in: incidentIds } },
      });
      await db.incident.deleteMany({ where: { id: { in: incidentIds } } });
      await db.session.deleteMany({
        where: { usuarioId: { in: users.map((row) => row.id) } },
      });
      await db.user.deleteMany({
        where: { id: { in: users.map((row) => row.id) } },
      });
      await db.incidentType.deleteMany({ where: { id: { in: typeIds } } });
      await db.category.deleteMany({ where: { id: { in: categoryIds } } });
      await db.$disconnect();
    }
  },
);
