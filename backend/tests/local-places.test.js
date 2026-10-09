"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePlaceName,
  searchLocalPlaces,
  buildLocalPlaceIndex,
} = require("../src/lib/local-places");
const { inProvince, searchPlaces } = require("../src/lib/roads");
const { createPlacesCatalog } = require("../scripts/import-places");

function fixtureRoads() {
  return {
    segments: [
      {
        tags: { name: "Avenida Grau" },
        coordinates: [
          [-75.72, -14.04],
          [-75.72, -14.041],
        ],
      },
      {
        tags: { name: "Avenida Grau" },
        coordinates: [
          [-75.722, -14.044],
          [-75.722, -14.045],
        ],
      },
      {
        tags: { name: "Avenida Las Rocas" },
        coordinates: [
          [-75.73, -14.06],
          [-75.73, -14.061],
        ],
      },
    ],
    boundary: {
      outer: [
        [
          [-75.85, -14.2],
          [-75.6, -14.2],
          [-75.6, -13.9],
          [-75.85, -13.9],
          [-75.85, -14.2],
        ],
      ],
      inner: [],
    },
    districts: [
      {
        nombre: "Ica",
        outer: [
          [
            [-75.85, -14.2],
            [-75.6, -14.2],
            [-75.6, -13.9],
            [-75.85, -13.9],
            [-75.85, -14.2],
          ],
        ],
        inner: [],
      },
    ],
  };
}

function fixturePlaces() {
  return [
    {
      nombre: "Plaza de Armas de Subtanjalla",
      latitud: -14.01,
      longitud: -75.758,
      descripcion: "Subtanjalla",
      fuente: "OpenStreetMap",
    },
    {
      nombre: "Plaza de Armas de Ica",
      latitud: -14.0640293,
      longitud: -75.7290741,
      descripcion: "Ica",
      fuente: "OpenStreetMap",
    },
    {
      nombre: "Hospital Regional de Ica",
      latitud: -14.075,
      longitud: -75.71,
      descripcion: "Ica",
      fuente: "OpenStreetMap",
    },
    {
      nombre: "Primax",
      latitud: -14.05,
      longitud: -75.72,
      fuente: "OpenStreetMap",
    },
    {
      nombre: "Primax",
      latitud: -14.05001,
      longitud: -75.72001,
      fuente: "OpenStreetMap",
    },
    {
      nombre: "Primax",
      latitud: -14.15,
      longitud: -75.72,
      fuente: "OpenStreetMap",
    },
    {
      nombre: "Universidad San José",
      latitud: -14.09,
      longitud: -75.71,
      fuente: "OpenStreetMap",
    },
  ];
}

function lookup(query, places = fixturePlaces(), roads = fixtureRoads()) {
  return searchLocalPlaces(query, roads, {
    places,
    contains: (point) => inProvince(point, roads),
  });
}

test("encuentra Plaza de Armas de Ica y prioriza su nombre frente a otras plazas de la provincia", () => {
  for (const query of [
    "Plaza de Armas de Ica",
    "plaza armas ica",
    "   PLAZA   de   ARMAS de   ICA  ",
  ]) {
    const result = lookup(query);
    assert.equal(result[0].nombre, "Plaza de Armas de Ica");
    assert.equal(result[0].latitud, -14.0640293);
    assert.equal(result[0].longitud, -75.7290741);
    assert.equal(result[0].fuente, "OpenStreetMap");
  }
});

test("admite acentos, palabras en otro orden y abreviaturas de calles", () => {
  assert.equal(normalizePlaceName("Av.  Grau"), "avenida grau");
  assert.equal(
    lookup("san jose universidad")[0].nombre,
    "Universidad San José",
  );
  assert.equal(lookup("Av. Grau")[0].nombre, "Avenida Grau");
  assert.equal(lookup("Avenida Grau, Ica")[0].nombre, "Avenida Grau");
  assert.equal(lookup("hospi regional")[0].nombre, "Hospital Regional de Ica");
  assert.equal(
    lookup("plaza de ar")[0].nombre,
    "Plaza de Armas de Subtanjalla",
  );
});

test("no interpreta letras internas de otra palabra como coincidencia", () => {
  assert.equal(lookup("roca")[0].nombre, "Avenida Las Rocas");
  assert.equal(lookup("oca").length, 0);
  assert.equal(lookup("hospital roca").length, 0);
});

test("elimina dos representaciones cercanas del lugar pero conserva sucursales separadas", () => {
  const result = lookup("primax");
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((place) => place.latitud),
    [-14.05, -14.15],
  );
  assert.equal(lookup("grau").length, 1);
});

test("excluye puntos fuera de cobertura, datos inválidos y huecos de la provincia", () => {
  const roads = fixtureRoads();
  roads.boundary.inner.push([
    [-75.751, -14.111],
    [-75.749, -14.111],
    [-75.749, -14.109],
    [-75.751, -14.109],
    [-75.751, -14.111],
  ]);
  const places = [
    { nombre: "Parque válido", latitud: -14.05, longitud: -75.71 },
    { nombre: "Parque fuera", latitud: -12.05, longitud: -77.03 },
    { nombre: "Parque hueco", latitud: -14.11, longitud: -75.75 },
    { nombre: "Parque inválido", latitud: NaN, longitud: -75.71 },
    { nombre: "Parque texto", latitud: "-14.05", longitud: -75.71 },
  ];
  assert.deepEqual(
    lookup("parque", places, roads).map((place) => place.nombre),
    ["Parque válido"],
  );
});

test("mantiene orden estable en empates y limita resultados a doce", () => {
  const places = Array.from({ length: 20 }, (_, i) => ({
    nombre: `Parque ${i}`,
    latitud: -14.02 - i * 0.003,
    longitud: -75.74,
  }));
  const roads = fixtureRoads();
  const result = lookup("parque", places, roads);
  assert.equal(result.length, 12);
  assert.deepEqual(
    result.map((place) => place.nombre),
    places.slice(0, 12).map((place) => place.nombre),
  );
  assert.deepEqual(lookup("parque", places, roads), result);
});

test("ignora consultas vacías, demasiado cortas o sin términos relevantes", () => {
  for (const query of ["", " ", "p", "de la", "!!!"])
    assert.deepEqual(lookup(query), []);
});

test("el índice reutiliza candidatos y la consulta no revela metadatos internos", () => {
  const roads = fixtureRoads();
  const places = [
    { ...fixturePlaces()[1], telefono: "no-publicar", osmId: "way/630762068" },
  ];
  let validations = 0;
  const options = {
    places,
    contains(point) {
      validations++;
      return inProvince(point, roads);
    },
  };
  const result = searchLocalPlaces("plaza armas ica", roads, options);
  const firstValidations = validations;
  searchLocalPlaces("plaza", roads, options);
  assert.equal(validations, firstValidations);
  assert.equal(result[0].telefono, undefined);
  assert.equal(result[0].osmId, undefined);
  assert.ok(buildLocalPlaceIndex(roads, places, options.contains).length > 0);
});

test("importa nombres y centros OSM reales, conserva licencia y excluye campos personales", () => {
  const raw = {
    elements: [
      {
        type: "way",
        id: 630762068,
        center: { lat: -14.0640293, lon: -75.7290741 },
        tags: {
          name: "Plaza de Armas de Ica",
          leisure: "park",
          phone: "no-publicar",
        },
      },
      {
        type: "node",
        id: 1,
        lat: -14.06403,
        lon: -75.729074,
        tags: { name: "Plaza de Armas de Ica" },
      },
      {
        type: "node",
        id: 2,
        lat: -12.05,
        lon: -77.03,
        tags: { name: "Otro lugar" },
      },
      { type: "way", id: 3, tags: { name: "Sin coordenadas" } },
    ],
  };
  const catalog = createPlacesCatalog(raw, {
    roads: fixtureRoads(),
    updatedAt: "2026-10-09T10:00:00.000Z",
  });
  assert.equal(catalog.places.length, 1);
  assert.deepEqual(catalog.places[0], {
    nombre: "Plaza de Armas de Ica",
    latitud: -14.0640293,
    longitud: -75.7290741,
    descripcion: "Ica",
    fuente: "OpenStreetMap",
    osmId: "way/630762068",
  });
  assert.equal(catalog.licencia, "ODbL 1.0");
  assert.equal(catalog.atribucion, "© OpenStreetMap contributors");
  assert.equal(catalog.actualizadoEn, "2026-10-09T10:00:00.000Z");
});

test("rechaza importaciones vacías o erróneas sin reemplazar datos existentes", () => {
  assert.throws(
    () => createPlacesCatalog({}, { roads: fixtureRoads() }),
    /elementos OSM/,
  );
  assert.throws(
    () => createPlacesCatalog({ elements: [] }, { roads: fixtureRoads() }),
    /se conserva el catálogo anterior/,
  );
});

test("searchPlaces mantiene la búsqueda de calles sin depender de una API externa", () => {
  assert.equal(
    searchPlaces("Av. Grau", fixtureRoads())[0].nombre,
    "Avenida Grau",
  );
});
