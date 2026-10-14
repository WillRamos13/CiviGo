"use strict";

const { randomUUID } = require("node:crypto");
const {
  identityFingerprint,
  validateDataset,
} = require("./explicit-data-reset");
const { distanceMeters } = require("./risk");
const { inProvince } = require("./roads");

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function validateAppendScope({
  userIds,
  reviewerId,
  center,
  radiusMeters,
  expectedExistingCount,
  dataset,
  roads,
  types,
}) {
  if (
    !Array.isArray(userIds) ||
    userIds.length !== 5 ||
    new Set(userIds).size !== 5 ||
    userIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    !userIds.includes(reviewerId) ||
    !center ||
    !Number.isFinite(center.latitud) ||
    !Number.isFinite(center.longitud) ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters <= 0 ||
    radiusMeters > 3000 ||
    !Number.isSafeInteger(expectedExistingCount) ||
    expectedExistingCount < 0
  )
    fail(
      "APPEND_SCOPE",
      "La carga adicional necesita las cinco cuentas, un centro válido y un radio de hasta 3 km.",
    );
  validateDataset(dataset, { userIds, types, count: 50 });
  if (
    !roads?.boundary?.outer?.length ||
    !inProvince(center, roads) ||
    dataset.entries.some(
      ({ incident }) =>
        distanceMeters(center, incident) > radiusMeters ||
        !inProvince(incident, roads),
    )
  )
    fail(
      "APPEND_LOCATION",
      "Los 50 reportes deben permanecer dentro de la provincia y a un máximo de 3 km del centro seleccionado.",
    );
  if (dataset.entries.some(({ review }) => review.usuarioId !== reviewerId))
    fail(
      "APPEND_SCOPE",
      "La procedencia de la carga debe registrarse con el administrador seleccionado.",
    );
}

// Adds a separate explicitly prepared batch. It never deletes, updates or
// revalidates an existing account, report, incident, attachment or session.
async function appendInitialIncidentBatch({
  database,
  connection,
  confirmTarget,
  dataset,
  userIds,
  reviewerId,
  center,
  roads,
  radiusMeters = 3000,
  expectedExistingCount = 500,
  timeout = 120000,
} = {}) {
  if (!database || confirmTarget !== identityFingerprint(connection))
    fail(
      "APPEND_CONFIRM",
      "Confirma la huella de la base antes de añadir el lote.",
    );
  const types = await database.incidentType.findMany({
    orderBy: { id: "asc" },
  });
  validateAppendScope({
    userIds,
    reviewerId,
    center,
    radiusMeters,
    expectedExistingCount,
    dataset,
    roads,
    types,
  });
  const run = randomUUID();
  return database.$transaction(
    async (db) => {
      await db.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
      await db.$executeRawUnsafe(
        'LOCK TABLE public."AuditLog", public."Incident", public."Report", public."Review", public."User" IN SHARE ROW EXCLUSIVE MODE',
      );
      const users = await db.user.findMany({ where: { id: { in: userIds } } });
      if (
        users.length !== 5 ||
        users.some((user) => user.bloqueado || !user.correoVerificado) ||
        users.filter(({ rol }) => rol === "ADMIN").length !== 4 ||
        users.filter(
          ({ rol, tipoAgente }) =>
            rol === "AGENTE" && tipoAgente === "COLABORADOR",
        ).length !== 1 ||
        users.find(({ id }) => id === reviewerId)?.rol !== "ADMIN"
      )
        fail(
          "APPEND_ACCOUNTS",
          "Las cinco cuentas deben seguir activas y verificadas, con cuatro administradores y un colaborador.",
        );
      const currentTypes = await db.incidentType.findMany({
        orderBy: { id: "asc" },
      });
      validateAppendScope({
        userIds,
        reviewerId,
        center,
        radiusMeters,
        expectedExistingCount,
        dataset,
        roads,
        types: currentTypes,
      });
      const previousIncidents = await db.incident.findMany({
        select: { id: true, latitud: true, longitud: true },
      });
      const previousReports = await db.report.count();
      if (
        previousIncidents.length !== expectedExistingCount ||
        previousReports !== expectedExistingCount
      )
        fail(
          "APPEND_COUNTS",
          "El número de reportes cambió; revisa el lote antes de repetir la operación.",
        );
      if (
        dataset.entries.some(({ incident }) =>
          previousIncidents.some(
            (existing) => distanceMeters(existing, incident) <= 1,
          ),
        )
      )
        fail(
          "APPEND_DUPLICATE",
          "El lote adicional reutiliza una ubicación existente.",
        );
      const ids =
        await db.$queryRaw`SELECT nextval(pg_get_serial_sequence('"Incident"', 'id'))::integer AS id FROM generate_series(1, ${50}::integer)`;
      if (ids.length !== 50 || new Set(ids.map(({ id }) => id)).size !== 50)
        fail(
          "APPEND_COUNTS",
          "No se pudieron reservar identificadores únicos para el lote adicional.",
        );
      await db.incident.createMany({
        data: dataset.entries.map(({ incident }, index) => ({
          ...incident,
          id: ids[index].id,
        })),
      });
      await db.report.createMany({
        data: dataset.entries.map(({ report }, index) => ({
          ...report,
          incidenteId: ids[index].id,
        })),
      });
      await db.review.createMany({
        data: dataset.entries.map(({ review }, index) => ({
          ...review,
          incidenteId: ids[index].id,
          datos: { ...review.datos, appendRun: run },
        })),
      });
      await db.auditLog.create({
        data: {
          usuarioId: reviewerId,
          accion: "CARGA_ADICIONAL_REPORTES",
          entidad: "INCIDENTE",
          datos: {
            synthetic: true,
            appendRun: run,
            count: 50,
            previousIncidents: previousIncidents.length,
            previousReports,
            center,
            radiusMeters,
            existingRecordsModified: 0,
            aiEvaluations: 0,
            independentConfirmations: 0,
            dataset: dataset.summary || {},
          },
        },
      });
      const counts = {
        incidents: await db.incident.count(),
        reports: await db.report.count(),
      };
      if (
        counts.incidents !== expectedExistingCount + 50 ||
        counts.reports !== expectedExistingCount + 50
      )
        fail(
          "APPEND_COUNTS",
          "La comprobación del lote falló; se revierte la carga adicional.",
        );
      const reports = await db.report.findMany({
        where: { incidenteId: { in: ids.map(({ id }) => id) } },
        include: { tipoCatalogo: true, incidente: true, adjuntos: true },
        orderBy: { id: "asc" },
      });
      if (
        reports.length !== 50 ||
        reports.some(({ adjuntos }) => adjuntos.length !== 0)
      )
        fail(
          "APPEND_COUNTS",
          "No se pudo comprobar cada par del lote adicional.",
        );
      return {
        mode: "appended",
        appendRun: run,
        counts,
        added: { reports: 50, incidents: 50, reviews: 50 },
        incidentIds: ids.map(({ id }) => id),
        reports,
        mediaExpectedCount: 50,
        existingRecordsModified: 0,
      };
    },
    { isolationLevel: "Serializable", maxWait: 10000, timeout },
  );
}

module.exports = { validateAppendScope, appendInitialIncidentBatch };
