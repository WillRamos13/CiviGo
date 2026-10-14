"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  buildInitialIncidentDataset,
  buildLocalInitialIncidentDataset,
  DISTRICT_COUNTS,
} = require("../src/lib/initial-incident-dataset");
const {
  parseRoads,
  inProvince,
  districtFor,
  normalize,
} = require("../src/lib/roads");
const { projectToLine, incidentRisk } = require("../src/lib/risk");

// The catalog currently imports Prisma eagerly. Evaluate its static definitions
// with inert dependencies so this pure preparation suite never initializes DB,
// reads connection credentials or invokes an external provider.
const catalogScope = { module: { exports: {} }, require: () => ({}) };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../src/lib/catalog.js"), "utf8"),
  catalogScope,
);
const types = Array.from(catalogScope.module.exports.CATALOG)
  .flatMap((category) => Array.from(category[2]))
  .map((type, index) => ({
    id: index + 1,
    slug: type[0],
    nombre: type[1],
    emergencia: type[2],
    historico: type[3],
    fotoObligatoria: type[4],
    individual: type[5],
    ubicacionRemota: type[6],
    persistente: type[7] || false,
    activo: true,
  }));
const roads = parseRoads(
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/ica-roads.json"), "utf8"),
  ),
);
const now = new Date("2026-10-13T20:00:00Z");
const options = {
  types,
  roads,
  authorIds: [11, 22, 33, 44, 55],
  reviewerId: 11,
  now,
};
const dataset = buildInitialIncidentDataset(options);

test("500 distinct report/incident pairs cover all 14 Ica districts on the real local road network", () => {
  assert.equal(dataset.entries.length, 500);
  assert.equal(
    new Set(
      dataset.entries.map(
        (entry) => `${entry.incident.longitud}:${entry.incident.latitud}`,
      ),
    ).size,
    500,
  );
  assert.deepEqual(dataset.summary.districts, DISTRICT_COUNTS);
  const bySegment = new Map(
    roads.segments.map((segment) => [String(segment.id), segment]),
  );
  const districtCounts = {};
  for (const { incident, report, provenance } of dataset.entries) {
    assert.ok(inProvince(incident, roads));
    assert.equal(
      normalize(districtFor(incident, roads)),
      normalize(incident.distrito),
    );
    const segment = bySegment.get(provenance.segmentId);
    assert.ok(
      segment,
      "The recorded source segment is present in the snapshot",
    );
    assert.ok(
      projectToLine(incident, segment.coordinates).distance < 0.001,
      "Point must remain on its source road, not random land",
    );
    assert.equal(report.latitud, incident.latitud);
    assert.equal(report.longitud, incident.longitud);
    assert.equal(report.descripcion, incident.descripcion);
    districtCounts[incident.distrito] =
      (districtCounts[incident.distrito] || 0) + 1;
  }
  assert.deepEqual(districtCounts, DISTRICT_COUNTS);
  assert.equal(
    dataset.summary.geographySource,
    "OpenStreetMap via Overpass API",
  );
  assert.equal(dataset.summary.geographyLicense, "ODbL 1.0");
});

test("validated administrative scenarios preserve provenance without fabricating votes, media or AI review", () => {
  const byType = new Map(types.map((type) => [type.id, type]));
  assert.deepEqual(dataset.summary.authors, {
    11: 100,
    22: 100,
    33: 100,
    44: 100,
    55: 100,
  });
  for (const entry of dataset.entries) {
    const type = byType.get(entry.incident.tipoId);
    assert.equal(entry.incident.tipo, type.nombre);
    assert.equal(entry.report.tipoId, type.id);
    assert.equal(entry.report.estado, "VALIDADO");
    assert.equal(entry.incident.estado, "VALIDADO");
    assert.equal(entry.incident.publicado, true);
    assert.equal(entry.incident.evaluacion, "AGENTE");
    assert.equal(entry.incident.validacion, 1);
    assert.equal(entry.incident.totalReportes, 1);
    assert.equal(entry.report.confirmaciones, 0);
    for (const flag of ["historico", "persistente", "emergencia", "individual"])
      assert.equal(entry.incident[flag], type[flag] === true);
    assert.equal(entry.incident.fuente, "CARGA_INICIAL");
    assert.equal(entry.review.accion, "CARGA_INICIAL");
    assert.equal(entry.review.usuarioId, 11);
    assert.match(entry.review.motivo, /ficticio/);
    assert.match(entry.review.motivo, /no implica revisión de pruebas, IA/);
    assert.equal(entry.review.datos, entry.provenance);
    assert.equal(entry.provenance.synthetic, true);
    assert.equal(entry.provenance.aiReviewed, false);
    assert.equal(entry.provenance.independentCitizenConfirmations, 0);
    for (const field of ["votos", "adjuntos", "imagen", "id", "incidenteId"])
      assert.equal(Object.hasOwn(entry.report, field), false);
    for (const field of ["votos", "adjuntos", "id", "revisiones"])
      assert.equal(Object.hasOwn(entry.incident, field), false);
  }
});

test("scenario severities and dates are usable by risk and lifecycle without overriding catalog flags", () => {
  for (const { incident, report } of dataset.entries) {
    assert.ok(
      Number.isInteger(incident.nivelRiesgo) &&
        incident.nivelRiesgo >= 1 &&
        incident.nivelRiesgo <= 5,
    );
    assert.ok(
      incident.fechaEvento <= incident.fechaCreacion &&
        incident.fechaCreacion <= now,
    );
    assert.equal(incident.fechaPublicacion, incident.fechaCreacion);
    assert.equal(report.fechaEvento, incident.fechaEvento);
    assert.ok(
      now - incident.fechaEvento < 3 * 3600000,
      "Fresh seed dates must not look like old or future incidents",
    );
    const risk = incidentRisk(incident, now);
    assert.equal(risk.pending, false);
    assert.equal(risk.confidence, 1);
    assert.equal(risk.points, incident.nivelRiesgo);
    // A verified administrative record is not retired merely because the
    // individual-report proof reminder reaches day 7.
    if (incident.individual)
      assert.equal(
        incidentRisk(incident, new Date(+now + 8 * 86400000)).confidence,
        1,
      );
    assert.ok(
      incident.descripcion.length >= 120 && incident.descripcion.length < 1000,
    );
    assert.ok(incident.descripcion.includes(incident.distrito));
    assert.equal(/https?:|data:|\n|@/.test(incident.descripcion), false);
  }
  const extorsion = dataset.entries.filter(
    (entry) => entry.incident.tipo === "Extorsión",
  );
  assert.ok(extorsion.length);
  assert.ok(extorsion.every((entry) => entry.incident.nivelRiesgo >= 4));
  const basura = dataset.entries.filter(
    (entry) => entry.incident.tipo === "Basura acumulada",
  );
  assert.ok(basura.every((entry) => entry.incident.nivelRiesgo <= 2));
});

test("same input produces the same manifest while changing seed changes locations", () => {
  const originalTypes = structuredClone(types),
    firstRoad = structuredClone(roads.segments[0]);
  assert.deepEqual(buildInitialIncidentDataset(options), dataset);
  const alternative = buildInitialIncidentDataset({
    ...options,
    seed: "another-initial-load",
  });
  assert.notDeepEqual(
    alternative.entries.map((entry) => [
      entry.incident.latitud,
      entry.incident.longitud,
    ]),
    dataset.entries.map((entry) => [
      entry.incident.latitud,
      entry.incident.longitud,
    ]),
  );
  assert.deepEqual(types, originalTypes);
  assert.deepEqual(roads.segments[0], firstRoad);
});

test("a smaller count still covers every district, and inactive catalog types are not inserted", () => {
  const activeTypes = types.map((type) =>
    type.slug === "robo" ? { ...type, activo: false } : type,
  );
  const smaller = buildInitialIncidentDataset({
    ...options,
    types: activeTypes,
    count: 100,
  });
  assert.equal(smaller.entries.length, 100);
  assert.equal(Object.keys(smaller.summary.districts).length, 14);
  assert.ok(
    Object.values(smaller.summary.districts).every((count) => count >= 1),
  );
  assert.equal(
    smaller.entries.some((entry) => entry.incident.tipo === "Robo"),
    false,
  );
  assert.deepEqual(smaller.summary.authors, {
    11: 20,
    22: 20,
    33: 20,
    44: 20,
    55: 20,
  });
  const minimum = buildInitialIncidentDataset({ ...options, count: 14 });
  assert.ok(
    Object.values(minimum.summary.districts).every((count) => count === 1),
  );
});

test("invalid plans fail preparation rather than producing partial or out-of-coverage records", () => {
  for (const bad of [
    { count: 13 },
    { count: 2001 },
    { count: 14.5 },
    { now: "invalid" },
    { authorIds: [] },
    { authorIds: [11, 11] },
    { authorIds: [-1] },
    { reviewerId: null },
    { seed: "" },
    { types: [] },
    { types: [{ id: 1, slug: "unsupported", nombre: "Unsupported" }] },
  ])
    assert.throws(() => buildInitialIncidentDataset({ ...options, ...bad }));
  assert.throws(
    () =>
      buildInitialIncidentDataset({
        ...options,
        roads: { ...roads, boundary: { outer: [], inner: [] } },
      }),
    /provincial/,
  );
  assert.throws(
    () =>
      buildInitialIncidentDataset({
        ...options,
        roads: { ...roads, districts: roads.districts.slice(1) },
      }),
    /distrito Ica/,
  );
  assert.throws(
    () =>
      buildInitialIncidentDataset({
        ...options,
        roads: { ...roads, segments: [] },
      }),
    /puntos viales/,
  );
});

test("traffic lights are not invented on roads when the snapshot contains no mapped signals", () => {
  const noSignals = { ...roads, nodeTags: new Map() };
  const prepared = buildInitialIncidentDataset({
    ...options,
    roads: noSignals,
    count: 100,
  });
  assert.equal(
    prepared.entries.some((entry) => entry.incident.tipo === "Semáforo dañado"),
    false,
  );
  assert.throws(
    () =>
      buildInitialIncidentDataset({
        ...options,
        roads: noSignals,
        types: types.filter((type) => type.slug === "semaforo-danado"),
        count: 14,
      }),
    /semáforos/,
  );
});

test("50 additional scenarios stay within 3 km of the exact UTP Ica place and do not reuse the provincial load", () => {
  const places = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/ica-places.json"), "utf8"),
  );
  const campuses = places.places.filter(
    (place) => place.nombre === "Universidad Tecnológica del Perú - Sede Ica",
  );
  assert.equal(
    campuses.length,
    1,
    "The campus must be an exact named POI, not a guessed center",
  );
  const center = campuses[0];
  assert.equal(center.osmId, "way/881069435");
  assert.match(center.descripcion, /Ayabaca/);
  const excludePoints = dataset.entries.map((entry) => entry.incident);
  const original = structuredClone(dataset);
  const local = buildLocalInitialIncidentDataset({
    ...options,
    authorIds: [65, 66, 67, 68, 69],
    reviewerId: 65,
    center,
    radiusMeters: 3000,
    count: 50,
    excludePoints,
    seed: "utp-ica-additional-50",
  });
  assert.equal(local.entries.length, 50);
  assert.equal(
    new Set(
      local.entries.map(
        ({ incident }) => `${incident.latitud}:${incident.longitud}`,
      ),
    ).size,
    50,
  );
  assert.equal(local.summary.excludedExistingLocations, 500);
  assert.equal(local.summary.center.nombre, center.nombre);
  assert.equal(local.summary.center.osmId, center.osmId);
  assert.equal(local.summary.radiusMeters, 3000);
  assert.ok(local.summary.maximumDistanceMeters <= 3000);
  assert.ok(
    local.summary.maximumDistanceMeters > 2000,
    "The added points should cover the requested area, not a tiny cluster",
  );
  assert.deepEqual(local.summary.authors, {
    65: 10,
    66: 10,
    67: 10,
    68: 10,
    69: 10,
  });
  const bySegment = new Map(
    roads.segments.map((segment) => [String(segment.id), segment]),
  );
  const { distanceMeters } = require("../src/lib/risk");
  for (const entry of local.entries) {
    assert.ok(distanceMeters(center, entry.incident) <= 3000);
    assert.ok(inProvince(entry.incident, roads));
    assert.equal(
      normalize(districtFor(entry.incident, roads)),
      normalize(entry.incident.distrito),
    );
    const segment = bySegment.get(entry.provenance.segmentId);
    assert.ok(segment);
    assert.ok(
      projectToLine(entry.incident, segment.coordinates).distance < 0.001,
    );
    assert.ok(
      ![
        "footway",
        "pedestrian",
        "path",
        "cycleway",
        "steps",
        "corridor",
      ].includes(segment.tags.highway),
    );
    assert.ok(
      excludePoints.every((point) => distanceMeters(point, entry.incident) > 1),
      "An existing incident within one meter must not be duplicated",
    );
    assert.equal(entry.report.estado, "VALIDADO");
    assert.equal(entry.incident.estado, "VALIDADO");
    assert.equal(entry.incident.fuente, "CARGA_INICIAL");
    assert.equal(entry.provenance.synthetic, true);
    assert.equal(entry.provenance.scope, "CARGA_LOCAL");
    assert.equal(entry.review.datos.radiusMeters, 3000);
    assert.equal(entry.review.usuarioId, 65);
    assert.equal(entry.report.confirmaciones, 0);
  }
  assert.deepEqual(
    dataset,
    original,
    "Adding local scenarios must not change any of the 500 prior records",
  );
  assert.deepEqual(
    buildLocalInitialIncidentDataset({
      ...options,
      authorIds: [65, 66, 67, 68, 69],
      reviewerId: 65,
      center,
      radiusMeters: 3000,
      count: 50,
      excludePoints,
      seed: "utp-ica-additional-50",
    }),
    local,
  );
});

test("local preparation rejects invalid centers, radii, exclusions and insufficient streets before producing any records", () => {
  const center = { latitud: -14.0721246, longitud: -75.7359964 };
  const localOptions = { ...options, center, count: 50, radiusMeters: 3000 };
  for (const bad of [
    { center: null },
    { center: { latitud: 0, longitud: 0 } },
    { center: { latitud: NaN, longitud: -75.7 } },
    { radiusMeters: 0 },
    { radiusMeters: 30001 },
    { radiusMeters: Infinity },
    { count: 0 },
    { count: 2001 },
    { excludePoints: null },
    { excludePoints: [{ latitud: NaN, longitud: -75.7 }] },
    { authorIds: [65, 65] },
    { reviewerId: 0 },
    { now: "invalid" },
    { types: [] },
    { seed: "" },
  ])
    assert.throws(() =>
      buildLocalInitialIncidentDataset({ ...localOptions, ...bad }),
    );
  assert.throws(
    () =>
      buildLocalInitialIncidentDataset({
        ...localOptions,
        radiusMeters: 100,
        count: 2000,
      }),
    /ubicaciones distintas/,
  );
});
