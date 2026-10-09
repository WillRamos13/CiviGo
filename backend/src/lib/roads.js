"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { HttpError } = require("./http");
const { distanceMeters, projectToLine } = require("./risk");
const { searchLocalPlaces } = require("./local-places");
let cached;
const coverageCache = new WeakMap();
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
function lengthOf(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++)
    total += distanceMeters(coordinates[i - 1], coordinates[i]);
  return total;
}
function ringsFromRelation(relation, ways, nodes, role = "outer") {
  const chains = (relation?.members || [])
    .filter(
      (m) =>
        m.type === "way" && (m.role === role || (!m.role && role === "outer")),
    )
    .map((m) => ways.get(m.ref)?.nodes?.slice())
    .filter(Boolean);
  const rings = [];
  while (chains.length) {
    const ring = chains.shift();
    let changed = true;
    while (ring[0] !== ring.at(-1) && changed) {
      changed = false;
      for (let i = 0; i < chains.length; i++) {
        let chain = chains[i];
        if (chain[0] === ring.at(-1)) ring.push(...chain.slice(1));
        else if (chain.at(-1) === ring.at(-1)) {
          chain = chain.slice().reverse();
          ring.push(...chain.slice(1));
        } else if (chain.at(-1) === ring[0])
          ring.unshift(...chain.slice(0, -1));
        else if (chain[0] === ring[0]) {
          chain = chain.slice().reverse();
          ring.unshift(...chain.slice(0, -1));
        } else continue;
        chains.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (ring[0] === ring.at(-1))
      rings.push(ring.map((id) => nodes.get(id)).filter(Boolean));
  }
  return rings;
}
function containsRing(point, ring) {
  const x = point.longitud ?? point[0],
    y = point.latitud ?? point[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function parseRoads(data) {
  const nodes = new Map(
    data.elements
      .filter((e) => e.type === "node")
      .map((e) => [e.id, [e.lon, e.lat]]),
  );
  const ways = new Map(
    data.elements.filter((e) => e.type === "way").map((e) => [e.id, e]),
  );
  const usage = new Map();
  const roads = [...ways.values()].filter(
    (w) =>
      w.tags?.highway && !["proposed", "construction"].includes(w.tags.highway),
  );
  for (const way of roads)
    for (const id of new Set(way.nodes))
      usage.set(id, (usage.get(id) || 0) + 1);
  const segments = [];
  for (const way of roads) {
    let current = [];
    let index = 0;
    for (let i = 0; i < way.nodes.length; i++) {
      const node = way.nodes[i];
      if (!nodes.has(node)) continue;
      current.push(node);
      if (
        current.length > 1 &&
        (i === way.nodes.length - 1 || usage.get(node) > 1)
      ) {
        const coordinates = current.map((n) => nodes.get(n));
        const length = lengthOf(coordinates);
        if (length > 0.1)
          segments.push({
            id: `${way.id}:${index++}`,
            osmId: way.id,
            start: String(current[0]),
            end: String(node),
            coordinates,
            length,
            tags: way.tags,
            nombre: way.tags.name || "Vía sin nombre",
          });
        current = [node];
      }
    }
  }
  const relation =
    data.elements.find(
      (e) => e.type === "relation" && e.tags?.["pe:ubigeo"] === "1101",
    ) ||
    data.elements.find(
      (e) => e.type === "relation" && e.tags?.admin_level === "6",
    );
  const boundary = {
    outer: ringsFromRelation(relation, ways, nodes),
    inner: ringsFromRelation(relation, ways, nodes, "inner"),
  };
  const districts = data.elements
    .filter((e) => e.type === "relation" && e.tags?.admin_level === "8")
    .map((r) => ({
      nombre: r.tags.name.replace(/^Distrito de /i, ""),
      outer: ringsFromRelation(r, ways, nodes),
      inner: ringsFromRelation(r, ways, nodes, "inner"),
    }));
  return {
    segments,
    boundary,
    districts,
    actualizadoEn: data.actualizadoEn,
    fuente: data.fuente,
    atribucion: data.atribucion,
    licencia: data.licencia,
  };
}
function getRoads() {
  if (cached) return cached;
  const filename =
    process.env.ROADS_FILE || path.join(__dirname, "../../data/ica-roads.json");
  if (!fs.existsSync(filename))
    throw new HttpError(
      503,
      "No hay datos de calles disponibles. Ejecuta npm run roads:import en el backend.",
      "ROADS_UNAVAILABLE",
    );
  cached = parseRoads(JSON.parse(fs.readFileSync(filename, "utf8")));
  return cached;
}
function inProvince(point, roads = getRoads()) {
  return (
    roads.boundary.outer.some((r) => containsRing(point, r)) &&
    !roads.boundary.inner.some((r) => containsRing(point, r))
  );
}
function inProvinceOrBorder(point, roads = getRoads()) {
  if (inProvince(point, roads)) return true;
  return [...roads.boundary.outer, ...roads.boundary.inner].some((ring) => {
    const closed =
      ring.length &&
      (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
        ? [...ring, ring[0]]
        : ring;
    const projection = projectToLine(point, closed);
    // Only numerical rounding on the exact border; no extra coverage radius.
    return projection && projection.distance <= 0.00002;
  });
}
function districtFor(point, roads = getRoads()) {
  return (
    roads.districts?.find(
      (d) =>
        d.outer.some((r) => containsRing(point, r)) &&
        !d.inner.some((r) => containsRing(point, r)),
    )?.nombre || null
  );
}
function coveredSegments(roads = getRoads()) {
  if (coverageCache.has(roads)) return coverageCache.get(roads);
  const size = 0.01,
    epsilon = 1e-10;
  const allEdges = [],
    cells = new Map(),
    fallback = [],
    pointCache = new Map();
  const prepareRing = (coordinates) => {
    const buckets = new Map();
    for (
      let i = 0, j = coordinates.length - 1;
      i < coordinates.length;
      j = i++
    ) {
      const a = coordinates[j],
        b = coordinates[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const edge = { a, b };
      allEdges.push(edge);
      const minX = Math.floor(Math.min(a[0], b[0]) / size),
        maxX = Math.floor(Math.max(a[0], b[0]) / size);
      const minY = Math.floor(Math.min(a[1], b[1]) / size),
        maxY = Math.floor(Math.max(a[1], b[1]) / size);
      for (let y = minY; y <= maxY; y++) {
        if (!buckets.has(y)) buckets.set(y, []);
        buckets.get(y).push(edge);
      }
      if ((maxX - minX + 1) * (maxY - minY + 1) > 4096) {
        fallback.push(edge);
        continue;
      }
      for (let x = minX; x <= maxX; x++)
        for (let y = minY; y <= maxY; y++) {
          const key = `${x}:${y}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(edge);
        }
    }
    return buckets;
  };
  const outer = roads.boundary.outer.map(prepareRing),
    inner = roads.boundary.inner.map(prepareRing);
  const crosses = (a, b) => {
    const minX = Math.floor((Math.min(a[0], b[0]) - epsilon) / size),
      maxX = Math.floor((Math.max(a[0], b[0]) + epsilon) / size);
    const minY = Math.floor((Math.min(a[1], b[1]) - epsilon) / size),
      maxY = Math.floor((Math.max(a[1], b[1]) + epsilon) / size);
    if ((maxX - minX + 1) * (maxY - minY + 1) > 4096) return allEdges;
    const candidates = new Set(fallback);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (const edge of cells.get(`${x}:${y}`) || []) candidates.add(edge);
    return candidates;
  };
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const onEdge = (p, { a, b }) => {
    if (
      p[0] < Math.min(a[0], b[0]) - epsilon ||
      p[0] > Math.max(a[0], b[0]) + epsilon ||
      p[1] < Math.min(a[1], b[1]) - epsilon ||
      p[1] > Math.max(a[1], b[1]) + epsilon
    )
      return false;
    const r = [b[0] - a[0], b[1] - a[1]],
      q = [p[0] - a[0], p[1] - a[1]];
    return (
      Math.abs(cross(r, q)) <=
      epsilon * Math.max(Math.abs(r[0]), Math.abs(r[1]))
    );
  };
  const ringContains = (p, buckets) => {
    let inside = false;
    for (const { a, b } of buckets.get(Math.floor(p[1] / size)) || [])
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    return inside;
  };
  const within = (p) => {
    const key = `${p[0]},${p[1]}`;
    if (pointCache.has(key)) return pointCache.get(key);
    // The provincial border itself is covered, including a road following it.
    const allowed =
      (outer.some((r) => ringContains(p, r)) &&
        !inner.some((r) => ringContains(p, r))) ||
      [...crosses(p, p)].some((edge) => onEdge(p, edge));
    pointCache.set(key, allowed);
    return allowed;
  };
  const edgeWithin = (a, b) => {
    if (!within(a) || !within(b)) return false;
    const r = [b[0] - a[0], b[1] - a[1]],
      cuts = [0, 1];
    const rr = r[0] * r[0] + r[1] * r[1];
    if (!rr) return true;
    for (const edge of crosses(a, b)) {
      const s = [edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]],
        q = [edge.a[0] - a[0], edge.a[1] - a[1]],
        denominator = cross(r, s);
      if (Math.abs(denominator) > 1e-18) {
        const t = cross(q, s) / denominator,
          u = cross(q, r) / denominator;
        if (
          t >= -epsilon &&
          t <= 1 + epsilon &&
          u >= -epsilon &&
          u <= 1 + epsilon
        )
          cuts.push(Math.max(0, Math.min(1, t)));
      } else if (
        Math.abs(cross(q, r)) <=
        epsilon * Math.max(Math.abs(r[0]), Math.abs(r[1]))
      ) {
        for (const p of [edge.a, edge.b]) {
          const t = ((p[0] - a[0]) * r[0] + (p[1] - a[1]) * r[1]) / rr;
          if (t > 0 && t < 1) cuts.push(t);
        }
      }
    }
    cuts.sort((a, b) => a - b);
    // Check every interval, rather than a single midpoint that misses concavities.
    for (let i = 1; i < cuts.length; i++)
      if (cuts[i] - cuts[i - 1] > epsilon) {
        const t = (cuts[i] + cuts[i - 1]) / 2;
        if (!within([a[0] + r[0] * t, a[1] + r[1] * t])) return false;
      }
    return true;
  };
  const result = roads.segments.filter((segment) =>
    segment.coordinates.every(
      (p, i, all) => within(p) && (!i || edgeWithin(all[i - 1], p)),
    ),
  );
  coverageCache.set(roads, result);
  return result;
}
function allows(segment, mode) {
  const tags = segment.tags || {};
  const hierarchy = {
    walking: ["foot", "access"],
    cycling: ["bicycle", "vehicle", "access"],
    driving: ["motorcar", "motor_vehicle", "vehicle", "access"],
  }[mode];
  if (!hierarchy) return false;
  // OSM's most-specific tag overrides its parent: foot=yes may except access=no.
  // https://wiki.openstreetmap.org/wiki/Key:access#Transport_mode_restrictions
  const key = hierarchy.find(
    (name) => typeof tags[name] === "string" && tags[name].trim(),
  );
  const access = key ? tags[key].trim().toLowerCase() : null;
  // Public routes cannot assume a customer's status, a permit, destination access,
  // or permission to push a bicycle. Unknown explicit permissions are not grants.
  const publicAccess = new Set([
    "yes",
    "designated",
    "permissive",
    "discouraged",
    "public",
  ]);
  if (access && !publicAccess.has(access)) return false;
  const highway = tags.highway;
  if (["proposed", "construction"].includes(highway)) return false;
  if (mode !== "walking" && highway === "steps") return false;
  const restricted =
    mode === "driving"
      ? ["footway", "pedestrian", "cycleway", "path", "bridleway", "corridor"]
      : ["motorway", "motorway_link"];
  if (!restricted.includes(highway)) return true;
  // A general access=yes does not make a motorway walkable or a footway drivable.
  return !!key && key !== "access" && publicAccess.has(access);
}
function nearest(point, segments) {
  let best;
  for (const segment of segments) {
    const projection = projectToLine(point, segment.coordinates);
    if (projection && (!best || projection.distance < best.projection.distance))
      best = { segment, projection };
  }
  return best;
}
function searchPlaces(query, roads = getRoads()) {
  return searchLocalPlaces(query, roads, {
    contains: (point) => inProvince(point, roads),
  });
}
module.exports = {
  getRoads,
  parseRoads,
  inProvince,
  inProvinceOrBorder,
  districtFor,
  containsRing,
  allows,
  nearest,
  lengthOf,
  searchPlaces,
  normalize,
  coveredSegments,
};
