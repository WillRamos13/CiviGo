"use strict";
const { HttpError, coordinates, distance, slug } = require("./http");
const { publicIncidentEligibility } = require("./publication");
const { ageWeight } = require("./risk");

const RADIUS_METERS = 1000;
const RECENT_LIMIT = 10;
const CANDIDATE_PAGE_SIZE = 250;

function parseNearbyIncidentQuery(query) {
  const hasLatitude = query.latitud !== undefined;
  const hasLongitude = query.longitud !== undefined;
  if (!hasLatitude && !hasLongitude) return null;
  const number = (value) => {
    if (
      typeof value !== "string" ||
      !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
    )
      throw new HttpError(400, "Indica latitud y longitud GPS válidas.");
    return Number(value);
  };
  if (!hasLatitude || !hasLongitude)
    throw new HttpError(400, "Indica latitud y longitud GPS juntas.");
  const position = coordinates(number(query.latitud), number(query.longitud));
  if (
    query.tipo !== undefined &&
    (typeof query.tipo !== "string" || query.tipo.length > 120)
  )
    throw new HttpError(400, "Tipo de incidente inválido.");
  return { position, tipo: slug(query.tipo || "") };
}

function publicIncidentWhere(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 3);
  return {
    publicado: true,
    AND: [publicIncidentEligibility()],
    OR: [
      { historico: false },
      { historico: true, fechaEvento: { gte: cutoff } },
    ],
  };
}

function isVisiblePublicIncident(row, now = new Date()) {
  return (
    row.publicado !== false &&
    (row.estado !== "RESUELTO" || row.historico) &&
    (!row.historico || ageWeight(row.fechaEvento, now) > 0)
  );
}

function publicationTime(row) {
  for (const date of [row.fechaPublicacion, row.fechaCreacion]) {
    if (!date) continue;
    const time = new Date(date).getTime();
    if (Number.isFinite(time)) return time;
  }
  return 0;
}
function newestFirst(a, b) {
  return publicationTime(b) - publicationTime(a) || b.id - a.id;
}
function incidentTypeKey(row) {
  return (
    slug(row.tipoCatalogo?.slug ?? "") || slug(row.tipo ?? "") || "sin-tipo"
  );
}

function nearbyBounds(position) {
  const angular = RADIUS_METERS / 6371000;
  const deltaLatitude = (angular * 180) / Math.PI;
  const minimum = Math.max(-90, position.latitud - deltaLatitude);
  const maximum = Math.min(90, position.latitud + deltaLatitude);
  const bounds = { latitud: { gte: minimum, lte: maximum } };
  // A circle touching a pole can include every longitude.
  if (minimum <= -90 || maximum >= 90) return bounds;
  const deltaLongitude =
    (Math.asin(
      Math.sin(angular) / Math.cos((position.latitud * Math.PI) / 180),
    ) *
      180) /
    Math.PI;
  const west = position.longitud - deltaLongitude;
  const east = position.longitud + deltaLongitude;
  if (west < -180)
    bounds.OR = [
      { longitud: { gte: west + 360 } },
      { longitud: { lte: east } },
    ];
  else if (east > 180)
    bounds.OR = [
      { longitud: { gte: west } },
      { longitud: { lte: east - 360 } },
    ];
  else bounds.longitud = { gte: west, lte: east };
  return bounds;
}

async function findNearbyRecentIncidents(
  db,
  { position, tipo },
  include,
  now = new Date(),
) {
  const base = publicIncidentWhere(now);
  const where = {
    ...base,
    AND: [
      ...base.AND,
      nearbyBounds(position),
      {
        OR: [
          { estado: { in: ["ACTIVO", "VALIDADO", "PENDIENTE"] } },
          { estado: "RESUELTO", historico: true },
        ],
      },
      ...(tipo
        ? [{ OR: [{ tipoCatalogo: { slug: tipo } }, { tipoId: null }] }]
        : []),
    ],
  };
  const winners = [];
  let lastId = 0;
  while (true) {
    const rows = await db.incident.findMany({
      where: { ...where, id: { gt: lastId } },
      select: {
        id: true,
        latitud: true,
        longitud: true,
        tipo: true,
        tipoCatalogo: { select: { slug: true } },
        estado: true,
        historico: true,
        fechaEvento: true,
        fechaPublicacion: true,
        fechaCreacion: true,
      },
      orderBy: { id: "asc" },
      take: CANDIDATE_PAGE_SIZE,
    });
    for (const row of rows) {
      const meters = distance(position, row);
      if (
        !isVisiblePublicIncident(row, now) ||
        (tipo && incidentTypeKey(row) !== tipo) ||
        !Number.isFinite(meters) ||
        meters > RADIUS_METERS
      )
        continue;
      winners.push(row);
      winners.sort(newestFirst);
      if (winners.length > RECENT_LIMIT) winners.pop();
    }
    if (rows.length < CANDIDATE_PAGE_SIZE) break;
    lastId = rows[rows.length - 1].id;
  }
  if (!winners.length) return [];
  // Only the ten selected rows load attachments and citizen contributions.
  // Re-check publication eligibility in case an account was unverified meanwhile.
  const hydrated = await db.incident.findMany({
    where: { ...where, id: { in: winners.map((row) => row.id) } },
    include,
  });
  return hydrated
    .filter(
      (row) =>
        isVisiblePublicIncident(row, now) &&
        (!tipo || incidentTypeKey(row) === tipo) &&
        distance(position, row) <= RADIUS_METERS,
    )
    .sort(newestFirst)
    .slice(0, RECENT_LIMIT);
}

module.exports = {
  RADIUS_METERS,
  RECENT_LIMIT,
  CANDIDATE_PAGE_SIZE,
  parseNearbyIncidentQuery,
  publicIncidentWhere,
  isVisiblePublicIncident,
  findNearbyRecentIncidents,
  nearbyBounds,
};
