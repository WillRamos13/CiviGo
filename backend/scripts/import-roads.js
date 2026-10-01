"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const QUERY =
  '[out:json][timeout:90];relation["boundary"="administrative"]["admin_level"="6"]["name"="Ica"];map_to_area->.province;(way(area.province)["highway"];relation(area.province)["boundary"="administrative"]["admin_level"="8"];relation["boundary"="administrative"]["admin_level"="6"]["name"="Ica"];);out body;>;out skel qt;';

async function importRoads({
  endpoint = process.env.OVERPASS_URL ||
    "https://overpass-api.de/api/interpreter",
  destination = path.join(__dirname, "../data/ica-roads.json"),
} = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "CiviGoAcademicPilot/1.0",
    },
    body: new URLSearchParams({ data: QUERY }),
    signal: AbortSignal.timeout(115000),
  });
  if (!response.ok)
    throw new Error(`El proveedor de red vial respondió ${response.status}.`);
  const json = await response.json();
  if (
    !Array.isArray(json.elements) ||
    !json.elements.some(
      (element) => element.type === "way" && element.tags?.highway,
    )
  )
    throw new Error(
      "La respuesta no contiene una red vial utilizable de la provincia de Ica.",
    );
  const document = {
    fuente: "OpenStreetMap via Overpass API",
    atribucion: "© OpenStreetMap contributors",
    licencia: "ODbL 1.0",
    actualizadoEn: new Date().toISOString(),
    query: QUERY,
    elements: json.elements,
  };
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(document), "utf8");
  return {
    elementos: json.elements.length,
    vias: json.elements.filter(
      (element) => element.type === "way" && element.tags?.highway,
    ).length,
  };
}

if (require.main === module)
  importRoads()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { importRoads, QUERY };
