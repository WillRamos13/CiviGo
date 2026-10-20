"use strict";
const { createHash } = require("node:crypto");
const { HttpError, coordinates } = require("./http");
const { projectToLine, distanceMeters } = require("./risk");
const { inProvince } = require("./roads");
const {
  loadLocalPlaces,
  normalizePlaceName,
  significantTokens,
} = require("./local-places");

function routePoints(geometry) {
  if (
    geometry?.type !== "LineString" ||
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length < 2 ||
    geometry.coordinates.length > 2000
  )
    throw new HttpError(
      400,
      "El corredor requiere entre 2 y 2000 coordenadas.",
    );
  return geometry.coordinates.map((point) => {
    if (!Array.isArray(point) || point.length !== 2)
      throw new HttpError(400, "Coordenadas del corredor inválidas.");
    coordinates(point[1], point[0]);
    return point;
  });
}

function searchCorridor(input, roads, catalog = loadLocalPlaces()) {
  if (!input || typeof input !== "object")
    throw new HttpError(400, "Consulta del corredor inválida.");
  const points = routePoints(input.geometria);
  const radius = input.radioMetros ?? 500,
    offset = input.offset ?? 0,
    limit = input.limit ?? 20;
  if (
    !Number.isFinite(radius) ||
    radius < 25 ||
    radius > 2000 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new HttpError(400, "Radio o paginación del corredor inválidos.");
  if (
    input.q !== undefined &&
    (typeof input.q !== "string" || input.q.length > 160)
  )
    throw new HttpError(400, "Búsqueda inválida.");
  const tokens = significantTokens(input.q || ""),
    matches = [],
    seen = new Set();
  for (const place of catalog) {
    if (
      !Number.isFinite(place.latitud) ||
      !Number.isFinite(place.longitud) ||
      typeof place.nombre !== "string" ||
      !inProvince(place, roads)
    )
      continue;
    const name = normalizePlaceName(place.nombre);
    if (!tokens.every((token) => name.includes(token))) continue;
    const projection = projectToLine([place.longitud, place.latitud], points);
    if (!projection || projection.distance > radius) continue;
    if (
      matches.some(
        (other) =>
          normalizePlaceName(other.nombre) === name &&
          distanceMeters(other, place) < 35,
      )
    )
      continue;
    const id = `local:${createHash("sha256")
      .update(`${place.osmId || ""}|${name}|${place.latitud}|${place.longitud}`)
      .digest("hex")
      .slice(0, 24)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    matches.push({
      id,
      nombre: place.nombre,
      latitud: place.latitud,
      longitud: place.longitud,
      fuente: place.fuente || "OpenStreetMap",
      descripcion: place.descripcion || null,
      distanciaAlCorredorMetros: Math.round(projection.distance),
      distanciaMetodo: "Distancia geométrica; no mide desvío por carretera",
      osmId: place.osmId || null,
    });
  }
  matches.sort(
    (a, b) =>
      a.distanciaAlCorredorMetros - b.distanciaAlCorredorMetros ||
      a.id.localeCompare(b.id),
  );
  return {
    items: matches.slice(offset, offset + limit),
    total: matches.length,
    nextOffset: offset + limit < matches.length ? offset + limit : null,
    fuente: "Catálogo local OpenStreetMap",
    cobertura:
      "Lugares disponibles en el catálogo provincial; no es una búsqueda exhaustiva",
    atribucion: "© OpenStreetMap contributors",
    licencia: "ODbL",
    advertencias: [
      "La cercanía al corredor no demuestra acceso ni un desvío corto. Calcula la ruta hasta el lugar antes de añadirlo.",
    ],
  };
}

function itineraryPoints(input) {
  if (!input || typeof input !== "object")
    throw new HttpError(400, "Itinerario inválido.");
  if (!Array.isArray(input.paradas) || input.paradas.length > 3)
    throw new HttpError(400, "Se permiten hasta tres paradas ordenadas.");
  const points = [input.origen, ...input.paradas, input.destino].map((p) =>
    coordinates(p?.latitud, p?.longitud),
  );
  for (let i = 1; i < points.length; i++)
    if (distanceMeters(points[i - 1], points[i]) < 5)
      throw new HttpError(
        400,
        "Las paradas consecutivas deben ser diferentes.",
      );
  return points;
}
module.exports = { searchCorridor, itineraryPoints };
