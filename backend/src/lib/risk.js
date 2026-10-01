"use strict";

const EARTH_RADIUS = 6371000;
const REMOVED = new Set(["FALSO", "RETIRADO"]);
const attributionIndexes = new WeakMap();
const GRID_DEGREES = 0.002;
const MAX_EDGE_CELLS = 4096;
const MAX_INDEX_CELLS = 1000000;

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const lat1 = Number(a.latitud ?? a[1]) * rad;
  const lat2 = Number(b.latitud ?? b[1]) * rad;
  const dLat = lat2 - lat1;
  const dLon = (Number(b.longitud ?? b[0]) - Number(a.longitud ?? a[0])) * rad;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return (
    EARTH_RADIUS *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, value)), Math.sqrt(Math.max(0, 1 - value)))
  );
}

function levelFromPoints(points) {
  const value = Math.max(0, Number(points) || 0);
  return value === 0 ? 0 : Math.min(5, Math.ceil(value / 5));
}

function calendarAnniversary(date, months) {
  const source = new Date(date);
  const target = new Date(source);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const days = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(source.getUTCDate(), days));
  return target;
}

function ageWeight(eventDate, now = new Date()) {
  const date = new Date(eventDate);
  if (!Number.isFinite(date.getTime()) || date > now) return 0;
  for (const [months, factor] of [
    [3, 1],
    [6, 0.75],
    [12, 0.5],
    [24, 0.25],
    [36, 0.1],
  ]) {
    if (now <= calendarAnniversary(date, months)) return factor;
  }
  return 0;
}

function confirmationWeight(count, agentValidated = false) {
  return agentValidated
    ? 1
    : 0.5 + Math.min(3, Math.max(0, Number(count) || 0)) / 6;
}

function incidentRisk(incident, now = new Date()) {
  const type = incident.tipoCatalogo || {};
  const historical = incident.historico ?? type.historico ?? false;
  const persistent = incident.persistente ?? type.persistente ?? false;
  const individual = incident.individual ?? type.individual ?? false;
  const removed = REMOVED.has(incident.estado) || incident.publicado === false;
  const resolvedWithoutHistory = incident.estado === "RESUELTO" && !historical;
  if (removed || resolvedWithoutHistory)
    return { points: 0, pending: false, confidence: 0, age: 0 };
  const severity = incident.nivelRiesgo;
  if (
    severity === null ||
    severity === undefined ||
    incident.evaluacion === "PENDIENTE"
  ) {
    return { points: 0, pending: true, confidence: 0, age: 1 };
  }
  let confidence = Math.max(0, Math.min(1, Number(incident.validacion ?? 0.5)));
  if (
    individual &&
    incident.evaluacion !== "AGENTE" &&
    confidence < 1 &&
    !incident.pruebasRecibidas
  ) {
    const elapsed = now.getTime() - new Date(incident.fechaPublicacion || incident.fechaCreacion).getTime();
    if (elapsed >= 7 * 86400000)
      return { points: 0, pending: false, confidence: 0, age: 0 };
    if (elapsed >= 3 * 86400000) confidence = Math.min(confidence, 0.25);
  }
  const age = historical
    ? ageWeight(incident.fechaEvento || incident.fechaCreacion, now)
    : 1;
  if (persistent && incident.estado === "RESUELTO")
    return { points: 0, pending: false, confidence: 0, age: 0 };
  return {
    points: Math.max(0, Math.min(5, Number(severity))) * confidence * age,
    pending: false,
    confidence,
    age,
  };
}

function projectToLine(point, coordinates) {
  let best = null;
  const p = [
    Number(point.longitud ?? point[0]),
    Number(point.latitud ?? point[1]),
  ];
  for (let index = 1; index < coordinates.length; index++) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    const scale = Math.cos((p[1] * Math.PI) / 180);
    const ax = (a[0] - p[0]) * scale;
    const ay = a[1] - p[1];
    const bx = (b[0] - p[0]) * scale;
    const by = b[1] - p[1];
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const fraction = denominator
      ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator))
      : 0;
    const snapped = [
      a[0] + (b[0] - a[0]) * fraction,
      a[1] + (b[1] - a[1]) * fraction,
    ];
    const distance = distanceMeters(p, snapped);
    if (!best || distance < best.distance)
      best = { distance, coordinates: snapped, index, fraction };
  }
  return best;
}

function transportFactor(incident, mode) {
  const type = String(
    incident.tipoCatalogo?.slug || incident.tipo || "",
  ).toLowerCase();
  if (/bache/.test(type))
    return mode === "walking" ? 0.5 : mode === "cycling" ? 1.5 : 1;
  if (/semaforo|semáforo/.test(type)) return mode === "driving" ? 1.5 : 1;
  if (/iluminacion|iluminación/.test(type))
    return mode === "walking" || mode === "cycling" ? 1.3 : 0.7;
  if (/accidente/.test(type)) return mode === "driving" ? 1.3 : 1;
  return 1;
}

function attributionIndex(segments) {
  let index = attributionIndexes.get(segments);
  if (index) return index;
  const cells = new Map(),
    fallback = new Set();
  let entries = 0;
  for (let position = 0; position < segments.length; position++) {
    const coordinates = segments[position].coordinates;
    for (let edge = 1; edge < coordinates.length; edge++) {
      const a = coordinates[edge - 1],
        b = coordinates[edge];
      const minX = Math.floor(Math.min(a[0], b[0]) / GRID_DEGREES);
      const maxX = Math.floor(Math.max(a[0], b[0]) / GRID_DEGREES);
      const minY = Math.floor(Math.min(a[1], b[1]) / GRID_DEGREES);
      const maxY = Math.floor(Math.max(a[1], b[1]) / GRID_DEGREES);
      const count = (maxX - minX + 1) * (maxY - minY + 1);
      // Never drop a road when an unusual geometry would make the grid too large.
      if (
        !Number.isFinite(count) ||
        count > MAX_EDGE_CELLS ||
        entries + count > MAX_INDEX_CELLS
      ) {
        fallback.add(position);
        continue;
      }
      for (let x = minX; x <= maxX; x++)
        for (let y = minY; y <= maxY; y++) {
          const key = `${x}:${y}`;
          if (!cells.has(key)) cells.set(key, new Set());
          cells.get(key).add(position);
        }
      entries += count;
    }
  }
  index = { cells, fallback };
  attributionIndexes.set(segments, index);
  return index;
}

function nearbySegments(point, segments, radius = 150) {
  const lat = Number(point.latitud ?? point[1]),
    lon = Number(point.longitud ?? point[0]);
  const angular = radius / EARTH_RADIUS;
  const latDelta = (angular * 180) / Math.PI;
  // Longitude excursion of a spherical circle; near the poles use the full scan.
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) + latDelta >= 90
  )
    return segments;
  const lonDelta =
    (Math.asin(
      Math.min(1, Math.sin(angular) / Math.cos((lat * Math.PI) / 180)),
    ) *
      180) /
    Math.PI;
  const epsilon = 1e-10;
  const longitudeRanges = [
    [lon - lonDelta - epsilon, lon + lonDelta + epsilon],
  ];
  if (longitudeRanges[0][0] < -180)
    longitudeRanges.push([longitudeRanges[0][0] + 360, 180]);
  if (longitudeRanges[0][1] > 180)
    longitudeRanges.push([-180, longitudeRanges[0][1] - 360]);
  const ranges = longitudeRanges.map(([a, b]) => [
    Math.floor(a / GRID_DEGREES),
    Math.floor(b / GRID_DEGREES),
  ]);
  const minY = Math.floor((lat - latDelta - epsilon) / GRID_DEGREES),
    maxY = Math.floor((lat + latDelta + epsilon) / GRID_DEGREES);
  if (
    ranges.reduce(
      (count, [minX, maxX]) => count + (maxX - minX + 1) * (maxY - minY + 1),
      0,
    ) > 256
  )
    return segments;
  const index = attributionIndex(segments),
    positions = new Set(index.fallback);
  for (const [minX, maxX] of ranges)
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++) {
        for (const position of index.cells.get(`${x}:${y}`) || [])
          positions.add(position);
      }
  // Original order preserves deterministic attribution for equidistant junctions.
  return [...positions]
    .sort((a, b) => a - b)
    .map((position) => segments[position]);
}

function nearestRiskSegment(point, segments) {
  let nearest = null;
  for (const segment of nearbySegments(point, segments)) {
    const projection = projectToLine(point, segment.coordinates);
    if (
      projection &&
      (!nearest || projection.distance < nearest.projection.distance)
    )
      nearest = { segment, projection };
  }
  return nearest && nearest.projection.distance <= 150 ? nearest : null;
}

function scoreSegments(
  segments,
  incidents,
  now = new Date(),
  mode = null,
  options = {},
) {
  const neighborFactor = Number.isFinite(options.influenciaVecina)
    ? Math.max(0, Math.min(1, options.influenciaVecina))
    : 0.15;
  const scores = new Map(
    segments.map((segment) => [
      String(segment.id),
      {
        ...segment,
        points: 0,
        pending: false,
        blocked: false,
        incidentIds: [],
        emergencies: [],
      },
    ]),
  );
  const junctions = new Map();
  for (const segment of segments) {
    for (const node of [segment.start, segment.end]) {
      const key = String(node);
      if (!junctions.has(key)) junctions.set(key, new Set());
      junctions.get(key).add(String(segment.id));
    }
  }
  const seenIncidents = new Set();
  for (const incident of incidents) {
    if (seenIncidents.has(incident.id)) continue;
    seenIncidents.add(incident.id);
    const risk = incidentRisk(incident, now);
    if (!risk.pending && risk.points <= 0) continue;
    const nearest = nearestRiskSegment(incident, segments);
    // An event far from the available street network has no invented street attribution.
    if (!nearest || nearest.projection.distance > 150) continue;
    const primary = scores.get(String(nearest.segment.id));
    const points = risk.points * (mode ? transportFactor(incident, mode) : 1);
    primary.points += points;
    primary.pending ||= risk.pending;
    primary.incidentIds.push(incident.id);
    const kind = String(incident.tipoCatalogo?.slug || incident.tipo || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (
      kind === "calle-bloqueada" &&
      incident.validacion >= 1 &&
      incident.evaluacion !== "PENDIENTE" &&
      incident.estado !== "RESUELTO"
    )
      primary.blocked = true;
    const emergency = incident.emergencia ?? incident.tipoCatalogo?.emergencia;
    if (
      emergency &&
      incident.estado !== "RESUELTO" &&
      (risk.pending || incident.nivelRiesgo >= 4)
    ) {
      primary.emergencies.push({
        id: incident.id,
        tipo: incident.tipo,
        gravedad: incident.nivelRiesgo,
        pendiente: risk.pending,
      });
    }
    const connected = new Set([
      ...junctions.get(String(nearest.segment.start)),
      ...junctions.get(String(nearest.segment.end)),
    ]);
    connected.delete(String(nearest.segment.id));
    for (const id of connected) {
      const neighbor = scores.get(id);
      neighbor.points += points * neighborFactor;
      neighbor.pending ||= risk.pending;
    }
  }
  return [...scores.values()].map((segment) => ({
    ...segment,
    level: levelFromPoints(segment.points),
  }));
}

module.exports = {
  distanceMeters,
  levelFromPoints,
  calendarAnniversary,
  ageWeight,
  confirmationWeight,
  incidentRisk,
  projectToLine,
  transportFactor,
  scoreSegments,
  nearestRiskSegment,
};
