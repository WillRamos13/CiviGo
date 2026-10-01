"use strict";
const { distanceMeters, scoreSegments, levelFromPoints } = require("./risk");
const {
  getRoads,
  inProvinceOrBorder,
  allows,
  nearest,
  lengthOf,
  coveredSegments,
} = require("./roads");
const MODES = new Set(["walking", "cycling", "driving"]);
const { createHash } = require("node:crypto");
class Heap {
  constructor() {
    this.items = [];
  }
  push(value) {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= value.cost) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = value;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const first = a[0],
      last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1].cost < a[c].cost) c++;
        if (a[c].cost >= last.cost) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return first;
  }
}
function error(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}
function projectionOffset(segment, projection) {
  let offset = 0;
  for (let i = 1; i < projection.index; i++)
    offset += distanceMeters(
      segment.coordinates[i - 1],
      segment.coordinates[i],
    );
  return (
    offset +
    distanceMeters(
      segment.coordinates[projection.index - 1],
      projection.coordinates,
    )
  );
}
function sliceLine(coordinates, from, to) {
  const result = [from.coordinates];
  for (let i = from.index; i < to.index; i++) result.push(coordinates[i]);
  result.push(to.coordinates);
  return result.filter(
    (c, i) => i === 0 || distanceMeters(result[i - 1], c) > 0.01,
  );
}
function directionFor(tags, mode) {
  const modeKey = {
    walking: "oneway:foot",
    cycling: "oneway:bicycle",
    driving: "oneway:motorcar",
  }[mode];
  const explicit =
    tags[modeKey] ??
    (mode === "driving" ? tags["oneway:motor_vehicle"] : undefined);
  const pedestrianRoad = ["steps", "via_ferrata"].includes(tags.highway);
  const value = String(
    explicit ??
      (mode === "walking" && !pedestrianRoad ? "no" : tags.oneway) ??
      "",
  )
    .trim()
    .toLowerCase();
  if (["no", "0", "false"].includes(value)) return "both";
  if (value === "-1") return "reverse";
  if (["yes", "1", "true"].includes(value)) return "forward";
  // An explicit two-way tag must override the implied roundabout/motorway rule.
  // https://wiki.openstreetmap.org/wiki/Key:oneway
  return mode !== "walking" &&
    (tags.junction === "roundabout" ||
      ["motorway", "motorway_link"].includes(tags.highway))
    ? "forward"
    : "both";
}
function graphFor(segments, origin, destination, mode) {
  const a = nearest(origin, segments),
    b = nearest(destination, segments);
  if (!a || !b || a.projection.distance > 200 || b.projection.distance > 200)
    throw error(
      422,
      "No encontramos una vía accesible a menos de 200 metros de ambos puntos.",
      "ROAD_NOT_FOUND",
    );
  const graph = new Map();
  const add = (start, end, segment, coordinates) => {
    const length = lengthOf(coordinates);
    if (length < 0.01) return;
    if (!graph.has(start)) graph.set(start, []);
    graph.get(start).push({ to: end, segment, coordinates, length });
  };
  for (const segment of segments) {
    const cuts = [
      {
        node: segment.start,
        index: 1,
        coordinates: segment.coordinates[0],
        offset: 0,
      },
      {
        node: segment.end,
        index: segment.coordinates.length - 1,
        coordinates: segment.coordinates.at(-1),
        offset: segment.length,
      },
    ];
    if (segment.id === a.segment.id)
      cuts.push({
        node: "@origin",
        ...a.projection,
        offset: projectionOffset(segment, a.projection),
      });
    if (segment.id === b.segment.id)
      cuts.push({
        node: "@destination",
        ...b.projection,
        offset: projectionOffset(segment, b.projection),
      });
    cuts.sort((x, y) => x.offset - y.offset);
    const direction = directionFor(segment.tags || {}, mode);
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1],
        to = cuts[i];
      let coordinates = sliceLine(segment.coordinates, from, to);
      // Co-located snapped nodes must remain connected without fabricating a road.
      if (to.offset - from.offset < 0.01) {
        if (!graph.has(from.node)) graph.set(from.node, []);
        if (!graph.has(to.node)) graph.set(to.node, []);
        graph.get(from.node).push({
          to: to.node,
          segment,
          coordinates: [from.coordinates, to.coordinates],
          length: 0,
        });
        graph.get(to.node).push({
          to: from.node,
          segment,
          coordinates: [to.coordinates, from.coordinates],
          length: 0,
        });
        continue;
      }
      if (direction !== "reverse")
        add(from.node, to.node, segment, coordinates);
      if (direction !== "forward")
        add(to.node, from.node, segment, coordinates.slice().reverse());
    }
  }
  return { graph, origin: a.projection, destination: b.projection };
}
function shortestPath(graph, profile, scale = 1) {
  const costs = new Map([["@origin", 0]]),
    previous = new Map(),
    heap = new Heap();
  heap.push({ node: "@origin", cost: 0 });
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== costs.get(current.node)) continue;
    if (current.node === "@destination") break;
    for (const edge of graph.get(current.node) || []) {
      const s = edge.segment;
      let penalty = 0;
      if (profile !== "corta")
        penalty =
          (profile === "segura" ? s.points / 3 : s.points / 10) +
          (s.pending ? (profile === "segura" ? 2 : 0.6) : 0) +
          (s.emergencies.length ? (profile === "segura" ? 6 : 2.5) : 0);
      const cost = current.cost + edge.length * (1 + penalty * scale);
      if (cost < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, cost);
        previous.set(edge.to, { from: current.node, edge });
        heap.push({ node: edge.to, cost });
      }
    }
  }
  if (!costs.has("@destination")) return null;
  const edges = [];
  let node = "@destination";
  while (node !== "@origin") {
    const p = previous.get(node);
    if (!p) return null;
    edges.push(p.edge);
    node = p.from;
  }
  return edges.reverse();
}
function speed(edge, mode) {
  if (mode === "walking") return 1.25;
  if (mode === "cycling")
    return edge.segment.tags.surface &&
      !["asphalt", "paved", "concrete"].includes(edge.segment.tags.surface)
      ? 3
      : 4.16;
  const raw = String(edge.segment.tags.maxspeed ?? "")
    .trim()
    .toLowerCase();
  if (raw === "walk") return 1.25;
  // OSM numeric speeds default to km/h; mph and knots carry explicit units.
  // https://wiki.openstreetmap.org/wiki/Key:maxspeed#Parser
  const parsed = raw.match(/^(\d+(?:\.\d+)?)\s*(km\/h|kmh|kph|mph|knots)?$/);
  const factor =
    parsed?.[2] === "mph" ? 1.609344 : parsed?.[2] === "knots" ? 1.852 : 1;
  const limit = parsed ? Number(parsed[1]) * factor : NaN;
  return Math.min(Number.isFinite(limit) && limit > 0 ? limit : 35, 80) / 3.6;
}
function routeFrom(edges, type, mode, snaps, updated) {
  const geometria = { type: "LineString", coordinates: [] };
  let distancia = 0,
    duracion = 0,
    exposure = 0;
  const warnings = new Set();
  const incidentIds = new Set(),
    segments = new Set();
  for (const edge of edges) {
    distancia += edge.length;
    duracion += edge.length / speed(edge, mode);
    exposure += edge.length * edge.segment.points;
    segments.add(edge.segment.id);
    for (const c of edge.coordinates)
      if (
        !geometria.coordinates.length ||
        distanceMeters(geometria.coordinates.at(-1), c) > 0.01
      )
        geometria.coordinates.push(c);
    if (edge.segment.pending)
      warnings.add(
        "Hay incidentes por evaluar en este recorrido. La información puede cambiar.",
      );
    if (edge.segment.emergencies.length)
      warnings.add(
        "Hay una emergencia o un incidente grave en este recorrido. Revisa las alertas antes de continuar.",
      );
    for (const id of edge.segment.incidentIds) incidentIds.add(id);
  }
  if (snaps.origin.distance > 20 || snaps.destination.distance > 20)
    warnings.add(
      "Los extremos se ajustaron a la vía accesible más cercana. Comprueba el acceso desde tu ubicación.",
    );
  warnings.add(
    "Duración estimada con datos de calles; no incluye tráfico en vivo ni restricciones que aún no hayan sido reportadas.",
  );
  const puntosRiesgo = distancia ? exposure / distancia : 0;
  return {
    id: `${type}-${mode}-${createHash("sha256").update(JSON.stringify(geometria.coordinates)).digest("hex").slice(0, 16)}`,
    nombre: {
      corta: "Ruta más corta",
      segura: "Ruta más segura disponible",
      equilibrada: "Ruta equilibrada",
    }[type],
    tipo: type,
    distancia,
    duracion,
    geometria,
    puntosRiesgo,
    nivelRiesgo: levelFromPoints(puntosRiesgo),
    advertencias: [...warnings],
    incidentes: [...incidentIds],
    tramos: [...segments],
    actualizadoEn: updated,
    fuente: "OpenStreetMap",
    riesgoMetodo: "Promedio de puntos por distancia recorrida",
  };
}
function planRoutes(
  {
    origen,
    destino,
    modo = "walking",
    maxDesvioSeguro = 0.5,
    maxDesvioEquilibrado = 0.25,
  },
  incidents,
  now = new Date(),
  roads = getRoads(),
  rules = {},
) {
  if (!MODES.has(modo))
    throw error(400, "Elige caminar, bicicleta o vehículo.");
  if (!inProvinceOrBorder(origen, roads) || !inProvinceOrBorder(destino, roads))
    throw error(
      422,
      "No tenemos información disponible fuera de la provincia de Ica.",
      "OUTSIDE_COVERAGE",
    );
  if (distanceMeters(origen, destino) < 5)
    throw error(400, "El origen y el destino deben ser diferentes.");
  const covered = new Set(coveredSegments(roads).map((segment) => segment.id));
  const segments = scoreSegments(
    roads.segments,
    incidents,
    now,
    modo,
    rules,
  ).filter((s) => covered.has(s.id) && allows(s, modo) && !s.blocked);
  const snaps = graphFor(segments, origen, destino, modo);
  const short = shortestPath(snaps.graph, "corta");
  if (!short)
    throw error(
      422,
      "Las calles disponibles no conectan esos puntos para el transporte seleccionado. Elige otros puntos o transporte.",
      "NO_ROUTE",
    );
  const baseline = routeFrom(short, "corta", modo, snaps, now.toISOString());
  const rutas = [baseline];
  const shapes = new Set([JSON.stringify(baseline.geometria.coordinates)]);
  for (const [type, raw] of [
    ["segura", maxDesvioSeguro],
    ["equilibrada", maxDesvioEquilibrado],
  ]) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 2)
      throw error(400, "El desvío permitido debe estar entre 0 y 200%.");
    const limit = raw;
    const options = [];
    for (const scale of [1, 0.5, 0.2, 0.05, 0]) {
      const edges = shortestPath(snaps.graph, type, scale);
      if (!edges) continue;
      const route = routeFrom(edges, type, modo, snaps, now.toISOString());
      if (route.duracion <= baseline.duracion * (1 + limit) + 1)
        options.push(route);
    }
    options.sort(
      (a, b) => a.puntosRiesgo - b.puntosRiesgo || a.distancia - b.distancia,
    );
    const chosen = options[0];
    if (chosen) {
      const shape = JSON.stringify(chosen.geometria.coordinates);
      if (!shapes.has(shape)) {
        rutas.push(chosen);
        shapes.add(shape);
      }
    }
  }
  return {
    rutas,
    cobertura: "Provincia de Ica",
    fuente: "OpenStreetMap",
    atribucion: roads.atribucion,
    datosCallesActualizadosEn: roads.actualizadoEn,
    actualizadoEn: now.toISOString(),
    mensaje:
      rutas.length === 1
        ? "Las alternativas coinciden dentro de los límites de desvío. Puedes ampliar el tiempo adicional permitido."
        : undefined,
    limitesDesvio: {
      segura: maxDesvioSeguro,
      equilibrada: maxDesvioEquilibrado,
    },
  };
}
module.exports = { planRoutes, graphFor, shortestPath, Heap, MODES, routeFrom };
