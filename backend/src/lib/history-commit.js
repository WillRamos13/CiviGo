"use strict";
const { HttpError } = require("./http");

/** Append-only import. Publication is distinct from human review or resolution. */
async function commitHistorical(
  prisma,
  {
    prepared,
    fuente,
    usuarioId = null,
    metadataByReference = new Map(),
    manifest = null,
  },
) {
  if (!prepared.registros?.length)
    throw new HttpError(400, "No hay registros válidos para importar.");
  await prisma.appConfig.upsert({
    where: { clave: "historical-import-lock" },
    create: { clave: "historical-import-lock", valor: {} },
    update: {},
  });
  return prisma.$transaction(
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
      const rows = prepared.registros.filter((row) => !existing.has(row.clave));
      const ids = [];
      for (let offset = 0; offset < rows.length; offset += 500) {
        const batch = rows.slice(offset, offset + 500),
          count = batch.length;
        const allocated =
          await db.$queryRaw`SELECT nextval(pg_get_serial_sequence('"Incident"', 'id'))::integer AS id FROM generate_series(1, ${count}::integer)`;
        if (
          allocated.length !== count ||
          allocated.some((item) => !Number.isInteger(item.id))
        )
          throw new Error(
            "No se pudieron reservar identificadores históricos.",
          );
        await db.incident.createMany({
          data: batch.map((row, index) => ({
            id: allocated[index].id,
            tipo: row.tipoNombre,
            tipoId: row.tipoId,
            descripcion: row.descripcion,
            latitud: row.latitud,
            longitud: row.longitud,
            distrito: row.distrito,
            nivelRiesgo: row.nivelRiesgo,
            estado: "PENDIENTE",
            validacion: 0,
            publicado: true,
            evaluacion: "PENDIENTE",
            historico: true,
            individual: row.individual,
            fechaEvento: new Date(row.fechaEvento),
            fuente,
            totalReportes: 0,
          })),
        });
        await db.appConfig.createMany({
          data: batch.map((row, index) => ({
            clave: row.clave,
            valor: {
              incidenteId: allocated[index].id,
              referencia: row.referencia,
              importadoPor: usuarioId,
              fechaEventoPrecision: row.fechaEventoPrecision,
              estadoRevision: "PENDIENTE",
              ...(metadataByReference.get(row.referencia)
                ? { procedencia: metadataByReference.get(row.referencia) }
                : {}),
            },
          })),
        });
        ids.push(...allocated.map((item) => item.id));
      }
      await db.auditLog.create({
        data: {
          usuarioId,
          accion: "IMPORTAR_HISTORICOS",
          entidad: "Incident",
          datos: {
            fuente,
            importados: rows.length,
            duplicados: prepared.registros.length - rows.length,
            errores: prepared.errores.length,
            metodo: "APPEND_ONLY",
            revisionHumana: false,
            ...(manifest ? { manifest } : {}),
          },
        },
      });
      return {
        importados: rows.length,
        duplicados: prepared.registros.length - rows.length,
        errores: prepared.errores,
        ids,
      };
    },
    { timeout: 60000 },
  );
}
module.exports = { commitHistorical };
