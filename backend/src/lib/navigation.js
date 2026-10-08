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
const { stepsFromEdges } = require("./navigation-steps");
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
      if (Heap.compare(a[p], value) <= 0) break;
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
        if (c + 1 < a.length && Heap.compare(a[c + 1], a[c]) < 0) c++;
        if (Heap.compare(a[c], last) >= 0) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return first;
  }
  static compare(a, b) {
    return a.cost - b.cost || (a.time || 0) - (b.time || 0);
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
function shortestPath(graph, profile, mode = "walking", penalties = new Map()) {
  const costs = new Map([["@origin", 0]]),
    times = new Map([["@origin", 0]]),
    previous = new Map(),
    heap = new Heap();
  heap.push({ node: "@origin", cost: 0, time: 0 });
  while (heap.items.length) {
    const current = heap.pop();
    if (
      current.cost !== costs.get(current.node) ||
      current.time !== times.get(current.node)
    )
      continue;
    if (current.node === "@destination") break;
    for (const edge of graph.get(current.node) || []) {
      const s = edge.segment;
      const seconds = edge.length / speed(edge, mode);
      const risk =
        s.points + (s.pending ? 5 : 0) + (s.emergencies.length ? 10 : 0);
      // Safety is lexicographic: minimum cumulative exposure, then time. There
      // is deliberately no maximum detour or fixed safety-vs-time multiplier.
      const base =
        profile === "segura"
          ? edge.length * risk
          : profile === "corta"
            ? edge.length
            : seconds * (profile === "equilibrada" ? 1 + risk / 5 : 1);
      const cost = current.cost + base * (penalties.get(s.id) || 1);
      const time = times.get(current.node) + seconds;
      if (
        cost < (costs.get(edge.to) ?? Infinity) ||
        (cost === costs.get(edge.to) && time < times.get(edge.to))
      ) {
        costs.set(edge.to, cost);
        times.set(edge.to, time);
        previous.set(edge.to, { from: current.node, edge });
        heap.push({ node: edge.to, cost, time });
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
    exposure = 0,
    safetyCost = 0;
  const warnings = new Set();
  let pending = false;
  const incidentIds = new Set(),
    segments = new Set();
  for (const edge of edges) {
    pending ||= edge.segment.pending;
    distancia += edge.length;
    duracion += edge.length / speed(edge, mode);
    exposure += edge.length * edge.segment.points;
    safetyCost +=
      edge.length *
      (edge.segment.points +
        (edge.segment.pending ? 5 : 0) +
        (edge.segment.emergencies.length ? 10 : 0));
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
      corta: "Ruta más corta (guardada)",
      rapida: "Ruta más rápida disponible",
      segura: pending
        ? "Menor riesgo estimado (datos por evaluar)"
        : "Ruta de menor riesgo registrado",
      equilibrada: "Ruta equilibrada",
    }[type],
    tipo: type,
    criterios: [type],
    modo: mode,
    distancia,
    duracion,
    geometria,
    puntosRiesgo,
    nivelRiesgo: levelFromPoints(puntosRiesgo),
    exposicionTotal: exposure,
    costoSeguridad: safetyCost,
    riesgoConocido: !pending,
    advertencias: [...warnings],
    incidentes: [...incidentIds],
    tramos: [...segments],
    actualizadoEn: updated,
    fuente: "OpenStreetMap",
    riesgoMetodo: "Promedio de puntos por distancia recorrida",
    pasos: stepsFromEdges(
      edges,
      mode,
      (edge, selectedMode) => edge.length / speed(edge, selectedMode),
    ),
    llegadaEstimada: new Date(
      new Date(updated).getTime() + duracion * 1000,
    ).toISOString(),
    trafico: {
      disponible: false,
      fuente: null,
      actualizadoEn: null,
      demoraSegundos: 0,
      motivo:
        mode === "driving"
          ? "Sin tráfico actualizado; duración estimada con la red local."
          : "El tráfico vehicular no se aplica a este transporte.",
    },
  };
}
function routeCandidates(
  { origen, destino, modo = "walking" },
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
  const fast = shortestPath(snaps.graph, "rapida", modo);
  if (!fast)
    throw error(
      422,
      "Las calles disponibles no conectan esos puntos para el transporte seleccionado. Elige otros puntos o transporte.",
      "NO_ROUTE",
    );
  const candidates = [],
    shapes = new Set();
  const add = (edges, type) => {
    if (!edges) return;
    const route = routeFrom(edges, type, modo, snaps, now.toISOString());
    const shape = JSON.stringify(route.geometria.coordinates);
    if (shapes.has(shape)) return;
    shapes.add(shape);
    candidates.push({ ...route, origen, destino });
  };
  add(fast, "rapida");
  add(shortestPath(snaps.graph, "segura", modo), "segura");
  add(shortestPath(snaps.graph, "equilibrada", modo), "equilibrada");
  // A few legal local alternatives allow live travel times to change the fast
  // and balanced selections. Limits bound computation and provider requests,
  // never the allowed distance of the minimum-risk path.
  const rankedEdges = [...fast]
    .filter((edge) => edge.length > 1)
    .sort((a, b) => b.length - a.length);
  for (const edge of rankedEdges.slice(0, 3)) {
    if (candidates.length >= 6) break;
    add(
      shortestPath(
        snaps.graph,
        "rapida",
        modo,
        new Map([[edge.segment.id, 20]]),
      ),
      "rapida",
    );
  }
  return {
    candidates,
    cobertura: "Provincia de Ica",
    fuente: "OpenStreetMap",
    atribucion: roads.atribucion,
    datosCallesActualizadosEn: roads.actualizadoEn,
    actualizadoEn: now.toISOString(),
  };
}
function selectRoutes(candidates, criterio = "rapida") {
  const selected = [],
    shapes = new Map();
  const fastest = Math.min(...candidates.map((route) => route.duracion));
  const leastRisk = Math.min(
    ...candidates.map((route) => route.exposicionTotal),
  );
  const maxRisk = Math.max(...candidates.map((route) => route.exposicionTotal));
  for (const type of ["rapida", "segura", "equilibrada"]) {
    const score = (route) =>
      type === "rapida"
        ? route.duracion
        : type === "segura"
          ? (route.costoSeguridad ?? route.exposicionTotal)
          : route.duracion / Math.max(1, fastest) +
            (route.exposicionTotal - leastRisk) /
              Math.max(1, maxRisk - leastRisk);
    const candidate = [...candidates].sort(
      (a, b) =>
        score(a) - score(b) ||
        a.duracion - b.duracion ||
        a.distancia - b.distancia,
    )[0];
    if (!candidate) continue;
    const shape = JSON.stringify(candidate.geometria.coordinates);
    if (shapes.has(shape)) {
      shapes.get(shape).criterios.push(type);
      continue;
    }
    const route = {
      ...candidate,
      tipo: type,
      criterios: [type],
      nombre:
        type === "segura"
          ? candidate.riesgoConocido
            ? "Ruta de menor riesgo registrado"
            : "Menor riesgo estimado (datos por evaluar)"
          : type === "rapida"
            ? "Ruta más rápida disponible"
            : "Ruta equilibrada",
    };
    shapes.set(shape, route);
    selected.push(route);
  }
  const chosen =
    selected.find((route) => route.criterios.includes(criterio)) || selected[0];
  return {
    rutas: selected,
    seleccionadaId: chosen?.id,
    criterio: ["rapida", "segura", "equilibrada"].includes(criterio)
      ? criterio
      : "rapida",
    mensaje:
      selected.length < 3
        ? "Algunos criterios coinciden en el mismo recorrido; se muestran únicamente rutas distintas."
        : undefined,
  };
}
function planRoutes(
  input,
  incidents,
  now = new Date(),
  roads = getRoads(),
  rules = {},
) {
  const { candidates, ...meta } = routeCandidates(
    input,
    incidents,
    now,
    roads,
    rules,
  );
  return {
    ...meta,
    ...selectRoutes(candidates, input.criterio),
    trafico: candidates[0]?.trafico,
  };
}
module.exports = {
  planRoutes,
  routeCandidates,
  selectRoutes,
  graphFor,
  shortestPath,
  Heap,
  MODES,
  routeFrom,
  directionFor,
  speed,
};
