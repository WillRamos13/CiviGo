export type IncidentPresentation = {
  category: string;
  categoryName: string;
  subcategory: string;
  color: string;
  description: string;
};
const groups = {
  security: ["seguridad", "Seguridad ciudadana", "#4b9fff"],
  emergency: ["emergencias", "Emergencias y desastres", "#ed6d6d"],
  traffic: ["transito", "Tránsito y movilidad", "#f2b448"],
  infrastructure: ["infraestructura", "Infraestructura y servicios", "#66bdde"],
  environment: ["convivencia", "Convivencia y entorno", "#74bc9a"],
  search: ["busqueda", "Búsqueda de personas", "#ae9ae8"],
} as const;
type Group = keyof typeof groups;
const definitions: [string, Group, string, string][] = [
  [
    "robo",
    "security",
    "Delitos",
    "Sustracción mediante violencia o amenaza. No publiques datos de las víctimas.",
  ],
  [
    "hurto",
    "security",
    "Delitos",
    "Sustracción de bienes sin violencia descrita contra la persona.",
  ],
  [
    "intento-de-robo",
    "security",
    "Delitos",
    "Intento de sustracción descrito por quien reporta.",
  ],
  [
    "amenazas",
    "security",
    "Delitos",
    "Amenazas dirigidas a una persona; las pruebas se revisan en privado.",
  ],
  [
    "extorsion",
    "security",
    "Delitos",
    "Exigencias acompañadas de amenazas o coacción; conserva las pruebas privadas.",
  ],
  [
    "persona-sospechosa",
    "security",
    "Avisos ciudadanos",
    "Describe conductas concretas observadas, sin atribuir delitos por la apariencia.",
  ],
  [
    "incendio",
    "emergency",
    "Incendios",
    "Fuego observado en una construcción, vehículo, vegetación o vía.",
  ],
  [
    "humo",
    "emergency",
    "Incendios",
    "Presencia de humo observada; no implica que se haya confirmado un incendio.",
  ],
  [
    "fuga-de-gas",
    "emergency",
    "Servicios y materiales peligrosos",
    "Indicios de una fuga de gas. Aléjate y comunícate con emergencias.",
  ],
  [
    "inundacion",
    "emergency",
    "Riesgos ambientales",
    "Agua acumulada o desbordamiento que afecta un lugar o vía.",
  ],
  [
    "derrumbe",
    "emergency",
    "Daños y obstáculos",
    "Caída de material, construcción o terreno que afecta el entorno.",
  ],
  [
    "accidente-vehicular",
    "traffic",
    "Accidentes",
    "Colisión u otro accidente de tránsito observado.",
  ],
  [
    "semaforo-danado",
    "traffic",
    "Señalización",
    "Semáforo apagado, averiado o con funcionamiento irregular.",
  ],
  [
    "calle-bloqueada",
    "traffic",
    "Obstáculos viales",
    "Obstáculo o cierre que dificulta o impide transitar.",
  ],
  [
    "bache",
    "infrastructure",
    "Calzada",
    "Deterioro localizado de la calzada. Describe su ubicación y estado.",
  ],
  [
    "mala-iluminacion",
    "infrastructure",
    "Alumbrado público",
    "Iluminación insuficiente o luminaria averiada observada.",
  ],
  [
    "basura-acumulada",
    "environment",
    "Riesgos ambientales",
    "Residuos acumulados en un espacio público.",
  ],
  [
    "pelea",
    "environment",
    "Conflictos",
    "Enfrentamiento observado entre personas. No expongas identidades.",
  ],
  [
    "disturbio",
    "environment",
    "Conflictos",
    "Alteración del orden que afecta el espacio público.",
  ],
  [
    "animal-peligroso",
    "environment",
    "Animales",
    "Conducta concreta de un animal que pone en riesgo a personas; no depende de su raza.",
  ],
  [
    "persona-desaparecida",
    "search",
    "Personas",
    "Aviso de búsqueda sujeto a revisión y protección de datos personales.",
  ],
  [
    "danos-por-sismo",
    "emergency",
    "Sismos",
    "Daños visibles tras un sismo; este registro no reemplaza una evaluación técnica.",
  ],
  [
    "cable-caido",
    "infrastructure",
    "Electricidad",
    "Cable caído o instalación eléctrica dañada. Mantén distancia.",
  ],
  [
    "fuga-de-agua",
    "infrastructure",
    "Agua y saneamiento",
    "Salida de agua por una tubería dañada o afectación del saneamiento.",
  ],
];
export const INCIDENT_PRESENTATIONS = Object.fromEntries(
  definitions.map(([id, group, subcategory, description]) => {
    const [category, categoryName, color] = groups[group];
    return [id, { category, categoryName, subcategory, description, color }];
  }),
) as Record<string, IncidentPresentation>;
export function incidentPresentation(...types: (string | undefined)[]) {
  for (const value of types) {
    const key = value
      ?.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, "-");
    if (!key) continue;
    const family = key.startsWith("hurto-")
      ? "hurto"
      : key.startsWith("extorsion-")
        ? "extorsion"
        : key.startsWith("amenaza")
          ? "amenazas"
          : key;
    if (INCIDENT_PRESENTATIONS[family]) return INCIDENT_PRESENTATIONS[family];
  }
  return null;
}
