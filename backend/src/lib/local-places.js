"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { distanceMeters } = require("./risk");

const STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "en",
  "provincia",
  "distrito",
  "peru",
]);
const ABBREVIATIONS = {
  av: "avenida",
  ave: "avenida",
  avda: "avenida",
  jr: "jiron",
  psje: "pasaje",
};
const indexCache = new WeakMap();
let catalogCache;

function normalizePlaceName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ABBREVIATIONS[token] || token)
    .join(" ");
}

function significantTokens(value) {
  return normalizePlaceName(value)
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
}

function validCoordinates(place) {
  return (
    Number.isFinite(place?.latitud) &&
    Number.isFinite(place?.longitud) &&
    Math.abs(place.latitud) <= 90 &&
    Math.abs(place.longitud) <= 180
  );
}

function loadLocalPlaces() {
  const filename =
    process.env.PLACES_FILE ||
    path.join(__dirname, "../../data/ica-places.json");
  if (catalogCache?.filename === filename) return catalogCache.places;
  let places = [];
  // An absent optional catalog must not disable the existing street search.
  if (fs.existsSync(filename)) {
    const document = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (!Array.isArray(document.places))
      throw new Error(
        "El catálogo local de lugares no tiene una lista places válida.",
      );
    places = document.places;
  }
  catalogCache = { filename, places };
  return places;
}

function buildLocalPlaceIndex(roads, places, contains) {
  const entries = [];
  const seenRoads = new Set();
  const add = (place, kind) => {
    if (
      typeof place?.nombre !== "string" ||
      !place.nombre.trim() ||
      !validCoordinates(place)
    )
      return;
    const name = normalizePlaceName(place.nombre);
    if (!name) return;
    if (kind === "street" && seenRoads.has(name)) return;
    if (!contains(place)) return;
    if (kind === "street") {
      seenRoads.add(name);
    } else if (
      entries.some(
        (entry) =>
          entry.kind === "place" &&
          entry.name === name &&
          distanceMeters(place, entry.place) <= 35,
      )
    ) {
      // OSM may represent the same venue as both a node and a building. Equal
      // names at distinct locations remain selectable (for example branches).
      return;
    }
    const output = {
      nombre: place.nombre.trim(),
      latitud: place.latitud,
      longitud: place.longitud,
      fuente: place.fuente || "OpenStreetMap",
      ...(typeof place.descripcion === "string" && place.descripcion.trim()
        ? { descripcion: place.descripcion.trim() }
        : {}),
    };
    entries.push({
      place: output,
      kind,
      name,
      nameTokens: significantTokens(name),
      contextTokens: significantTokens(
        `${output.descripcion || ""} provincia de Ica`,
      ),
      order: entries.length,
    });
  };
  for (const place of places) add(place, "place");
  // Future road snapshots may also include named OSM venues; no additional
  // network request or database read is required for these points.
  for (const place of roads.places || []) add(place, "place");
  for (const segment of roads.segments || []) {
    if (
      !segment.tags?.name ||
      !Array.isArray(segment.coordinates) ||
      !segment.coordinates.length
    )
      continue;
    const coordinates =
      segment.coordinates[Math.floor(segment.coordinates.length / 2)];
    add(
      {
        nombre: segment.tags.name,
        latitud: coordinates[1],
        longitud: coordinates[0],
        descripcion: "Vía de la provincia de Ica",
        fuente: "OpenStreetMap",
      },
      "street",
    );
  }
  return entries;
}

function rankEntry(entry, queryTokens, phrase) {
  let exactNames = 0,
    prefixNames = 0,
    contextMatches = 0;
  for (let index = 0; index < queryTokens.length; index++) {
    const token = queryTokens[index];
    if (entry.nameTokens.includes(token)) exactNames++;
    else if (
      (token.length >= 3 ||
        (index === queryTokens.length - 1 && token.length >= 2)) &&
      entry.nameTokens.some((word) => word.startsWith(token))
    )
      prefixNames++;
    else if (entry.contextTokens.includes(token)) contextMatches++;
    else return null;
  }
  // Context (city or district) helps qualify a named place, but must not cause
  // every venue in Ica to outrank a place whose own name matches the query.
  if (
    !exactNames &&
    !prefixNames &&
    queryTokens.some((token) => token !== "ica")
  )
    return null;
  const namePhrase = entry.nameTokens.join(" ");
  const queryNamePhrase = queryTokens
    .filter((token) => entry.nameTokens.includes(token))
    .join(" ");
  return (
    (entry.name === phrase ? 1000 : 0) +
    (namePhrase === queryTokens.join(" ") ? 700 : 0) +
    (queryNamePhrase && namePhrase.startsWith(queryNamePhrase) ? 90 : 0) +
    exactNames * 70 +
    prefixNames * 35 -
    contextMatches * 8 +
    (entry.kind === "place" ? 5 : 0)
  );
}

function searchLocalPlaces(
  query,
  roads,
  { contains, places = loadLocalPlaces(), limit = 12 } = {},
) {
  const phrase = normalizePlaceName(query);
  const queryTokens = significantTokens(query);
  if (phrase.length < 2 || !queryTokens.length) return [];
  if (typeof contains !== "function")
    throw new TypeError(
      "La búsqueda de lugares requiere validar la cobertura provincial.",
    );
  let cached = indexCache.get(roads);
  if (!cached || cached.places !== places) {
    cached = { places, entries: buildLocalPlaceIndex(roads, places, contains) };
    indexCache.set(roads, cached);
  }
  return cached.entries
    .map((entry) => ({ entry, score: rankEntry(entry, queryTokens, phrase) }))
    .filter(({ score }) => score !== null)
    .sort((a, b) => b.score - a.score || a.entry.order - b.entry.order)
    .slice(0, Math.max(0, Math.min(12, limit)))
    .map(({ entry }) => entry.place);
}

module.exports = {
  normalizePlaceName,
  significantTokens,
  validCoordinates,
  loadLocalPlaces,
  buildLocalPlaceIndex,
  searchLocalPlaces,
};
