"use strict";

// Pure preparation only. The administrative reset owns persistence and its
// transaction. These records are synthetic; provenance must be kept in Review.
const { createHash } = require("node:crypto");
const { containsRing, normalize } = require("./roads");
const { distanceMeters } = require("./risk");

const DATASET_VERSION = "ica-initial-v1";
const DISTRICT_COUNTS = Object.freeze({
  Ica: 80,
  "La Tinguiña": 40,
  "Los Aquijes": 40,
  Ocucaje: 25,
  Pachacútec: 25,
  Parcona: 40,
  "Pueblo Nuevo": 30,
  Salas: 30,
  "San José de Los Molinos": 40,
  "San Juan Bautista": 30,
  Santiago: 45,
  Subtanjalla: 30,
  Tate: 25,
  "Yauca del Rosario": 20,
});

// Descriptions contain no names, victim identities, fabricated media or claims
// that a public authority/AI verified an event. Gravity describes this scenario.
const SCENARIOS = Object.freeze({
  robo: {
    severity: [3, 4],
    facts: [
      "Se comunica la sustracción de pertenencias mediante intimidación a un peatón.",
      "Se describe el arrebato de un bolso con amenaza al pasar por el tramo.",
      "Se informa de un robo de objetos personales a una persona que caminaba por la zona.",
    ],
    details: [
      "El punto corresponde al lugar señalado para el hecho, sin publicar datos de la persona afectada.",
      "La descripción se limita al hecho y a su ubicación; no incluye identidades ni domicilios.",
    ],
  },
  hurto: {
    severity: [2, 3],
    facts: [
      "Se informa de la sustracción de una mochila dejada momentáneamente sin vigilancia.",
      "Se comunica la pérdida de objetos de un vehículo estacionado, sin violencia descrita.",
      "Se describe la sustracción de pertenencias durante el paso por un espacio concurrido.",
    ],
    details: [
      "La ubicación señala el tramo del hecho y no identifica al propietario.",
      "No se describen lesiones ni una amenaza física en este aporte.",
    ],
  },
  "intento-de-robo": {
    severity: [3, 4],
    facts: [
      "Se describe un intento de quitar pertenencias a un peatón que pudo alejarse.",
      "Se comunica una tentativa de arrebato de un bolso sin consumarse la sustracción.",
      "Se informa de un intento de robo durante el tránsito de una persona por la vía.",
    ],
    details: [
      "No se publican datos personales ni características que permitan identificar a terceros.",
      "El punto señalado corresponde al tramo donde se describe el intento.",
    ],
  },
  amenazas: {
    severity: [3, 4],
    facts: [
      "Se comunica una amenaza verbal dirigida a una persona durante una discusión en la vía.",
      "Se describe una intimidación reiterada a un peatón en este tramo.",
      "Se informa de amenazas durante un encuentro en el espacio público.",
    ],
    details: [
      "La descripción omite nombres y otros datos personales de las personas implicadas.",
      "No se aportan identidades ni detalles privados de la persona afectada.",
    ],
  },
  extorsion: {
    severity: [4, 5],
    facts: [
      "Se comunica una exigencia de dinero acompañada de intimidación en el lugar señalado.",
      "Se describe una solicitud de pago mediante amenaza a una persona de la zona.",
      "Se informa de una presión para entregar dinero con una amenaza asociada.",
    ],
    details: [
      "No se muestran teléfonos, mensajes privados ni identidades de las personas afectadas.",
      "La ubicación es la referencia aportada para el hecho; se omiten datos privados.",
    ],
  },
  "persona-sospechosa": {
    severity: [1, 2],
    facts: [
      "Se describe que una persona intenta abrir repetidamente puertas de vehículos estacionados.",
      "Se comunica que una persona prueba las manijas de varios vehículos en el tramo.",
      "Se informa de intentos reiterados de abrir accesos cerrados desde la vía pública.",
    ],
    details: [
      "Se describe una conducta concreta, sin atribuir un delito ni identificar a la persona por su apariencia.",
      "El aporte no publica fotografías de rostros, nombres ni una acusación de delito consumado.",
    ],
  },
  incendio: {
    severity: [4, 5],
    facts: [
      "Se describen llamas y humo en material acumulado junto al borde de la vía.",
      "Se informa de fuego en vegetación seca al costado del tramo.",
      "Se comunica un foco de fuego junto al camino, con humo que reduce la visibilidad.",
    ],
    details: [
      "El escenario contempla mantener distancia del fuego y dejar libre el acceso a emergencias.",
      "La afectación descrita se concentra en el punto marcado y el margen de la vía.",
    ],
  },
  humo: {
    severity: [2, 3],
    facts: [
      "Se comunica una columna de humo que cruza parcialmente la calzada.",
      "Se describe humo denso procedente del margen de la vía, sin llamas visibles.",
      "Se informa de humo que dificulta ver el siguiente tramo del camino.",
    ],
    details: [
      "No se identifica la causa del humo ni se atribuye responsabilidad a un establecimiento.",
      "La descripción señala la reducción de visibilidad, sin confirmar el origen.",
    ],
  },
  "fuga-de-gas": {
    severity: [4, 5],
    facts: [
      "Se describe un olor intenso a gas cerca de una conexión situada junto a la vía.",
      "Se comunica un silbido y olor a gas en una conexión próxima al punto marcado.",
      "Se informa de una posible pérdida de gas percibida desde el espacio público.",
    ],
    details: [
      "No se indica que la instalación haya sido inspeccionada por técnicos.",
      "La situación descrita requiere distancia de la fuente y revisión por personal competente.",
    ],
  },
  inundacion: {
    severity: [2, 3, 4],
    facts: [
      "Se describe agua acumulada que ocupa parte de la calzada y oculta su superficie.",
      "Se informa de agua que cruza la vía y dificulta el paso de peatones y vehículos.",
      "Se comunica un anegamiento en el borde del camino con paso reducido.",
    ],
    details: [
      "El punto marcado corresponde al tramo afectado; no se declara la causa del desborde.",
      "La descripción contempla circular con precaución y evitar atravesar agua de profundidad desconocida.",
    ],
  },
  derrumbe: {
    severity: [3, 4],
    facts: [
      "Se describe material de tierra y piedras que ocupa parte del camino.",
      "Se comunica un desprendimiento de material junto a la vía con paso parcialmente obstruido.",
      "Se informa de piedras y tierra desplazadas hacia la calzada.",
    ],
    details: [
      "El escenario se limita al tramo señalado, sin atribuir daños a viviendas.",
      "La acumulación descrita obliga a reducir la velocidad y conservar distancia del borde afectado.",
    ],
  },
  "accidente-vehicular": {
    severity: [3, 4],
    facts: [
      "Se describe una colisión entre dos vehículos que ocupa parcialmente un carril.",
      "Se comunica un vehículo detenido tras un choque con restos sobre la calzada.",
      "Se informa de una colisión que reduce el espacio disponible para circular.",
    ],
    details: [
      "No se dispone de información sobre lesiones ni se identifica a los conductores.",
      "La descripción no determina responsabilidades y mantiene libre el acceso a asistencia.",
    ],
  },
  "semaforo-danado": {
    severity: [2, 3],
    facts: [
      "Se describe un semáforo sin iluminación en el cruce señalado.",
      "Se comunica que las señales luminosas de un semáforo permanecen apagadas.",
      "Se informa de un semáforo con señal intermitente que dificulta interpretar la prioridad del cruce.",
    ],
    details: [
      "El escenario corresponde a un nodo con semáforo registrado en la cartografía local.",
      "La situación descrita requiere precaución al atravesar el cruce.",
    ],
  },
  "calle-bloqueada": {
    severity: [2, 3],
    facts: [
      "Se describe una acumulación de materiales que bloquea parte del paso por la vía.",
      "Se comunica una barrera temporal que impide continuar por el tramo señalado.",
      "Se informa de objetos de gran tamaño que reducen el paso disponible en la calzada.",
    ],
    details: [
      "No se atribuye el bloqueo a una entidad o persona concreta.",
      "La descripción señala la obstrucción y la necesidad de buscar un acceso alternativo.",
    ],
  },
  bache: {
    severity: [1, 2, 3],
    facts: [
      "Se describe un bache con bordes irregulares en la zona de circulación.",
      "Se comunica una depresión de la superficie vial que obliga a esquivarla al pasar.",
      "Se informa de un hueco en la calzada que afecta el tránsito de bicicletas y vehículos.",
    ],
    details: [
      "El defecto señalado afecta un sector del carril y no toda la extensión de la vía.",
      "El punto permite localizar el deterioro para su revisión y reparación.",
    ],
  },
  "mala-iluminacion": {
    severity: [1, 2, 3],
    facts: [
      "Se describe un tramo con luminarias apagadas que dificulta ver la acera de noche.",
      "Se comunica iluminación insuficiente en el sector peatonal junto a la vía.",
      "Se informa de varios puntos sin luz en un tramo usado por peatones.",
    ],
    details: [
      "La descripción se refiere a la visibilidad nocturna y no confirma que hayan ocurrido delitos.",
      "El escenario señala el tramo a revisar sin atribuir una causa a la falta de luz.",
    ],
  },
  pelea: {
    severity: [2, 3],
    facts: [
      "Se describe una confrontación física entre personas en el espacio público.",
      "Se comunica una discusión que pasa a empujones y ocupa parte de la vía.",
      "Se informa de una pelea que dificulta el paso por el sector señalado.",
    ],
    details: [
      "No se identifican personas ni se difunden imágenes de rostros.",
      "El aporte no atribuye responsabilidades ni confirma lesiones.",
    ],
  },
  disturbio: {
    severity: [3, 4],
    facts: [
      "Se describe una alteración del orden con objetos lanzados hacia la vía.",
      "Se comunica un grupo que bloquea el paso durante una confrontación en el espacio público.",
      "Se informa de desorden y desplazamiento de objetos que afectan la circulación.",
    ],
    details: [
      "No se relaciona la situación con una organización o colectivo identificado.",
      "La descripción se limita a las conductas y al tramo afectado.",
    ],
  },
  "basura-acumulada": {
    severity: [1, 2],
    facts: [
      "Se describe acumulación de residuos en el margen de la vía que invade el paso peatonal.",
      "Se comunica un conjunto de bolsas y desperdicios junto al camino.",
      "Se informa de residuos dispersos que dificultan caminar por el borde del tramo.",
    ],
    details: [
      "El punto señala el sector que necesita limpieza, sin atribuir el depósito a personas concretas.",
      "La acumulación descrita corresponde al espacio público y no identifica inmuebles privados.",
    ],
  },
  "animal-peligroso": {
    severity: [2, 3],
    facts: [
      "Se describe un perro que persigue a peatones en el tramo señalado.",
      "Se comunica un animal que intenta morder a personas que pasan por la vía.",
      "Se informa de un perro que bloquea el paso y se abalanza sobre quienes se aproximan.",
    ],
    details: [
      "La descripción se basa en una conducta y no en la raza del animal.",
      "No se identifica un propietario ni se afirma que haya habido una persona herida.",
    ],
  },
  "persona-desaparecida": {
    severity: [3, 4],
    facts: [
      "Se comunica la pérdida de contacto con una persona cuyo último punto de referencia es este tramo.",
      "Se describe una búsqueda de una persona con último lugar conocido en la zona marcada.",
      "Se informa de una persona no localizada y se señala este sector como referencia inicial.",
    ],
    details: [
      "No se difunden nombres, imágenes o datos privados de la persona buscada.",
      "La descripción no sustituye una denuncia ni identifica a la persona buscada.",
    ],
  },
  otro: {
    severity: [1, 2],
    facts: [
      "Se describe una tapa de registro desplazada que deja una abertura junto al paso peatonal.",
      "Se comunica un elemento metálico sobresaliente en el margen de la vía.",
      "Se informa de objetos cortantes dispersos que requieren retirar el material del paso.",
    ],
    details: [
      "El punto permite localizar el obstáculo sin señalar responsables.",
      "La descripción identifica un peligro concreto para quienes pasan por el tramo.",
    ],
  },
});

const RURAL_TYPES = new Set([
  "incendio",
  "humo",
  "inundacion",
  "derrumbe",
  "accidente-vehicular",
  "calle-bloqueada",
  "bache",
  "basura-acumulada",
  "animal-peligroso",
  "otro",
]);
const RURAL_HIGHWAYS = new Set(["track", "path", "unclassified"]);
const EXCLUDED_HIGHWAYS = new Set([
  "proposed",
  "construction",
  "raceway",
  "steps",
  "corridor",
  "rest_area",
]);
const candidateCache = new WeakMap();

function hash(value) {
  return createHash("sha256").update(String(value)).digest().readUInt32BE(0);
}

function ringIndex(rings) {
  return (rings || [])
    .filter((ring) => Array.isArray(ring) && ring.length >= 4)
    .map((ring) => ({
      ring,
      minX: Math.min(...ring.map((p) => p[0])),
      maxX: Math.max(...ring.map((p) => p[0])),
      minY: Math.min(...ring.map((p) => p[1])),
      maxY: Math.max(...ring.map((p) => p[1])),
    }));
}

function containsIndexed(point, indexed) {
  return indexed.some(
    (r) =>
      point[0] >= r.minX &&
      point[0] <= r.maxX &&
      point[1] >= r.minY &&
      point[1] <= r.maxY &&
      containsRing(point, r.ring),
  );
}

function midpointOnSegment(coordinates) {
  const lengths = [];
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const length = distanceMeters(coordinates[i - 1], coordinates[i]);
    if (!Number.isFinite(length)) return null;
    lengths.push(length);
    total += length;
  }
  if (total < 0.5) return null;
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const a = coordinates[i],
        b = coordinates[i + 1],
        ratio = remaining / lengths[i];
      return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
    }
    remaining -= lengths[i];
  }
  return coordinates.at(-1).slice();
}

function prepareCandidates(roads) {
  if (
    !roads ||
    !Array.isArray(roads.segments) ||
    !Array.isArray(roads.districts)
  )
    throw new Error(
      "Se requiere una red vial con límites provinciales y distritales.",
    );
  if (candidateCache.has(roads)) return candidateCache.get(roads);
  const outer = ringIndex(roads.boundary?.outer),
    inner = ringIndex(roads.boundary?.inner);
  if (!outer.length)
    throw new Error(
      "No hay un polígono provincial válido para preparar la carga.",
    );
  const districts = Object.keys(DISTRICT_COUNTS).map((name) => {
    const boundary = roads.districts.find(
      (d) => normalize(d.nombre) === normalize(name),
    );
    const indexed = ringIndex(boundary?.outer);
    if (!indexed.length)
      throw new Error(
        "No hay límites cartográficos para el distrito " + name + ".",
      );
    return {
      name,
      outer: indexed,
      inner: ringIndex(boundary.inner),
      candidates: [],
      signals: [],
    };
  });
  const seen = new Set();
  const add = (point, segment, signal = false) => {
    if (
      !point ||
      point.some((value) => !Number.isFinite(value)) ||
      !containsIndexed(point, outer) ||
      containsIndexed(point, inner)
    )
      return;
    const district = districts.find(
      (d) =>
        containsIndexed(point, d.outer) && !containsIndexed(point, d.inner),
    );
    if (!district) return;
    const key = point.map((n) => n.toFixed(8)).join(":");
    // Keep original interpolation precision: rounding a border point can move it
    // outside the province. The key only deduplicates coincident candidates.
    const candidate = {
      point: point.slice(),
      key,
      segmentId: String(segment.id),
      osmWayId: segment.osmId ?? null,
      nombreVia: String(segment.tags?.name || "").trim(),
      rural: RURAL_HIGHWAYS.has(segment.tags?.highway),
      signal,
    };
    if (signal) district.signals.push(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    district.candidates.push(candidate);
  };
  for (const segment of roads.segments) {
    if (
      !Array.isArray(segment.coordinates) ||
      segment.coordinates.length < 2 ||
      EXCLUDED_HIGHWAYS.has(segment.tags?.highway) ||
      segment.tags?.access === "private" ||
      segment.tags?.access === "no"
    )
      continue;
    add(midpointOnSegment(segment.coordinates), segment);
    for (const [node, point] of [
      [segment.start, segment.coordinates[0]],
      [segment.end, segment.coordinates.at(-1)],
    ]) {
      if (roads.nodeTags?.get(String(node))?.highway === "traffic_signals")
        add(point, segment, true);
    }
  }
  for (const district of districts) {
    if (!district.candidates.length)
      throw new Error(
        "No hay puntos viales válidos dentro de " + district.name + ".",
      );
    // Limit densely repeated OSM segments per small cell before spread sampling.
    // This keeps runtime bounded and prevents thousands of incidents at junctions.
    const cells = new Map();
    for (const candidate of district.candidates) {
      const cell = [
        Math.floor(candidate.point[0] / 0.001),
        Math.floor(candidate.point[1] / 0.001),
        candidate.rural ? "r" : "u",
      ].join(":");
      const bucket = cells.get(cell) || [];
      if (bucket.length < 3) bucket.push(candidate);
      cells.set(cell, bucket);
    }
    district.candidates = [...cells.values()].flat();
    district.signals = [
      ...new Map(district.signals.map((point) => [point.key, point])).values(),
    ];
  }
  candidateCache.set(roads, districts);
  return districts;
}

function spreadPoints(candidates, count, seed, used) {
  const available = candidates
    .filter((point) => !used.has(point.key))
    .map((point) => ({
      point,
      nearest: Infinity,
      tie: hash(seed + ":" + point.key),
    }));
  if (available.length < count)
    throw new Error(
      "La red vial no contiene suficientes ubicaciones distintas para la carga.",
    );
  const selected = [];
  let next = available.reduce(
    (best, entry) => (!best || entry.tie < best.tie ? entry : best),
    null,
  );
  for (let index = 0; index < count; index++) {
    const chosen = next.point;
    selected.push(chosen);
    used.add(chosen.key);
    next = null;
    for (const entry of available) {
      if (used.has(entry.point.key)) continue;
      const x =
          (entry.point.point[0] - chosen.point[0]) *
          Math.cos((chosen.point[1] * Math.PI) / 180),
        y = entry.point.point[1] - chosen.point[1];
      entry.nearest = Math.min(entry.nearest, x * x + y * y);
      if (
        !next ||
        entry.nearest > next.nearest ||
        (entry.nearest === next.nearest && entry.tie < next.tie)
      )
        next = entry;
    }
  }
  return selected;
}

function districtQuotas(count) {
  const quotas = Object.entries(DISTRICT_COUNTS).map(([distrito, weight]) => ({
    distrito,
    count: Math.max(1, Math.floor((count * weight) / 500)),
    remainder: ((count * weight) / 500) % 1,
  }));
  while (quotas.reduce((sum, q) => sum + q.count, 0) < count) {
    for (const q of quotas.slice().sort((a, b) => b.remainder - a.remainder)) {
      if (quotas.reduce((sum, row) => sum + row.count, 0) >= count) break;
      q.count++;
    }
  }
  while (quotas.reduce((sum, q) => sum + q.count, 0) > count) {
    const q = quotas
      .filter((row) => row.count > 1)
      .sort((a, b) => b.count - a.count)[0];
    q.count--;
  }
  return quotas;
}

function buildDatasetEntries({
  selected,
  orderedTypes,
  ruralTypes,
  districts,
  used,
  timestamp,
  count,
  seed,
  authorIds,
  reviewerId,
  roads,
  eligiblePoint = () => true,
}) {
  let urbanCursor = 0,
    ruralCursor = 0;
  const entries = selected.map((point, index) => {
    const typePool =
      point.rural && ruralTypes.length ? ruralTypes : orderedTypes;
    let type =
      typePool[(point.rural ? ruralCursor++ : urbanCursor++) % typePool.length];
    if (type.slug === "semaforo-danado") {
      // A traffic-light incident must use a mapped traffic-light node, rather
      // than invent a signal on a random residential/rural road.
      const signal = districts
        .find((district) => district.name === point.distrito)
        .signals.find(
          (candidate) =>
            !used.has(candidate.key) && eligiblePoint(candidate.point),
        );
      if (signal) {
        used.delete(point.key);
        used.add(signal.key);
        point = { ...signal, distrito: point.distrito };
      } else
        type =
          typePool.find((candidate) => candidate.slug === "bache") ||
          typePool.find((candidate) => candidate.slug !== "semaforo-danado");
      if (!type)
        throw new Error(
          "No hay semáforos cartográficos para el único tipo disponible.",
        );
    }
    const scenario = SCENARIOS[type.slug],
      variation = hash(seed + ":scenario:" + index);
    const location = point.nombreVia
      ? `En ${point.nombreVia}, distrito de ${point.distrito}.`
      : `En una vía ${point.rural ? "de acceso local" : "del sector urbano"} del distrito de ${point.distrito}, en el punto marcado.`;
    const descripcion = [
      location,
      scenario.facts[variation % scenario.facts.length],
      scenario.details[Math.floor(variation / 7) % scenario.details.length],
    ].join(" ");
    const nivelRiesgo =
      scenario.severity[Math.floor(variation / 11) % scenario.severity.length];
    const fechaCreacion = new Date(
      timestamp.getTime() - (count - index) * 7000,
    );
    const fechaEvento = new Date(
      fechaCreacion.getTime() - (5 + (variation % 95)) * 60000,
    );
    const common = {
      tipo: type.nombre,
      tipoId: type.id,
      descripcion,
      latitud: point.point[1],
      longitud: point.point[0],
      nivelRiesgo,
      estado: "VALIDADO",
      fechaEvento,
      fechaCreacion,
    };
    const provenance = {
      origin: "CARGA_INICIAL",
      synthetic: true,
      version: DATASET_VERSION,
      seed,
      ordinal: index + 1,
      distrito: point.distrito,
      osmWayId: point.osmWayId,
      segmentId: point.segmentId,
      mappedTrafficSignal: point.signal,
      geographySource: roads.fuente || "OpenStreetMap",
      geographyUpdatedAt: roads.actualizadoEn || null,
      mediaProvided: false,
      aiReviewed: false,
      independentCitizenConfirmations: 0,
    };
    return {
      incident: {
        ...common,
        distrito: point.distrito,
        totalReportes: 1,
        validacion: 1,
        publicado: true,
        evaluacion: "AGENTE",
        individual: type.individual === true,
        historico: type.historico === true,
        emergencia: type.emergencia === true,
        persistente: type.persistente === true,
        fuente: "CARGA_INICIAL",
        fechaPublicacion: fechaCreacion,
      },
      report: {
        ...common,
        usuarioId: authorIds[index % authorIds.length],
        confirmaciones: 0,
      },
      review: {
        usuarioId: reviewerId,
        accion: "CARGA_INICIAL",
        motivo:
          "Escenario ficticio de carga inicial preparado por administración. El estado validado corresponde a esta carga; no implica revisión de pruebas, IA o confirmaciones ciudadanas del hecho.",
        datos: provenance,
        creadoEn: timestamp,
      },
      provenance,
    };
  });
  return entries;
}

function buildInitialIncidentDataset({
  types,
  authorIds,
  reviewerId,
  roads,
  now,
  count = 500,
  seed = DATASET_VERSION,
} = {}) {
  if (!Number.isInteger(count) || count < 14 || count > 2000)
    throw new Error(
      "La carga requiere entre 14 y 2000 reportes para cubrir todos los distritos.",
    );
  if (
    !Array.isArray(authorIds) ||
    !authorIds.length ||
    authorIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(authorIds).size !== authorIds.length
  )
    throw new Error("Indica autores distintos con identificadores válidos.");
  if (!Number.isSafeInteger(reviewerId) || reviewerId <= 0)
    throw new Error("Indica el administrador responsable de la carga.");
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.getTime()))
    throw new Error("Indica la fecha válida de preparación de la carga.");
  if (typeof seed !== "string" || !seed.trim() || seed.length > 200)
    throw new Error("Indica una semilla de hasta 200 caracteres.");
  if (!Array.isArray(types))
    throw new Error("Se requiere el catálogo de tipos activos.");
  const active = types.filter(
    (type) => type.activo !== false && SCENARIOS[type.slug],
  );
  if (
    !active.length ||
    active.some(
      (type) =>
        !Number.isSafeInteger(type.id) ||
        type.id <= 0 ||
        typeof type.nombre !== "string" ||
        !type.nombre.trim(),
    ) ||
    new Set(active.map((type) => type.slug)).size !== active.length
  )
    throw new Error(
      "El catálogo no contiene tipos activos válidos y únicos para preparar la carga.",
    );
  const orderedTypes = active
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug, "en"));
  const ruralTypes = orderedTypes.filter((type) => RURAL_TYPES.has(type.slug));
  const districts = prepareCandidates(roads);
  const selected = [];
  const used = new Set();
  const quotas = districtQuotas(count);
  for (const quota of quotas) {
    const district = districts.find((d) => d.name === quota.distrito);
    const rural = district.candidates.filter((point) => point.rural),
      urban = district.candidates.filter((point) => !point.rural);
    const ruralCount = ruralTypes.length
      ? Math.min(Math.round(quota.count * 0.3), rural.length)
      : 0;
    const urbanCount = Math.min(quota.count - ruralCount, urban.length);
    const points = [
      ...spreadPoints(
        urban,
        urbanCount,
        seed + ":" + district.name + ":urban",
        used,
      ),
      ...spreadPoints(
        rural,
        Math.min(quota.count - urbanCount, rural.length),
        seed + ":" + district.name + ":rural",
        used,
      ),
    ];
    if (points.length !== quota.count)
      throw new Error(
        "Faltan ubicaciones viales distintas para el distrito " +
          district.name +
          ".",
      );
    for (const point of points)
      selected.push({ ...point, distrito: district.name });
  }
  // Interleave districts, so the latest reports are not all from the final one.
  selected.sort(
    (a, b) => hash(seed + ":order:" + a.key) - hash(seed + ":order:" + b.key),
  );
  const entries = buildDatasetEntries({
    selected,
    orderedTypes,
    ruralTypes,
    districts,
    used,
    timestamp,
    count,
    seed,
    authorIds,
    reviewerId,
    roads,
  });
  return {
    entries,
    summary: {
      version: DATASET_VERSION,
      origin: "CARGA_INICIAL",
      synthetic: true,
      totalReports: entries.length,
      totalIncidents: entries.length,
      geographySource: roads.fuente || "OpenStreetMap",
      geographyUpdatedAt: roads.actualizadoEn || null,
      geographyAttribution: roads.atribucion || null,
      geographyLicense: roads.licencia || null,
      districts: Object.fromEntries(quotas.map((q) => [q.distrito, q.count])),
      types: Object.fromEntries(
        orderedTypes.map((type) => [
          type.slug,
          entries.filter((entry) => entry.incident.tipoId === type.id).length,
        ]),
      ),
      authors: Object.fromEntries(
        authorIds.map((id) => [
          id,
          entries.filter((entry) => entry.report.usuarioId === id).length,
        ]),
      ),
      preparedAt: timestamp.toISOString(),
    },
  };
}

function buildLocalInitialIncidentDataset({
  types,
  authorIds,
  reviewerId,
  roads,
  now,
  center,
  radiusMeters = 3000,
  count = 50,
  seed = DATASET_VERSION + "-local",
  excludePoints = [],
} = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 2000)
    throw new Error("La carga local requiere entre 1 y 2000 reportes.");
  if (
    !Number.isFinite(radiusMeters) ||
    radiusMeters < 100 ||
    radiusMeters > 30000
  )
    throw new Error("Indica un radio local entre 100 y 30000 metros.");
  if (
    !center ||
    !Number.isFinite(center.latitud) ||
    !Number.isFinite(center.longitud)
  )
    throw new Error("Indica un centro geográfico válido para la carga local.");
  if (
    !Array.isArray(authorIds) ||
    !authorIds.length ||
    authorIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(authorIds).size !== authorIds.length
  )
    throw new Error("Indica autores distintos con identificadores válidos.");
  if (!Number.isSafeInteger(reviewerId) || reviewerId <= 0)
    throw new Error("Indica el administrador responsable de la carga.");
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.getTime()))
    throw new Error("Indica la fecha válida de preparación de la carga.");
  if (typeof seed !== "string" || !seed.trim() || seed.length > 200)
    throw new Error("Indica una semilla de hasta 200 caracteres.");
  if (!Array.isArray(types))
    throw new Error("Se requiere el catálogo de tipos activos.");
  const active = types.filter(
    (type) => type.activo !== false && SCENARIOS[type.slug],
  );
  if (
    !active.length ||
    active.some(
      (type) =>
        !Number.isSafeInteger(type.id) ||
        type.id <= 0 ||
        typeof type.nombre !== "string" ||
        !type.nombre.trim(),
    ) ||
    new Set(active.map((type) => type.slug)).size !== active.length
  )
    throw new Error(
      "El catálogo no contiene tipos activos válidos y únicos para preparar la carga.",
    );
  if (!Array.isArray(excludePoints))
    throw new Error("Las ubicaciones existentes deben ser una lista.");
  const excluded = excludePoints.map((point) => {
    const latitud = point?.latitud ?? point?.[1],
      longitud = point?.longitud ?? point?.[0];
    if (
      !Number.isFinite(latitud) ||
      !Number.isFinite(longitud) ||
      Math.abs(latitud) > 90 ||
      Math.abs(longitud) > 180
    )
      throw new Error(
        "Una ubicación existente contiene coordenadas inválidas.",
      );
    return [longitud, latitud];
  });
  const districts = prepareCandidates(roads);
  const centerPoint = [center.longitud, center.latitud];
  if (
    !containsIndexed(centerPoint, ringIndex(roads.boundary.outer)) ||
    containsIndexed(centerPoint, ringIndex(roads.boundary.inner))
  )
    throw new Error("El centro está fuera de la provincia de Ica.");
  const excludedCells = new Map(),
    cellSize = 0.00001;
  for (const point of excluded) {
    const key = [
      Math.floor(point[0] / cellSize),
      Math.floor(point[1] / cellSize),
    ].join(":");
    const bucket = excludedCells.get(key) || [];
    bucket.push(point);
    excludedCells.set(key, bucket);
  }
  const eligiblePoint = (point) => {
    if (distanceMeters(centerPoint, point) > radiusMeters) return false;
    const x = Math.floor(point[0] / cellSize),
      y = Math.floor(point[1] / cellSize);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        if (
          (excludedCells.get(`${x + dx}:${y + dy}`) || []).some(
            (existing) => distanceMeters(existing, point) <= 1,
          )
        )
          return false;
    return true;
  };
  // Use actual streets for this urban presentation cluster: a vehicle collision
  // should not be placed on a pedestrian path just because it is in the radius.
  const streetIds = new Set(
    roads.segments
      .filter(
        (segment) =>
          ![
            "footway",
            "pedestrian",
            "path",
            "cycleway",
            "steps",
            "corridor",
          ].includes(segment.tags?.highway),
      )
      .map((segment) => String(segment.id)),
  );
  const candidates = districts.flatMap((district) =>
    district.candidates
      .filter(
        (point) => streetIds.has(point.segmentId) && eligiblePoint(point.point),
      )
      .map((point) => ({ ...point, distrito: district.name })),
  );
  const used = new Set(
    excluded.map((point) => point.map((number) => number.toFixed(8)).join(":")),
  );
  const urban = candidates.filter((point) => !point.rural),
    rural = candidates.filter((point) => point.rural);
  const urbanCount = Math.min(count, urban.length);
  const selected = [
    ...spreadPoints(urban, urbanCount, seed + ":urban", used),
    ...spreadPoints(rural, count - urbanCount, seed + ":rural", used),
  ];
  selected.sort(
    (a, b) => hash(seed + ":order:" + a.key) - hash(seed + ":order:" + b.key),
  );
  const orderedTypes = active
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug, "en"));
  const ruralTypes = orderedTypes.filter((type) => RURAL_TYPES.has(type.slug));
  const entries = buildDatasetEntries({
    selected,
    orderedTypes,
    ruralTypes,
    districts,
    used,
    timestamp,
    count,
    seed,
    authorIds,
    reviewerId,
    roads,
    eligiblePoint,
  });
  const publicCenter = {
    latitud: center.latitud,
    longitud: center.longitud,
    ...(typeof center.nombre === "string" ? { nombre: center.nombre } : {}),
    ...(typeof center.fuente === "string" ? { fuente: center.fuente } : {}),
    ...(typeof center.osmId === "string" ? { osmId: center.osmId } : {}),
  };
  for (const entry of entries) {
    Object.assign(entry.provenance, {
      scope: "CARGA_LOCAL",
      center: publicCenter,
      radiusMeters,
      distanceToCenterMeters: distanceMeters(centerPoint, entry.incident),
      excludedExistingLocations: excluded.length,
    });
    entry.review.motivo =
      "Escenario ficticio de carga adicional preparado por administración dentro del radio solicitado. El estado validado corresponde a esta carga; no implica revisión de pruebas, IA o confirmaciones ciudadanas del hecho.";
  }
  return {
    entries,
    summary: {
      version: DATASET_VERSION,
      origin: "CARGA_INICIAL",
      scope: "CARGA_LOCAL",
      synthetic: true,
      totalReports: entries.length,
      totalIncidents: entries.length,
      center: publicCenter,
      radiusMeters,
      maximumDistanceMeters: Math.max(
        ...entries.map((entry) => entry.provenance.distanceToCenterMeters),
      ),
      excludedExistingLocations: excluded.length,
      geographySource: roads.fuente || "OpenStreetMap",
      geographyUpdatedAt: roads.actualizadoEn || null,
      geographyAttribution: roads.atribucion || null,
      geographyLicense: roads.licencia || null,
      districts: Object.fromEntries(
        Object.keys(DISTRICT_COUNTS)
          .map((district) => [
            district,
            entries.filter((entry) => entry.incident.distrito === district)
              .length,
          ])
          .filter(([, total]) => total > 0),
      ),
      types: Object.fromEntries(
        orderedTypes.map((type) => [
          type.slug,
          entries.filter((entry) => entry.incident.tipoId === type.id).length,
        ]),
      ),
      authors: Object.fromEntries(
        authorIds.map((id) => [
          id,
          entries.filter((entry) => entry.report.usuarioId === id).length,
        ]),
      ),
      preparedAt: timestamp.toISOString(),
    },
  };
}

module.exports = {
  buildInitialIncidentDataset,
  buildLocalInitialIncidentDataset,
  DISTRICT_COUNTS,
  DATASET_VERSION,
};
