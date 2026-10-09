"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { getRoads, inProvince, districtFor } = require("../src/lib/roads");
const {
  validCoordinates,
  normalizePlaceName,
} = require("../src/lib/local-places");
const { distanceMeters } = require("../src/lib/risk");

const QUERY =
  '[out:json][timeout:90];relation["boundary"="administrative"]["admin_level"="6"]["name"="Ica"];map_to_area->.province;(nwr(area.province)["name"]["amenity"];nwr(area.province)["name"]["shop"];nwr(area.province)["name"]["tourism"];nwr(area.province)["name"]["leisure"];nwr(area.province)["name"]["historic"];nwr(area.province)["name"]["public_transport"];nwr(area.province)["name"]["railway"];nwr(area.province)["name"]["aeroway"];nwr(area.province)["name"]["healthcare"];nwr(area.province)["name"]["office"];nwr(area.province)["name"]["place"];nwr(area.province)["name"]["natural"="water"];nwr(area.province)["name"]["natural"="oasis"];nwr(area.province)["name"]["natural"="peak"];);out center tags;';

function createPlacesCatalog(
  data,
  {
    roads = getRoads(),
    updatedAt = new Date().toISOString(),
    query = QUERY,
  } = {},
) {
  if (!Array.isArray(data?.elements))
    throw new Error(
      "La respuesta de lugares no contiene elementos OSM válidos.",
    );
  const places = [];
  const names = new Map();
  for (const element of data.elements) {
    if (
      !["node", "way", "relation"].includes(element?.type) ||
      !Number.isSafeInteger(element.id)
    )
      continue;
    const tags = element.tags || {};
    const nombre = typeof tags.name === "string" ? tags.name.trim() : "";
    const point = {
      latitud: element.type === "node" ? element.lat : element.center?.lat,
      longitud: element.type === "node" ? element.lon : element.center?.lon,
    };
    if (!nombre || !validCoordinates(point) || !inProvince(point, roads))
      continue;
    const key = normalizePlaceName(nombre);
    if (
      (names.get(key) || []).some(
        (existing) => distanceMeters(point, existing) <= 35,
      )
    )
      continue;
    const district = districtFor(point, roads);
    const address = [tags["addr:street"], tags["addr:housenumber"]]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ");
    const description = [...new Set([address, district].filter(Boolean))].join(
      " · ",
    );
    const place = {
      nombre,
      ...point,
      ...(description ? { descripcion: description } : {}),
      fuente: "OpenStreetMap",
      osmId: `${element.type}/${element.id}`,
    };
    places.push(place);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(place);
  }
  if (!places.length)
    throw new Error(
      "La respuesta no contiene lugares dentro de la provincia de Ica; se conserva el catálogo anterior.",
    );
  return {
    fuente: "OpenStreetMap via Overpass API",
    atribucion: "© OpenStreetMap contributors",
    licencia: "ODbL 1.0",
    actualizadoEn: updatedAt,
    query,
    places,
  };
}

async function importPlaces({
  endpoint = process.env.OVERPASS_URL ||
    "https://overpass-api.de/api/interpreter",
  destination = path.join(__dirname, "../data/ica-places.json"),
  roads = getRoads(),
} = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "CiviGo/1.0 (place catalog import)",
    },
    body: new URLSearchParams({ data: QUERY }),
    signal: AbortSignal.timeout(115000),
  });
  if (!response.ok)
    throw new Error(
      `El proveedor de lugares respondió ${response.status}; se conserva el catálogo anterior.`,
    );
  const document = createPlacesCatalog(await response.json(), { roads });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(document), "utf8");
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return {
    lugares: document.places.length,
    actualizadoEn: document.actualizadoEn,
  };
}

if (require.main === module)
  importPlaces()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });

module.exports = { QUERY, createPlacesCatalog, importPlaces };
