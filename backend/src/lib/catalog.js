const prisma = require("./db");
const { HttpError } = require("./http");
const DISTRICTS = [
  "Ica",
  "La Tinguiña",
  "Los Aquijes",
  "Ocucaje",
  "Pachacútec",
  "Parcona",
  "Pueblo Nuevo",
  "Salas",
  "San José de Los Molinos",
  "San Juan Bautista",
  "Santiago",
  "Subtanjalla",
  "Tate",
  "Yauca del Rosario",
];
const DEFAULT_CONFIG = {
  agrupacionMetros: 50,
  agrupacionHoras: 3,
  confirmacionMetros: 50,
  confirmaciones: 3,
  resoluciones: 5,
  influenciaVecina: 0.15,
  puntosReporte: 10,
  puntosConfirmacion: 2,
  puntosPrueba: 3,
  premiosRanking: [100, 80, 60, 50, 40, 30, 20, 15, 10, 5],
  anuncioMetros: 50,
  intervaloAnuncioMetros: 150,
  duracionAnuncioSegundos: 6,
  maxVideoBytes: 15728640,
};
const CATALOG = [
  [
    "seguridad",
    "Seguridad y delitos",
    [
      ["robo", "Robo", false, true, false, true, true],
      ["hurto", "Hurto", false, true, false, true, true],
      ["intento-de-robo", "Intento de robo", false, true, false, true, true],
      ["amenazas", "Amenazas", false, true, false, true, true],
      ["extorsion", "Extorsión", false, true, false, true, true],
      [
        "persona-sospechosa",
        "Persona sospechosa",
        true,
        false,
        false,
        false,
        false,
      ],
    ],
  ],
  [
    "emergencias",
    "Emergencias y desastres",
    [
      ["incendio", "Incendio", true, false, true, false, false],
      ["humo", "Humo", false, false, true, false, false],
      ["fuga-de-gas", "Fuga de gas", true, false, true, false, false],
      ["inundacion", "Inundación", true, false, true, false, false],
      ["derrumbe", "Derrumbe", true, false, true, false, false],
    ],
  ],
  [
    "transito",
    "Tránsito y movilidad",
    [
      [
        "accidente-vehicular",
        "Accidente vehicular",
        true,
        false,
        true,
        false,
        false,
      ],
      ["semaforo-danado", "Semáforo dañado", false, false, true, false, false],
      ["calle-bloqueada", "Calle bloqueada", false, false, true, false, false],
    ],
  ],
  [
    "infraestructura",
    "Infraestructura y servicios",
    [
      ["bache", "Bache", false, false, true, false, false, true],
      [
        "mala-iluminacion",
        "Mala iluminación",
        false,
        false,
        true,
        false,
        false,
        true,
      ],
    ],
  ],
  [
    "convivencia",
    "Convivencia y entorno",
    [
      ["pelea", "Pelea", false, false, true, false, false],
      ["disturbio", "Disturbio", true, false, true, false, false],
      [
        "basura-acumulada",
        "Basura acumulada",
        false,
        false,
        true,
        false,
        false,
        true,
      ],
      [
        "animal-peligroso",
        "Animal peligroso",
        false,
        false,
        false,
        false,
        false,
      ],
    ],
  ],
  [
    "busqueda",
    "Búsqueda de personas",
    [
      [
        "persona-desaparecida",
        "Persona desaparecida",
        false,
        true,
        false,
        false,
        true,
      ],
    ],
  ],
  [
    "otros",
    "Otros",
    [["otro", "Otro incidente", false, false, true, false, false]],
  ],
];
async function seedCatalog(db = prisma) {
  let orden = 0;
  for (const [slug, nombre, tipos] of CATALOG) {
    const categoria = await db.category.upsert({
      where: { slug },
      update: {},
      create: { slug, nombre, orden: orden++ },
    });
    for (const [
      slug,
      nombre,
      emergencia,
      historico,
      fotoObligatoria,
      individual,
      ubicacionRemota,
      persistente = false,
    ] of tipos)
      await db.incidentType.upsert({
        where: { slug },
        update: {},
        create: {
          slug,
          nombre,
          categoriaId: categoria.id,
          emergencia,
          historico,
          fotoObligatoria,
          individual,
          ubicacionRemota,
          persistente,
        },
      });
  }
}
async function config(db = prisma) {
  const stored = await db.appConfig.findUnique({ where: { clave: "reglas" } });
  return { ...DEFAULT_CONFIG, ...stored?.valor };
}
function validateConfig(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!(k in DEFAULT_CONFIG))
      throw new HttpError(400, "Parámetro desconocido: " + k);
    if (k === "premiosRanking") {
      if (
        !Array.isArray(v) ||
        v.length !== 10 ||
        v.some(
          (n) =>
            typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100000,
        )
      )
        throw new HttpError(400, "Se necesitan diez premios válidos.");
      out[k] = v;
      continue;
    }
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v <= 0 ||
      v >
        (k === "maxVideoBytes"
          ? 52428800
          : k === "influenciaVecina"
            ? 1
            : 10000)
    )
      throw new HttpError(400, "Parámetro inválido: " + k);
    if (["confirmaciones", "resoluciones"].includes(k) && !Number.isInteger(v))
      throw new HttpError(400, "El número de votos debe ser entero.");
    out[k] = v;
  }
  return out;
}
module.exports = {
  DISTRICTS,
  DEFAULT_CONFIG,
  CATALOG,
  seedCatalog,
  config,
  validateConfig,
};
