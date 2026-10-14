"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const reset = require("../src/lib/explicit-data-reset");
const { verifyPassword } = require("../src/lib/password");
const { permissionKeys } = require("../src/lib/agent-permissions");
const connection = process.env.TEST_DATABASE_URL;
if (
  connection &&
  !["localhost", "127.0.0.1"].includes(new URL(connection).hostname)
)
  throw new Error(
    "El reinicio destructivo se prueba únicamente en PostgreSQL aislado local.",
  );

function input() {
  return {
    format: reset.INPUT_FORMAT,
    accounts: Array.from({ length: 5 }, (_, index) => ({
      correo: `reset${index}@civigo.test`,
      nombreUsuario: `reset${index}`,
      password: "local-fixture-password",
      rol: index === 4 ? "AGENTE" : "ADMIN",
      ...(index === 4 ? { tipoAgente: "COLABORADOR" } : {}),
    })),
    datasetOptions: {
      now: "2026-10-13T18:00:00.000Z",
      count: 500,
      seed: "isolated-integration-fixture",
    },
  };
}

function buildDataset({ types, authorIds, reviewerId, now, count }) {
  const type = types.find(({ slug }) => slug === "bache");
  return {
    entries: Array.from({ length: count }, (_, index) => {
      const description = `Desnivel en la calzada del tramo local ${index + 1}, que reduce el paso de vehículos.`;
      const coordinates = {
        latitud: -14.04 - index * 0.00001,
        longitud: -75.7,
      };
      return {
        incident: {
          tipo: type.nombre,
          tipoId: type.id,
          descripcion: description,
          ...coordinates,
          distrito: "Ica",
          nivelRiesgo: 2,
          estado: "VALIDADO",
          totalReportes: 1,
          validacion: 1,
          publicado: true,
          evaluacion: "AGENTE",
          individual: type.individual,
          historico: type.historico,
          emergencia: type.emergencia,
          persistente: type.persistente,
          fuente: "CARGA_INICIAL",
          fechaEvento: now,
          fechaPublicacion: now,
          fechaCreacion: now,
        },
        report: {
          usuarioId: authorIds[index % authorIds.length],
          tipo: type.nombre,
          tipoId: type.id,
          descripcion: description,
          ...coordinates,
          nivelRiesgo: 2,
          estado: "VALIDADO",
          confirmaciones: 0,
          fechaEvento: now,
          fechaCreacion: now,
        },
        review: {
          usuarioId: reviewerId,
          accion: "CARGA_INICIAL",
          motivo:
            "Carga ficticia de integración, sin revisión de pruebas ni IA.",
          datos: { synthetic: true },
        },
        provenance: { synthetic: true },
      };
    }),
    summary: { synthetic: true, count },
  };
}

test(
  "atomic account/report reset: real foreign keys, rollback, protected advertising and confirmed bulk pairing",
  { skip: !connection },
  async () => {
    const { PrismaClient } = require("@prisma/client");
    const { PGlite } = require("@electric-sql/pglite");
    const { LocalSocketServer } = require("../scripts/local-socket-server");
    const fs = require("node:fs/promises");
    const path = require("node:path");
    const isolated = await PGlite.create();
    const socket = new LocalSocketServer({
      db: isolated,
      port: 0,
      host: "127.0.0.1",
    });
    const migrations = path.join(__dirname, "../prisma/migrations");
    for (const name of (await fs.readdir(migrations)).sort()) {
      if (/^\d/.test(name))
        await isolated.exec(
          await fs.readFile(
            path.join(migrations, name, "migration.sql"),
            "utf8",
          ),
        );
    }
    await socket.start();
    const connection = `postgresql://postgres:postgres@127.0.0.1:${socket.server.address().port}/postgres?connection_limit=1&pgbouncer=true&statement_cache_size=0`;
    const db = new PrismaClient({ datasources: { db: { url: connection } } });
    try {
      await isolated.exec(`
      CREATE TABLE "AuthSession" (id TEXT PRIMARY KEY, "usuarioId" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE);
      CREATE TABLE "IncidentConfirmation" (id SERIAL PRIMARY KEY, "usuarioId" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, "incidenteId" INTEGER NOT NULL REFERENCES "Incident"(id) ON DELETE CASCADE);
      CREATE TABLE "ReportComment" (id SERIAL PRIMARY KEY, "usuarioId" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT, "reporteId" INTEGER NOT NULL REFERENCES "Report"(id) ON DELETE RESTRICT, comentario TEXT NOT NULL);
      CREATE TABLE "ReportConfirmation" (id SERIAL PRIMARY KEY, "usuarioId" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT, "reporteId" INTEGER NOT NULL REFERENCES "Report"(id) ON DELETE RESTRICT);
    `);
      // This test owns the isolated database created by test-local.js, never a remote one.
      const before = await reset.captureResetSnapshot(db, { connection });
      assert.equal(before.tables.User.length, 0);
      assert.equal(before.tables.Incident.length, 0);
      const category = await db.category.create({
        data: { slug: "reset-local", nombre: "Fixture" },
      });
      const type = await db.incidentType.create({
        data: {
          slug: "bache",
          nombre: "Bache",
          categoriaId: category.id,
          persistente: true,
        },
      });
      const old = await db.user.create({
        data: {
          correo: input().accounts[0].correo,
          nombreUsuario: input().accounts[0].nombreUsuario,
          password: "old-local-fixture",
          telefono: "+9997000000001",
        },
      });
      const incident = await db.incident.create({
        data: {
          tipo: type.nombre,
          tipoId: type.id,
          latitud: -14.04,
          longitud: -75.7,
        },
      });
      const report = await db.report.create({
        data: {
          usuarioId: old.id,
          tipo: type.nombre,
          tipoId: type.id,
          descripcion: "Aporte antiguo de integración.",
          latitud: -14.04,
          longitud: -75.7,
          incidenteId: incident.id,
        },
      });
      await db.$executeRaw`INSERT INTO public."AuthSession" (id, "usuarioId") VALUES ('old-legacy-session', ${old.id})`;
      await db.$executeRaw`INSERT INTO public."IncidentConfirmation" ("usuarioId", "incidenteId") VALUES (${old.id}, ${incident.id})`;
      await db.$executeRaw`INSERT INTO public."ReportComment" ("usuarioId", "reporteId", comentario) VALUES (${old.id}, ${report.id}, 'Comentario histórico local')`;
      await db.$executeRaw`INSERT INTO public."ReportConfirmation" ("usuarioId", "reporteId") VALUES (${old.id}, ${report.id})`;
      const file = await db.attachment.create({
        data: {
          id: randomUUID(),
          usuarioId: old.id,
          reporteId: report.id,
          nombre: "proof.png",
          mimeType: "image/png",
          size: 10,
          path: "/local/private-proof.png",
        },
      });
      const adFile = await db.attachment.create({
        data: {
          id: randomUUID(),
          usuarioId: old.id,
          nombre: "ad.png",
          mimeType: "image/png",
          size: 10,
          path: "/local/advertising.png",
          tipo: "ANUNCIO",
        },
      });
      const business = await db.business.create({
        data: {
          nombre: "Negocio conservado",
          descripcion: "Fixture",
          direccion: "Fixture",
          latitud: -14.04,
          longitud: -75.7,
        },
      });
      const ad = await db.mapAnnouncement.create({
        data: {
          tipo: "NEGOCIO",
          titulo: "Anuncio conservado",
          imagenId: adFile.id,
          negocioId: business.id,
        },
      });
      const reward = await db.reward.create({
        data: {
          nombre: "Recompensa conservada",
          descripcion: "Fixture",
          costoMonedas: 10,
        },
      });
      await db.session.create({
        data: {
          id: "old-session",
          usuarioId: old.id,
          expiresAt: new Date("2030-01-01"),
        },
      });
      await db.verification.create({
        data: {
          usuarioId: old.id,
          tipo: "EMAIL",
          destino: old.correo,
          codigoHash: "fixture",
          expiresAt: new Date("2030-01-01"),
        },
      });
      await db.appeal.create({
        data: { usuarioId: old.id, reporteId: report.id, motivo: "Fixture" },
      });
      await db.recovery.create({
        data: {
          usuarioId: old.id,
          telefonoNuevo: "+9997000000002",
          adjuntoId: file.id,
          motivo: "Fixture",
        },
      });
      await db.vote.create({
        data: {
          usuarioId: old.id,
          incidenteId: incident.id,
          tipo: "CONFIRMAR",
          latitud: -14.04,
          longitud: -75.7,
        },
      });
      await db.chatMessage.create({
        data: {
          usuarioId: old.id,
          incidenteId: incident.id,
          mensaje: "Fixture",
        },
      });
      await db.flag.create({
        data: {
          usuarioId: old.id,
          incidenteId: incident.id,
          tipo: "FALSO",
          motivo: "Fixture",
        },
      });
      await db.review.create({
        data: {
          usuarioId: old.id,
          incidenteId: incident.id,
          accion: "Fixture",
          motivo: "Fixture",
        },
      });
      await db.notification.create({
        data: {
          usuarioId: old.id,
          incidenteId: incident.id,
          titulo: "Fixture",
          mensaje: "Fixture",
        },
      });
      await db.pointEvent.create({
        data: {
          usuarioId: old.id,
          clave: "reset-local",
          tipo: "Fixture",
          puntos: 10,
        },
      });
      await db.redemption.create({
        data: { usuarioId: old.id, recompensaId: reward.id, costoMonedas: 10 },
      });
      await db.adImpression.create({
        data: {
          usuarioId: old.id,
          negocioId: business.id,
          recorridoId: "fixture",
        },
      });
      const routeData = {
        usuarioId: old.id,
        modo: "walking",
        origen: {},
        destino: {},
        datos: {},
      };
      await db.routeFavorite.create({
        data: { ...routeData, nombre: "Fixture" },
      });
      await db.routeHistory.create({ data: routeData });
      await db.rankingSettlement.create({
        data: { id: "2026-10", datos: { entries: [{ usuarioId: old.id }] } },
      });
      await db.auditLog.create({
        data: { usuarioId: old.id, entidad: "User", accion: "Fixture" },
      });
      const traffic = await db.externalTrafficModeration.create({
        data: {
          externoId: "fixture",
          usuarioId: old.id,
          motivo: "Conservar bloqueo vial",
          oculto: true,
        },
      });
      await db.externalApiUsage.create({
        data: {
          proveedor: "TOMTOM",
          producto: "traffic",
          mes: "2026-10",
          usadas: 12,
        },
      });
      await db.usageCounter.createMany({
        data: [
          {
            clave: `uploads:${old.id}:2026-10-13`,
            cantidad: 1,
            expiresAt: new Date("2030-01-01"),
          },
          {
            clave: "ai:reportes:month:2026-10",
            cantidad: 20,
            expiresAt: new Date("2030-01-01"),
          },
        ],
      });
      await db.appConfig.createMany({
        data: [
          { clave: "reglas", valor: { confirmaciones: 3 } },
          {
            clave: "historical:fixture",
            valor: { incidenteId: incident.id, importadoPor: old.id },
          },
        ],
      });
      const snapshot = await reset.captureResetSnapshot(db, { connection });
      assert.deepEqual(
        Object.keys(snapshot.legacyTables).sort(),
        [...reset.legacyTableNames].sort(),
      );
      assert.ok(
        Object.values(snapshot.legacyTables).every((rows) => rows.length === 1),
      );
      const incomplete = { ...snapshot };
      delete incomplete.legacyTables;
      incomplete.stateFingerprint = reset.fingerprintSnapshotState(incomplete);
      incomplete.criticalStateFingerprint =
        reset.fingerprintSnapshotCriticalState(incomplete);
      await assert.rejects(
        reset.planExplicitReset({
          database: db,
          connection,
          input: input(),
          snapshot: incomplete,
        }),
        { code: "RESET_BACKUP" },
      );
      const args = {
        database: db,
        connection,
        input: input(),
        snapshot,
        confirmTarget: snapshot.targetFingerprint,
        buildDataset,
      };
      const plan = await reset.planExplicitReset(args);
      assert.equal(plan.preservedAdvertisingFiles, 1);
      assert.equal(plan.storageObjectsToRemoveAfterCommit, 1);
      assert.deepEqual(plan.legacyCounts, {
        AuthSession: 1,
        IncidentConfirmation: 1,
        ReportComment: 1,
        ReportConfirmation: 1,
      });
      assert.equal(await db.session.count(), 1);

      await assert.rejects(
        reset.applyExplicitReset({
          ...args,
          buildDataset: () => {
            throw new Error("forced rollback after all deletions");
          },
        }),
        /forced rollback/,
      );
      assert.equal(
        (await reset.captureResetSnapshot(db, { connection })).stateFingerprint,
        snapshot.stateFingerprint,
      );
      await db.user.update({
        where: { id: old.id },
        data: { nombres: "Cambio concurrente" },
      });
      await assert.rejects(reset.applyExplicitReset(args), {
        code: "RESET_STALE_BACKUP",
      });
      assert.equal(await db.report.count(), 1);
      args.snapshot = await reset.captureResetSnapshot(db, { connection });
      await db.$executeRaw`UPDATE public."ReportComment" SET comentario = 'Cambio histórico concurrente'`;
      await assert.rejects(reset.applyExplicitReset(args), {
        code: "RESET_STALE_BACKUP",
      });
      assert.equal(await db.report.count(), 1);
      args.snapshot = await reset.captureResetSnapshot(db, { connection });
      await db.usageCounter.update({
        where: { clave: "ai:reportes:month:2026-10" },
        data: { cantidad: { increment: 1 } },
      });
      await db.externalApiUsage.updateMany({
        data: { usadas: { increment: 1 } },
      });
      const result = await reset.applyExplicitReset(args);
      assert.deepEqual(result.deleted.legacyTables, {
        AuthSession: 1,
        IncidentConfirmation: 1,
        ReportComment: 1,
        ReportConfirmation: 1,
      });
      for (const table of reset.legacyTableNames) {
        const count = await db.$queryRawUnsafe(
          'SELECT COUNT(*)::integer AS count FROM public."' + table + '"',
        );
        assert.equal(count[0].count, 0);
      }
      assert.deepEqual(result.counts, {
        users: 5,
        reports: 500,
        incidents: 500,
        reviews: 500,
        votes: 0,
        sessions: 0,
      });
      assert.equal(await db.user.findUnique({ where: { id: old.id } }), null);
      const users = await db.user.findMany({ orderBy: { id: "asc" } });
      assert.equal(users[0].correo, input().accounts[0].correo);
      for (const user of users) {
        assert.equal(user.correoVerificado, true);
        assert.equal(user.telefonoVerificado, false);
        assert.match(user.telefono, /^\+999\d+$/);
        assert.ok(
          await verifyPassword("local-fixture-password", user.password),
        );
      }
      assert.deepEqual(
        users.find(({ rol }) => rol === "AGENTE").permisos,
        permissionKeys,
      );
      assert.equal(
        (await db.attachment.findUnique({ where: { id: adFile.id } }))
          .usuarioId,
        users[0].id,
      );
      assert.equal(
        (await db.mapAnnouncement.findUnique({ where: { id: ad.id } }))
          .imagenId,
        adFile.id,
      );
      assert.equal(
        (
          await db.externalTrafficModeration.findUnique({
            where: { id: traffic.id },
          })
        ).usuarioId,
        users[0].id,
      );
      assert.equal(
        (
          await db.externalTrafficModeration.findUnique({
            where: { id: traffic.id },
          })
        ).oculto,
        true,
      );
      await isolated.exec(
        'CREATE TABLE "UnknownHistoricalDependent" (id SERIAL PRIMARY KEY, "usuarioId" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT)',
      );
      await assert.rejects(reset.captureResetSnapshot(db, { connection }), {
        code: "RESET_SCHEMA_CHANGED",
      });
      assert.equal(await db.user.count(), 5);
      assert.equal(await db.report.count(), 500);
      assert.equal(await db.business.count({ where: { id: business.id } }), 1);
      assert.equal(await db.reward.count({ where: { id: reward.id } }), 1);
      assert.equal(
        (
          await db.usageCounter.findUnique({
            where: { clave: "ai:reportes:month:2026-10" },
          })
        ).cantidad,
        21,
      );
      assert.equal(
        await db.usageCounter.count({
          where: { clave: { startsWith: "uploads:" } },
        }),
        0,
      );
      assert.equal(await db.appConfig.count({ where: { clave: "reglas" } }), 1);
      assert.equal(
        await db.appConfig.count({ where: { clave: "historical:fixture" } }),
        0,
      );
      assert.equal((await db.externalApiUsage.findFirst()).usadas, 13);
      const pairs = await db.incident.findMany({
        include: { reportes: true, revisiones: true },
      });
      assert.ok(
        pairs.every(
          (row) =>
            row.reportes.length === 1 &&
            row.revisiones.length === 1 &&
            row.reportes[0].latitud === row.latitud &&
            row.revisiones[0].datos.synthetic,
        ),
      );
      assert.deepEqual(
        result.storageObjectsToRemoveAfterCommit.map(({ id }) => id),
        [file.id],
      );
      assert.equal(
        (
          await db.auditLog.findFirst({
            where: { accion: "CARGA_INICIAL_REPORTES" },
          })
        ).datos.synthetic,
        true,
      );
    } finally {
      await db.$disconnect();
      await socket.stop();
      await isolated.close();
    }
  },
);
