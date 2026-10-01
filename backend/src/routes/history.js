"use strict";
const router = require("express").Router(),
  prisma = require("../lib/db");
const { auth } = require("../lib/auth"),
  { asyncRoute, HttpError } = require("../lib/http");
const { prepareImport } = require("../lib/history-import");
router.use(auth, (req, res, next) =>
  req.user.rol === "ADMIN"
    ? next()
    : next(
        new HttpError(403, "Solo administradores pueden importar históricos."),
      ),
);
router.post(
  "/import/preview",
  asyncRoute(async (req, res) => {
    const result = prepareImport(
      req.body,
      await prisma.incidentType.findMany(),
    );
    res.json(result);
  }),
);
router.post(
  "/import/commit",
  asyncRoute(async (req, res) => {
    const prepared = prepareImport(
      req.body,
      await prisma.incidentType.findMany(),
    );
    if (!prepared.totalValidos)
      throw new HttpError(400, "No hay registros válidos para importar.");
    await prisma.appConfig.upsert({
      where: { clave: "historical-import-lock" },
      create: { clave: "historical-import-lock", valor: {} },
      update: {},
    });
    const result = await prisma.$transaction(
      async (db) => {
        await db.$queryRaw`SELECT clave FROM "AppConfig" WHERE clave = 'historical-import-lock' FOR UPDATE`;
        const existing = new Set(
          (
            await db.appConfig.findMany({
              where: {
                clave: { in: prepared.registros.map((row) => row.clave) },
              },
              select: { clave: true },
            })
          ).map((row) => row.clave),
        );
        const rows = prepared.registros.filter(
          (row) => !existing.has(row.clave),
        );
        const importados = rows.length,
          duplicados = prepared.registros.length - importados;
        if (importados) {
          // Allocate IDs from PostgreSQL's existing sequence so bulk inserts can
          // attach each import key to its exact incident without relying on RETURNING order.
          const allocated =
            await db.$queryRaw`SELECT nextval(pg_get_serial_sequence('"Incident"', 'id'))::integer AS id FROM generate_series(1, ${importados}::integer)`;
          await db.incident.createMany({
            data: rows.map((row, index) => ({
              id: allocated[index].id,
              tipo: row.tipoNombre,
              tipoId: row.tipoId,
              descripcion: row.descripcion,
              latitud: row.latitud,
              longitud: row.longitud,
              distrito: row.distrito,
              nivelRiesgo: row.nivelRiesgo,
              estado: "RESUELTO",
              validacion: 1,
              publicado: true,
              evaluacion: "AGENTE",
              historico: true,
              individual: row.individual,
              fechaEvento: new Date(row.fechaEvento),
              fuente: req.body.fuente.trim(),
              totalReportes: 0,
            })),
          });
          await db.appConfig.createMany({
            data: rows.map((row, index) => ({
              clave: row.clave,
              valor: {
                incidenteId: allocated[index].id,
                referencia: row.referencia,
                importadoPor: req.user.id,
              },
            })),
          });
        }
        await db.auditLog.create({
          data: {
            usuarioId: req.user.id,
            accion: "IMPORTAR_HISTORICOS",
            entidad: "Incident",
            datos: {
              fuente: req.body.fuente.trim(),
              importados,
              duplicados,
              errores: prepared.errores.length,
            },
          },
        });
        return { importados, duplicados, errores: prepared.errores };
      },
      { timeout: 60000 },
    );
    res.status(201).json(result);
  }),
);
module.exports = router;
