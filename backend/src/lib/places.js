"use strict";
const { HttpError, distance } = require("./http");
const { getRoads, searchPlaces, inProvince, normalize } = require("./roads");
const { createTomTomClient } = require("./tomtom");
const { createDatabaseQuota } = require("./traffic-quota");
const { significantTokens } = require("./local-places");

const coverageBounds = new WeakMap();
function provinceBounds(roads) {
  if (coverageBounds.has(roads)) return coverageBounds.get(roads);
  const bounds = { north: -90, south: 90, east: -180, west: 180 };
  for (const ring of roads.boundary.outer)
    for (const [longitude, latitude] of ring) {
      bounds.north = Math.max(bounds.north, latitude);
      bounds.south = Math.min(bounds.south, latitude);
      bounds.east = Math.max(bounds.east, longitude);
      bounds.west = Math.min(bounds.west, longitude);
    }
  if (bounds.north <= bounds.south || bounds.east <= bounds.west)
    throw new HttpError(
      503,
      "No hay cobertura de búsqueda disponible.",
      "ROADS_UNAVAILABLE",
    );
  coverageBounds.set(roads, bounds);
  return bounds;
}

function providerPlaces(data, roads) {
  if (!Array.isArray(data?.results)) throw new Error("Invalid place results");
  const results = [];
  for (const place of data.results) {
    const point = {
      latitud: place?.position?.lat,
      longitud: place?.position?.lon,
    };
    const name =
      place?.poi?.name ||
      place?.address?.freeformAddress ||
      place?.address?.streetName;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      !Number.isFinite(point.latitud) ||
      !Number.isFinite(point.longitud) ||
      Math.abs(point.latitud) > 90 ||
      Math.abs(point.longitud) > 180 ||
      !inProvince(point, roads)
    )
      continue;
    const title = name.trim().slice(0, 200);
    if (
      results.some(
        (result) =>
          normalize(result.nombre) === normalize(title) &&
          distance(result, point) < 40,
      )
    )
      continue;
    const description = place.address?.freeformAddress;
    results.push({
      nombre: title,
      ...point,
      fuente: "TomTom",
      ...(typeof description === "string" &&
      description.trim() &&
      description.trim() !== title
        ? { descripcion: description.trim().slice(0, 240) }
        : {}),
    });
    if (results.length === 12) break;
  }
  return results;
}

function createPlaceService({
  db,
  env = process.env,
  client,
  loadRoads = getRoads,
  localSearch = searchPlaces,
} = {}) {
  // Separate caches and provider cooldowns keep a search outage from affecting
  // traffic or navigation. Usage reservations still share the database.
  const provider =
    client || createTomTomClient({ env, quota: createDatabaseQuota(db, env) });
  return {
    async search(query) {
      const cleaned = query.trim().replace(/\s+/g, " ");
      if (!significantTokens(cleaned).length) return [];
      const roads = loadRoads();
      const local = localSearch(cleaned, roads);
      if (local.length) return local;
      const status = provider.configuration();
      if (!status.configurado || !status.habilitado) return [];
      try {
        const response = await provider.search(cleaned, provinceBounds(roads));
        return providerPlaces(response.data, roads);
      } catch {
        throw new HttpError(
          503,
          "No se pudo ampliar la búsqueda de lugares. Intenta con otro nombre o dirección.",
          "PLACES_SEARCH_UNAVAILABLE",
        );
      }
    },
  };
}
module.exports = { createPlaceService, providerPlaces, provinceBounds };
