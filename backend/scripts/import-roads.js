"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { parseRoads } = require("../src/lib/roads");

const QUERY =
  '[out:json][timeout:90];relation["boundary"="administrative"]["admin_level"="6"]["name"="Ica"];map_to_area->.province;(way(area.province)["highway"];relation(area.province)["type"~"^restriction(:|$)"];relation(area.province)["boundary"="administrative"]["admin_level"="8"];relation["boundary"="administrative"]["admin_level"="6"]["name"="Ica"];);(._;>>;);out body qt;';

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
    json.remark ||
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
  const parsed = parseRoads(document);
  if (!parsed.boundary.outer.length || !parsed.segments.length)
    throw new Error(
      "La descarga no contiene los límites y nodos de la red vial completa. Se conserva el archivo anterior.",
    );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(document), "utf8");
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return {
    elementos: json.elements.length,
    vias: json.elements.filter(
      (element) => element.type === "way" && element.tags?.highway,
    ).length,
    restricciones: parsed.restrictions.length,
    nodosConEtiquetas: parsed.nodeTags.size,
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
