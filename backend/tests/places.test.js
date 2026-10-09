"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPlaceService,
  providerPlaces,
  provinceBounds,
} = require("../src/lib/places");
const { roads } = require("./helpers/navigation-fixtures");
const { searchPlaces } = require("../src/lib/roads");

const point = { latitud: -14.067, longitud: -75.728 };
const venue = (name, position = point) => ({
  poi: { name },
  position: { lat: position.latitud, lon: position.longitud },
  address: { freeformAddress: "Avenida de prueba 123, Ica" },
});
function provider(
  search,
  configuration = { configurado: true, habilitado: true },
) {
  return { configuration: () => configuration, search };
}
function service(client, localSearch = () => []) {
  return createPlaceService({ client, localSearch, loadRoads: () => roads });
}

test("known local places return immediately without provider calls or reservations", async () => {
  const local = [{ nombre: "Plaza de Armas de Ica", ...point }];
  const result = await service(
    provider(() => assert.fail("A local search must not call the provider")),
    (query) => {
      assert.equal(query, "Plaza de Armas de Ica");
      return local;
    },
  ).search("  Plaza de Armas   de Ica  ");
  assert.deepEqual(result, local);
});

test("missing or disabled integration keeps the local catalog usable", async () => {
  for (const state of [
    { configurado: false, habilitado: true },
    { configurado: true, habilitado: false },
  ])
    assert.deepEqual(
      await service(
        provider(() => assert.fail("Disabled search must not fetch"), state),
      ).search("Sin coincidencia"),
      [],
    );
});

test("punctuation and stop words do not consume provider requests", async () => {
  const places = service(
    provider(() => assert.fail("No relevant search terms")),
  );
  assert.deepEqual(await places.search("!!!"), []);
  assert.deepEqual(await places.search("de la en"), []);
});

test("an unknown local place uses TomTom with provincial bounds and public fields only", async () => {
  const result = await service(
    provider(async (query, bounds) => {
      assert.equal(query, "Nuevo negocio");
      assert.deepEqual(bounds, {
        north: -14.05,
        south: -14.08,
        west: -75.74,
        east: -75.71,
      });
      return {
        data: {
          results: [
            {
              ...venue("Nuevo negocio"),
              secret: "must not return",
              poi: { name: "Nuevo negocio", phone: "must not return" },
            },
          ],
        },
      };
    }),
  ).search("Nuevo negocio");
  assert.deepEqual(result, [
    {
      nombre: "Nuevo negocio",
      ...point,
      fuente: "TomTom",
      descripcion: "Avenida de prueba 123, Ica",
    },
  ]);
});

test("provider results reject foreign coordinates, invalid positions and near duplicates, preserving separate branches", () => {
  const result = providerPlaces(
    {
      results: [
        venue("Farmacia"),
        venue("Farmacia"),
        venue("Farmacia", { latitud: -14.06, longitud: -75.72 }),
        venue("Lima", { latitud: -12.04, longitud: -77.04 }),
        venue("Invalid", { latitud: NaN, longitud: -75.72 }),
        { position: { lat: -14.067, lon: -75.728 } },
        null,
      ],
    },
    roads,
  );
  assert.equal(result.length, 2);
  assert.equal(
    result.every((item) => item.nombre === "Farmacia"),
    true,
  );
});

test("valid empty searches stay empty; malformed or failed provider responses become safe service errors", async () => {
  assert.deepEqual(
    await service(provider(async () => ({ data: { results: [] } }))).search(
      "Unknown",
    ),
    [],
  );
  for (const search of [
    async () => ({ data: { results: "invalid" } }),
    async () => {
      throw new Error("url?key=SYNTHETIC_SECRET");
    },
  ])
    await assert.rejects(
      service(provider(search)).search("Unknown"),
      (error) =>
        error.status === 503 &&
        error.code === "PLACES_SEARCH_UNAVAILABLE" &&
        !error.message.includes("SYNTHETIC_SECRET"),
    );
});

test("only twelve valid provider results are returned", () => {
  const result = providerPlaces(
    { results: Array.from({ length: 20 }, (_, i) => venue(`Lugar ${i}`)) },
    roads,
  );
  assert.equal(result.length, 12);
});

test("an invalid province cannot silently turn the provider search into a worldwide query", () => {
  assert.throws(
    () => provinceBounds({ boundary: { outer: [] } }),
    (error) => error.code === "ROADS_UNAVAILABLE",
  );
});

test("the shipped catalog includes genuine Ica landmarks with verified coordinates", () => {
  for (const [query, name, latitude, longitude] of [
    [
      "plaza de armas de ica",
      "Plaza de Armas de Ica",
      -14.0640293,
      -75.7290741,
    ],
    ["laguna de huacachina", "Laguna de Huacachina", -14.0879165, -75.7639539],
  ]) {
    const result = searchPlaces(query);
    assert.equal(result[0].nombre, name);
    assert.equal(result[0].latitud, latitude);
    assert.equal(result[0].longitud, longitude);
  }
  for (const query of [
    "universidad san luis gonzaga",
    "av. grau",
    "hospital regional",
  ])
    assert.ok(searchPlaces(query).length, query);
});
