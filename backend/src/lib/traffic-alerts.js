"use strict";
const { nearestRiskSegment, distanceMeters } = require("./risk");
const { heading } = require("./navigation-steps");
const TYPES = {
  accident: ["accidente", "Accidente de tránsito"],
  jam: ["congestion", "Congestión vehicular"],
  roadClosed: ["calle-bloqueada", "Vía cerrada"],
  laneClosed: ["carril-cerrado", "Carril cerrado"],
  roadWorks: ["obras-viales", "Obras viales"],
  fog: ["niebla", "Niebla"],
  dangerousConditions: ["condiciones-peligrosas", "Condiciones peligrosas"],
  flooding: ["inundacion", "Inundación"],
  brokenDownVehicle: ["vehiculo-averiado", "Vehículo averiado"],
  rain: ["lluvia", "Lluvia"],
  ice: ["hielo", "Hielo"],
  wind: ["viento", "Viento"],
};
function date(value) {
  const parsed = new Date(value);
  return value && Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : null;
}
function coordinate(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(Number.isFinite) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}
function normalizeTrafficIncidents(features, roads, updated, now = new Date()) {
  const result = [],
    ids = new Set();
  for (const feature of Array.isArray(features)
    ? features.slice(0, 2000)
    : []) {
    const properties = feature.properties || {},
      geometry = feature.geometry;
    const id = String(properties.id || "");
    if (
      !id ||
      id.length > 200 ||
      ids.has(id) ||
      properties.timeValidity === "future"
    )
      continue;
    const start = date(properties.startTime),
      end = date(properties.endTime);
    if ((start && new Date(start) > now) || (end && new Date(end) <= now))
      continue;
    const coords =
      geometry?.type === "Point"
        ? [geometry.coordinates]
        : geometry?.type === "LineString"
          ? geometry.coordinates
          : [];
    if (!coords.length || coords.length > 10000 || !coords.every(coordinate))
      continue;
    const point = coords[Math.floor(coords.length / 2)];
    const road = nearestRiskSegment(point, roads.segments);
    const [type, title] = TYPES[properties.iconCategory] || [
      "trafico",
      "Aviso de tránsito",
    ];
    ids.add(id);
    const bearing =
      coords.length > 1 && distanceMeters(coords[0], coords.at(-1)) > 10
        ? Math.round(heading(coords[0], coords.at(-1)))
        : null;
    result.push({
      id: `tomtom:${id}`,
      externoId: id,
      fuente: "TOMTOM",
      tipo: type,
      titulo: title,
      descripcion:
        (properties.events || [])
          .slice(0, 5)
          .map((event) => String(event.description || "").slice(0, 200))
          .filter(Boolean)
          .join(". ") || title,
      geometria: geometry,
      latitud: point[1],
      longitud: point[0],
      inicio: start,
      fin: end,
      actualizadoEn: updated,
      sentido: bearing === null ? null : `${bearing}°`,
      rumbo: bearing,
      tramoId: road ? String(road.segment.id) : null,
      demoraSegundos: Math.max(
        0,
        Math.min(86400, Number(properties.delayInSeconds) || 0),
      ),
      temporal: true,
      // No level, severity, votes, author, credibility or historical risk.
      afectaRiesgo: false,
    });
  }
  return result;
}
function kind(incident) {
  const raw = String(incident.tipoCatalogo?.slug || incident.tipo || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/accidente/.test(raw)) return "accidente";
  if (/trafico|congestion/.test(raw)) return "congestion";
  if (/calle-bloqueada|via-cerrada|carretera-cerrada/.test(raw))
    return "calle-bloqueada";
  if (/obra/.test(raw)) return "obras-viales";
  return raw;
}
function sameTime(external, civic, now) {
  const source = String(civic.fuente || "")
    .trim()
    .toUpperCase();
  if (
    ["FALSO", "RETIRADO", "RESUELTO"].includes(civic.estado) ||
    (source && source !== "CIUDADANO") ||
    civic.publicado === false
  )
    return false;
  const event = new Date(
    civic.fechaEvento || civic.fechaCreacion || civic.fechaPublicacion,
  );
  if (!Number.isFinite(event.getTime())) return false;
  const from = external.inicio
    ? new Date(external.inicio).getTime() - 1800000
    : now.getTime() - 7200000;
  const to = external.fin
    ? new Date(external.fin).getTime() + 1800000
    : now.getTime() + 1800000;
  return event.getTime() >= from && event.getTime() <= to;
}
function compatibleDirection(external, civic) {
  if (civic.rumbo == null && civic.sentidoGrados == null) return true;
  const direction = Number(civic.rumbo ?? civic.sentidoGrados);
  if (external.rumbo == null || !Number.isFinite(direction)) return true;
  const difference = Math.abs(((direction - external.rumbo + 540) % 360) - 180);
  return difference <= 45;
}
function deduplicateTrafficAlerts(
  externals,
  civicIncidents,
  roads,
  hidden = [],
  now = new Date(),
) {
  const hiddenIds = new Set(hidden.map((row) => row.externoId));
  const civic = civicIncidents.map((incident) => ({
    incident,
    road: nearestRiskSegment(incident, roads.segments),
  }));
  const seen = [];
  for (const external of externals) {
    if (hiddenIds.has(external.externoId)) continue;
    const duplicate = civic.find(
      ({ incident, road }) =>
        kind(incident) === external.tipo &&
        external.tramoId !== null &&
        String(road?.segment.id) === external.tramoId &&
        distanceMeters(incident, external) <= 150 &&
        sameTime(external, incident, now) &&
        compatibleDirection(external, incident),
    );
    if (duplicate) continue;
    const sameExternal = seen.some(
      (previous) =>
        previous.tipo === external.tipo &&
        previous.tramoId !== null &&
        previous.tramoId === external.tramoId &&
        distanceMeters(previous, external) <= 100 &&
        Math.abs(
          new Date(previous.inicio || previous.actualizadoEn) -
            new Date(external.inicio || external.actualizadoEn),
        ) <= 1800000 &&
        compatibleDirection(previous, external),
    );
    if (!sameExternal) seen.push(external);
  }
  return seen;
}
module.exports = {
  normalizeTrafficIncidents,
  deduplicateTrafficAlerts,
  kind,
  compatibleDirection,
};
