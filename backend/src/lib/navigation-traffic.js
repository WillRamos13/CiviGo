"use strict";
const { routeCandidates, selectRoutes } = require("./navigation");
const { projectToLine, distanceMeters } = require("./risk");
const { updateStepDurations } = require("./navigation-steps");
const { getRoads } = require("./roads");
const { createTomTomClient, unavailable } = require("./tomtom");
const { createDatabaseQuota } = require("./traffic-quota");
const {
  normalizeTrafficIncidents,
  deduplicateTrafficAlerts,
} = require("./traffic-alerts");
const NO_TRAFFIC_WARNING =
  "Duración estimada con datos de calles; no incluye tráfico en vivo ni restricciones que aún no hayan sido reportadas.";
function pathMatches(local, provider) {
  const points =
    provider.path?.coordinates ||
    provider.legs?.flatMap((leg) => leg.path?.coordinates || []) ||
    [];
  const coordinates = local.geometria.coordinates;
  if (
    points.length < 2 ||
    points.length > 10000 ||
    points.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every(Number.isFinite),
    )
  )
    return false;
  if (
    distanceMeters(points[0], coordinates[0]) > 15 ||
    distanceMeters(points.at(-1), coordinates.at(-1)) > 15
  )
    return false;
  const offsets = [0];
  for (let i = 1; i < coordinates.length; i++)
    offsets.push(
      offsets.at(-1) + distanceMeters(coordinates[i - 1], coordinates[i]),
    );
  let previous = -15;
  for (let i = 0; i < points.length; i++) {
    const projection = projectToLine(points[i], coordinates);
    if (!projection || projection.distance > 15) return false;
    const offset =
      offsets[projection.index - 1] +
      distanceMeters(coordinates[projection.index - 1], projection.coordinates);
    if (offset < previous - 15) return false;
    previous = Math.max(previous, offset);
    // Check the middle of long chords too, so a provider cannot jump across a
    // forbidden street/intersection while both ends happen to be on our route.
    if (i && distanceMeters(points[i - 1], points[i]) > 30) {
      const midpoint = [
        (points[i - 1][0] + points[i][0]) / 2,
        (points[i - 1][1] + points[i][1]) / 2,
      ];
      if (projectToLine(midpoint, coordinates)?.distance > 15) return false;
    }
  }
  const length = Number(provider.summary?.lengthInMeters);
  return (
    length > 0 &&
    Math.abs(length - local.distancia) <=
      Math.max(20, local.distancia * 0.03) &&
    !(provider.sections?.travelMode || []).some(
      (section) => section.travelMode !== "car",
    )
  );
}
function applyTraffic(route, response) {
  const provider = response.data?.routes?.[0];
  const seconds = Number(provider?.summary?.travelDurationInSeconds);
  if (
    !provider ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    !pathMatches(route, provider)
  )
    throw unavailable("PROVIDER_UNAVAILABLE");
  const delay = Math.min(
    seconds,
    Math.max(0, Number(provider.summary.trafficDelayDurationInSeconds) || 0),
  );
  return {
    ...route,
    duracion: seconds,
    pasos: updateStepDurations(
      route,
      seconds,
      provider.progressPoints,
      Number(provider.summary.lengthInMeters),
    ),
    llegadaEstimada: new Date(
      new Date(route.actualizadoEn).getTime() + seconds * 1000,
    ).toISOString(),
    advertencias: route.advertencias.filter(
      (warning) => warning !== NO_TRAFFIC_WARNING,
    ),
    trafico: {
      disponible: true,
      fuente: "TOMTOM",
      actualizadoEn: response.actualizadoEn,
      demoraSegundos: delay,
      motivo:
        "Duración con tráfico TomTom; riesgo calculado únicamente con incidentes CiviGo.",
    },
  };
}
async function planRoutesWithTraffic(
  input,
  incidents,
  { client, roads = getRoads(), rules = {}, now = new Date() } = {},
) {
  const local = routeCandidates(input, incidents, now, roads, rules);
  if (input.modo !== "driving" || !client) {
    const { candidates, ...meta } = local;
    return {
      ...meta,
      ...selectRoutes(candidates, input.criterio),
      trafico: candidates[0]?.trafico,
    };
  }
  const evaluated = [];
  let failure = null;
  // At most two calls per batch keep six candidates within the browser's
  // request timeout. If one fails, use local times for the complete comparison.
  for (let index = 0; index < local.candidates.length; index += 2) {
    const batch = local.candidates.slice(index, index + 2);
    const outcomes = await Promise.allSettled(
      batch.map(async (route) =>
        applyTraffic(route, await client.route(route)),
      ),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") evaluated.push(outcome.value);
      else failure ||= outcome.reason;
    }
    if (failure) break;
  }
  const { candidates, ...meta } = local;
  const usable = failure
    ? candidates.map((route) => ({
        ...route,
        trafico: {
          ...route.trafico,
          motivo: failure.message || "Sin tráfico actualizado.",
        },
      }))
    : evaluated;
  const selection = selectRoutes(usable, input.criterio);
  return { ...meta, ...selection, trafico: usable[0]?.trafico };
}
function provinceBounds(roads) {
  const coordinates = roads.boundary.outer.flat();
  return [
    Math.min(...coordinates.map((point) => point[0])),
    Math.min(...coordinates.map((point) => point[1])),
    Math.max(...coordinates.map((point) => point[0])),
    Math.max(...coordinates.map((point) => point[1])),
  ];
}
function incidentBounds(roads) {
  const box = provinceBounds(roads);
  const area =
    (box[2] - box[0]) *
    (box[3] - box[1]) *
    111.32 ** 2 *
    Math.cos(((box[1] + box[3]) * Math.PI) / 360);
  const count = Math.max(1, Math.ceil(area / 9000));
  // Orbis permits at most 10,000 km² per box. Fixed partitions are shared by
  // every viewer instead of spending quota separately for arbitrary viewports.
  return Array.from({ length: count }, (_, index) => [
    box[0],
    box[1] + ((box[3] - box[1]) * index) / count,
    box[2],
    box[1] + ((box[3] - box[1]) * (index + 1)) / count,
  ]);
}
function intersectsTile(z, x, y, bounds) {
  const n = 2 ** z,
    lon = (column) => (column / n) * 360 - 180;
  const lat = (row) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return (
    lon(x) <= bounds[2] &&
    lon(x + 1) >= bounds[0] &&
    lat(y + 1) <= bounds[3] &&
    lat(y) >= bounds[1]
  );
}
function createTrafficService({
  db,
  env = process.env,
  fetchImpl,
  roads,
  now = () => new Date(),
  client,
} = {}) {
  const provider =
    client ||
    createTomTomClient({
      env,
      fetchImpl,
      quota: createDatabaseQuota(db, env),
      now,
    });
  const network = () => roads || getRoads();
  return {
    status: () => provider.status(),
    plan: (input, civic, options = {}) =>
      planRoutesWithTraffic(input, civic, {
        client: provider,
        roads: network(),
        now: now(),
        ...options,
      }),
    async incidents(civic = [], requestedBounds = null) {
      const currentRoads = network();
      try {
        const features = [],
          timestamps = [];
        for (const bounds of incidentBounds(currentRoads)) {
          const response = await provider.incidents(bounds);
          features.push(
            ...(Array.isArray(response.data?.incidents)
              ? response.data.incidents
              : []),
          );
          timestamps.push(response.actualizadoEn);
        }
        const updated = timestamps.sort()[0];
        const normalized = normalizeTrafficIncidents(
          features,
          currentRoads,
          updated,
          now(),
        );
        // Read moderation on every response so a newly hidden event is removed
        // immediately even while the provider response remains cached.
        const hidden = await db.externalTrafficModeration.findMany({
          where: { proveedor: "TOMTOM", oculto: true },
          select: { externoId: true },
        });
        let visible = deduplicateTrafficAlerts(
          normalized,
          civic,
          currentRoads,
          hidden,
          now(),
        );
        if (requestedBounds)
          visible = visible.filter(
            (event) =>
              event.longitud >= requestedBounds[0] &&
              event.longitud <= requestedBounds[2] &&
              event.latitud >= requestedBounds[1] &&
              event.latitud <= requestedBounds[3],
          );
        return {
          incidentes: visible,
          trafico: {
            disponible: true,
            fuente: "TOMTOM",
            actualizadoEn: updated,
            motivo:
              "Avisos temporales externos; no suman puntos de riesgo CiviGo.",
          },
          atribucion: "© TomTom",
        };
      } catch (error) {
        return {
          incidentes: [],
          trafico: {
            disponible: false,
            fuente: null,
            actualizadoEn: null,
            motivo:
              error.name === "TrafficUnavailable"
                ? error.message
                : "Sin avisos de tráfico: no se pudo comprobar su moderación.",
          },
        };
      }
    },
    async tile(z, x, y) {
      if (
        ![z, x, y].every(Number.isInteger) ||
        z < 0 ||
        z > 22 ||
        x < 0 ||
        y < 0 ||
        x >= 2 ** z ||
        y >= 2 ** z ||
        !intersectsTile(z, x, y, provinceBounds(network()))
      )
        throw Object.assign(
          new Error("La tesela no pertenece a la cobertura de Ica."),
          { status: 400 },
        );
      return provider.tile(z, x, y);
    },
  };
}
module.exports = {
  pathMatches,
  applyTraffic,
  planRoutesWithTraffic,
  provinceBounds,
  incidentBounds,
  intersectsTile,
  createTrafficService,
};
