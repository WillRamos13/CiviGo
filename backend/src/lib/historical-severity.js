"use strict";

const { createHash } = require("node:crypto");

// This is a versioned presentation rubric, not a legal classification or a
// determination of truth, current danger, weapons, injuries or human review.
const METHOD = "MODALIDAD_HISTORICA_V1";
const SOURCE_PREFIX = "MININTER / PNP - SIDPOL;";
const REFERENCE_PREFIX = "MININTER:ogc-denuncias:id_dgc:";
const RULES = [
  [
    2,
    "Afectación patrimonial sin violencia indicada en la modalidad",
    [
      "HURTO",
      "HURTO DE CELULAR",
      "HURTO DE USO",
      "HURTO DE ACCESORIOS Y AUTOPARTES DE VEHICULOS",
    ],
  ],
  [
    3,
    "Afectación patrimonial agravada o de vehículo, sin violencia indicada",
    [
      "HURTO AGRAVADO",
      "HURTO AGRAVADO EN CASA HABITADA",
      "HURTO AGRAVADO DURANTE LA NOCHE",
      "HURTO DE VEHICULO",
    ],
  ],
  [
    3,
    "Robo o tentativa; no constan armas ni lesiones en la modalidad",
    ["ROBO", "ROBO DE CELULAR", "TENTATIVA DE ROBO", "ROBO FRUSTRADO"],
  ],
  [
    3,
    "Chantaje; no consta amenaza física específica en la modalidad",
    ["CHANTAJE"],
  ],
  [
    4,
    "Robo con agravante explícita; no se deducen armas ni lesiones",
    [
      "ROBO AGRAVADO",
      "ROBO AGRAVADO EN BANDA",
      "ROBO AGRAVADO DURANTE LA NOCHE O EN LUGAR DESOLADO",
      "ASALTO Y ROBO DE VEHICULOS",
    ],
  ],
  [
    4,
    "Coacción o amenaza grave indicada en la modalidad",
    ["EXTORSION", "EXTORSION AGRAVADA", "AMENAZA GRAVE"],
  ],
  [
    4,
    "Desaparición registrada; el estado actual de la búsqueda es desconocido",
    ["PERSONA DESAPARECIDA"],
  ],
  [
    5,
    "Uso de arma expresamente indicado en la modalidad",
    ["ROBO AGRAVADO A MANO ARMADA"],
  ],
  [
    5,
    "Desaparición de menor expresamente indicada; no implica búsqueda activa hoy",
    ["MENOR DESAPARECIDO"],
  ],
];
const normalize = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
const rubric = new Map(
  RULES.flatMap(([nivel, criterio, names]) =>
    names.map((name) => [name, { nivel, criterio }]),
  ),
);

function assessHistoricalSeverity(description) {
  // Read only the published modality. Address names and explanatory caveats
  // must never escalate the score (e.g. a street named "Armas").
  const match =
    typeof description === "string" &&
    description.match(/Modalidad publicada:\s*(.*?)\.\s*Distrito del hecho/iu);
  if (!match)
    throw new Error(
      "El histórico no tiene una modalidad publicada identificable.",
    );
  const modalidad = normalize(match[1]);
  const rule = rubric.get(modalidad);
  if (!rule)
    throw new Error(
      "La modalidad requiere un criterio explícito antes de asignar gravedad.",
    );
  return { ...rule, modalidad, metodo: METHOD, revisionHumana: false };
}
function isOfficialHistoricalIncident(incident) {
  return (
    incident.historico === true &&
    typeof incident.fuente === "string" &&
    incident.fuente.startsWith(SOURCE_PREFIX)
  );
}

function needsPreliminaryHistoricalSeverity(incident) {
  return (
    isOfficialHistoricalIncident(incident) &&
    incident.evaluacion === "PENDIENTE" &&
    incident.totalReportes === 0 &&
    Number.isInteger(incident.nivelRiesgo) &&
    incident.nivelRiesgo >= 1 &&
    incident.nivelRiesgo <= 5
  );
}

function usesPreliminaryHistoricalSeverity(incident) {
  return (
    needsPreliminaryHistoricalSeverity(incident) &&
    incident.gravedadHistoricaMetodo === METHOD
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function withPreliminaryHistoricalSeverity(db, incidents) {
  const candidates = incidents.filter(needsPreliminaryHistoricalSeverity);
  if (!candidates.length) return incidents;
  const ids = JSON.stringify(candidates.map(({ id }) => id));
  // The import ledger already stores the method and checksum. Select only the
  // relevant rows and fields, in one query even for a full map page.
  const ledger = await db.$queryRaw`
    SELECT clave, valor->'incidenteId' AS id,
      valor->>'referencia' AS referencia,
      valor#>>'{procedencia,idDgc}' AS "idDgc",
      valor->'gravedadPreliminar' AS gravedad
    FROM "AppConfig"
    WHERE clave LIKE 'historical:%'
      AND valor->'incidenteId' IN (
        SELECT value FROM jsonb_array_elements(${ids}::jsonb)
      )
  `;
  const registered = new Map();
  for (const { clave, id, referencia, idDgc, gravedad } of ledger) {
    if (
      !/^\d+$/.test(idDgc ?? "") ||
      referencia !== REFERENCE_PREFIX + idDgc ||
      clave !== "historical:" + sha256("MININTER:ogc-denuncias\n" + referencia)
    )
      continue;
    registered.set(id, registered.has(id) ? null : gravedad);
  }
  const eligible = new Set(
    candidates
      .filter((incident) => {
        const assessment = registered.get(incident.id);
        return (
          assessment?.metodo === METHOD &&
          assessment.revisionHumana === false &&
          assessment.nivel === incident.nivelRiesgo &&
          assessment.descripcionSHA256 === sha256(incident.descripcion)
        );
      })
      .map(({ id }) => id),
  );
  return incidents.map((incident) =>
    eligible.has(incident.id)
      ? { ...incident, gravedadHistoricaMetodo: METHOD }
      : incident,
  );
}

module.exports = {
  METHOD,
  assessHistoricalSeverity,
  isOfficialHistoricalIncident,
  usesPreliminaryHistoricalSeverity,
  withPreliminaryHistoricalSeverity,
};
