"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  searchCorridor,
  itineraryPoints,
} = require("../src/lib/route-discovery");
const { createTrafficService } = require("../src/lib/navigation-traffic");
const { roads, input } = require("./helpers/navigation-fixtures");
const geom = {
  type: "LineString",
  coordinates: [
    [-75.729, -14.067],
    [-75.727, -14.067],
    [-75.727, -14.066],
  ],
};
const places = Array.from({ length: 4 }, (_, i) => ({
  nombre: `Lugar ${i}`,
  latitud: -14.067 + i * 0.0001,
  longitud: -75.727,
  osmId: `node/${i}`,
}));
test("corridor follows polyline, deduplicates venues, paginates stably and declares geometric distance", () => {
  const catalog = [
    ...places,
    places[0],
    { nombre: "Lejos", latitud: 0, longitud: 0 },
  ];
  const first = searchCorridor(
    { geometria: geom, radioMetros: 30, limit: 2 },
    roads,
    catalog,
  );
  assert.equal(first.total, 4);
  assert.equal(first.nextOffset, 2);
  const second = searchCorridor(
    { geometria: geom, radioMetros: 30, limit: 2, offset: 2 },
    roads,
    catalog,
  );
  assert.equal(second.nextOffset, null);
  assert.equal(
    new Set([...first.items, ...second.items].map((p) => p.id)).size,
    4,
  );
  assert.match(first.items[0].distanciaMetodo, /no mide desvío/);
  assert.equal(
    searchCorridor({ geometria: geom, q: "Lugar 2" }, roads, catalog).total,
    1,
  );
  assert.ok(!("rating" in first.items[0]));
});
test("corridor and itinerary reject oversized, malformed and repeated inputs", () => {
  for (const value of [null, undefined]) {
    assert.throws(
      () => searchCorridor(value, roads, places),
      (e) => e.status === 400,
    );
    assert.throws(
      () => itineraryPoints(value),
      (e) => e.status === 400,
    );
  }
  for (const payload of [
    { geometria: { type: "Point", coordinates: [0, 0] } },
    { geometria: geom, radioMetros: 5000 },
    { geometria: geom, offset: -1 },
    { geometria: geom, limit: 999 },
  ])
    assert.throws(
      () => searchCorridor(payload, roads, places),
      (e) => e.status === 400,
    );
  assert.throws(
    () => itineraryPoints({ ...input, paradas: Array(4).fill(input.origen) }),
    (e) => e.status === 400,
  );
  assert.throws(
    () => itineraryPoints({ ...input, paradas: [input.origen] }),
    (e) => e.status === 400,
  );
});
test("itinerary preserves ordered stops and sums actual planned legs under one snapshot", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const service = createTrafficService({ roads, client: {}, now: () => now });
  const result = await service.itinerary(
    {
      ...input,
      modo: "walking",
      paradas: [{ latitud: -14.066, longitud: -75.727 }],
    },
    [],
  );
  assert.equal(result.tramos.length, 2);
  assert.equal(result.ordenOptimizado, false);
  assert.equal(
    result.duracion,
    result.tramos.reduce((s, t) => s + t.ruta.duracion, 0),
  );
  assert.deepEqual(result.tramos[0].ruta.destino, result.tramos[1].ruta.origen);
  assert.ok(
    result.tramos.every((t) => t.ruta.actualizadoEn === now.toISOString()),
  );
  assert.match(result.advertencias[0], /no incluyen esperas/);
});
