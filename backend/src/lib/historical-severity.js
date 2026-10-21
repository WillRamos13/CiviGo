"use strict";

// This is a versioned presentation rubric, not a legal classification or a
// determination of truth, current danger, weapons, injuries or human review.
const METHOD = "MODALIDAD_HISTORICA_V1";
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
module.exports = { METHOD, assessHistoricalSeverity };
