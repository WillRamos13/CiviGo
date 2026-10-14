"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  appendInitialIncidentBatch,
} = require("../src/lib/append-initial-incidents");
const {
  identityFingerprint,
  fingerprint,
} = require("../src/lib/explicit-data-reset");
const { planInitialPhotos } = require("../src/lib/initial-report-photos");
const enabled = process.env.TEST_DATABASE_URL;
if (enabled && !["localhost", "127.0.0.1"].includes(new URL(enabled).hostname))
  throw new Error(
    "La carga adicional se prueba sólo en una base local aislada.",
  );

test(
  "append adds 50 FK-linked pairs and photo plan while preserving all 500 existing incidents, accounts, sessions and files",
  { skip: !enabled },
  async () => {
    const { PGlite } = require("@electric-sql/pglite");
    const { LocalSocketServer } = require("../scripts/local-socket-server");
    const { PrismaClient } = require("@prisma/client");
    const pg = await PGlite.create();
    const socket = new LocalSocketServer({
      db: pg,
      port: 0,
      host: "127.0.0.1",
    });
    const migrations = path.join(__dirname, "../prisma/migrations");
    for (const name of (await fs.readdir(migrations)).sort())
      if (/^\d/.test(name))
        await pg.exec(
          await fs.readFile(
            path.join(migrations, name, "migration.sql"),
            "utf8",
          ),
        );
    await socket.start();
    const connection = `postgresql://postgres:postgres@127.0.0.1:${socket.server.address().port}/postgres?connection_limit=1&pgbouncer=true&statement_cache_size=0`;
    const db = new PrismaClient({ datasources: { db: { url: connection } } });
    try {
      const center = { latitud: -14.0721246, longitud: -75.7359964 };
      const category = await db.category.create({
        data: { slug: "append-fixture", nombre: "Fixture" },
      });
      const type = await db.incidentType.create({
        data: {
          slug: "bache",
          nombre: "Bache",
          categoriaId: category.id,
          persistente: true,
        },
      });
      const users = [];
      for (let index = 0; index < 5; index++)
        users.push(
          await db.user.create({
            data: {
              correo: `append${index}@fixture.test`,
              nombreUsuario: `append${index}`,
              password: "untouched-local-fixture",
              telefono: `+999800000000${index}`,
              correoVerificado: true,
              rol: index === 4 ? "AGENTE" : "ADMIN",
              tipoAgente: index === 4 ? "COLABORADOR" : null,
            },
          }),
        );
      const previous = Array.from({ length: 500 }, (_, index) => ({
        id: index + 1,
        tipo: type.nombre,
        tipoId: type.id,
        descripcion: `Reporte anterior conservado ${index + 1}`,
        latitud: center.latitud + 0.005 + index * 0.000001,
        longitud: center.longitud + 0.01,
        estado: "VALIDADO",
        publicado: true,
        fuente: "CARGA_INICIAL",
      }));
      await db.incident.createMany({ data: previous });
      await db.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"Incident"', 'id'), 500, true)`,
      );
      await db.report.createMany({
        data: previous.map(({ id, publicado, fuente, ...row }) => ({
          ...row,
          incidenteId: id,
          usuarioId: users[0].id,
        })),
      });
      await db.session.create({
        data: {
          id: "preserved-session",
          usuarioId: users[0].id,
          expiresAt: new Date("2030-01-01"),
        },
      });
      await db.attachment.create({
        data: {
          id: "10000000-0000-4000-8000-000000000001",
          usuarioId: users[0].id,
          reporteId: 1,
          nombre: "Imagen previa conservada",
          mimeType: "image/jpeg",
          size: 15,
          path: "/fixture/preserved",
        },
      });
      const oldIds = previous.map(({ id }) => id);
      async function preservedState() {
        return fingerprint({
          users: await db.user.findMany({ orderBy: { id: "asc" } }),
          incidents: await db.incident.findMany({
            where: { id: { in: oldIds } },
            orderBy: { id: "asc" },
          }),
          reports: await db.report.findMany({
            where: { incidenteId: { in: oldIds } },
            orderBy: { id: "asc" },
          }),
          sessions: await db.session.findMany(),
          attachments: await db.attachment.findMany(),
        });
      }
      const before = await preservedState();
      const now = new Date("2026-10-13T18:00:00Z");
      const dataset = {
        entries: Array.from({ length: 50 }, (_, index) => {
          const point = {
            latitud: center.latitud + 0.00001 + index * 0.00003,
            longitud: center.longitud,
          };
          const description = `Desnivel en la vía del tramo adicional ${index + 1}, que dificulta el paso de vehículos.`;
          return {
            incident: {
              tipo: type.nombre,
              tipoId: type.id,
              descripcion: description,
              ...point,
              distrito: "Ica",
              nivelRiesgo: 2,
              estado: "VALIDADO",
              totalReportes: 1,
              validacion: 1,
              publicado: true,
              evaluacion: "AGENTE",
              individual: false,
              historico: false,
              emergencia: false,
              persistente: true,
              fuente: "CARGA_INICIAL",
              fechaEvento: now,
              fechaPublicacion: now,
            },
            report: {
              usuarioId: users[index % 5].id,
              tipo: type.nombre,
              tipoId: type.id,
              descripcion: description,
              ...point,
              nivelRiesgo: 2,
              estado: "VALIDADO",
              confirmaciones: 0,
              fechaEvento: now,
            },
            review: {
              usuarioId: users[0].id,
              accion: "CARGA_INICIAL",
              motivo: "Carga adicional ficticia sin IA ni pruebas del hecho.",
              datos: { synthetic: true },
            },
            provenance: { synthetic: true },
          };
        }),
      };
      const roads = {
        boundary: {
          outer: [
            [
              [-75.76, -14.1],
              [-75.7, -14.1],
              [-75.7, -14.04],
              [-75.76, -14.04],
              [-75.76, -14.1],
            ],
          ],
          inner: [],
        },
      };
      const args = {
        database: db,
        connection,
        confirmTarget: identityFingerprint(connection),
        dataset,
        userIds: users.map(({ id }) => id),
        reviewerId: users[0].id,
        center,
        roads,
      };
      const failDb = {
        incidentType: db.incidentType,
        $transaction: (callback, options) =>
          db.$transaction(
            (tx) =>
              callback(
                new Proxy(tx, {
                  get(target, property) {
                    if (property === "report")
                      return {
                        ...target.report,
                        createMany: async () => {
                          throw new Error(
                            "forced append report insertion failure",
                          );
                        },
                      };
                    return Reflect.get(target, property);
                  },
                }),
              ),
            options,
          ),
      };
      await assert.rejects(
        appendInitialIncidentBatch({ ...args, database: failDb }),
        /forced append/,
      );
      assert.equal(await db.incident.count(), 500);
      assert.equal(await preservedState(), before);
      const result = await appendInitialIncidentBatch(args);
      assert.deepEqual(result.counts, { incidents: 550, reports: 550 });
      assert.equal(result.reports.length, 50);
      assert.equal(result.existingRecordsModified, 0);
      assert.equal(await preservedState(), before);
      assert.ok(
        result.reports.every(
          (row) =>
            row.incidenteId > 500 &&
            row.incidente.latitud === row.latitud &&
            row.adjuntos.length === 0,
        ),
      );
      const manifest = {
        bache: {
          file: path.resolve(__dirname, "../.local/reference.jpg"),
          mimeType: "image/jpeg",
          size: 100,
          sha256: "e".repeat(64),
          caption: "Referencia de bache",
          author: "Fixture",
          license: "Public domain",
          licenseUrl:
            "https://commons.wikimedia.org/wiki/Commons:Copyright_tags#Public_domain",
          sourceUrl:
            "https://commons.wikimedia.org/wiki/File:Fixture_reference.jpg",
        },
      };
      const media = planInitialPhotos({
        reports: result.reports,
        manifest,
        userIds: args.userIds,
        reviewerId: args.reviewerId,
        expectedCount: 50,
        targetPath: ({ id, userId }) =>
          `supabase://fixture/uploads/${userId}/${id}`,
      });
      assert.equal(media.uploads.length, 50);
      assert.equal(media.summary.distinctStorageObjects, 50);
      await assert.rejects(appendInitialIncidentBatch(args), {
        code: "APPEND_COUNTS",
      });
      assert.equal(await db.incident.count(), 550);
      assert.equal(await preservedState(), before);
    } finally {
      await db.$disconnect();
      await socket.stop();
      await pg.close();
    }
  },
);
