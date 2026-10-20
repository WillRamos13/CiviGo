"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { subdivideRoads } = require("../src/lib/road-segmentation");
const { scoreSegments, incidentRisk } = require("../src/lib/risk");
const { planRoutes } = require("../src/lib/navigation");
const { lengthOf } = require("../src/lib/roads");
const { roads, input } = require("./helpers/navigation-fixtures");
const now = new Date("2026-10-20T12:00:00Z");
const long = {
  id: "long",
  start: "a",
  end: "b",
  osmId: 123,
  tags: { highway: "residential", oneway: "yes" },
  coordinates: [
    [-75.75, -14.067],
    [-75.725, -14.067],
    [-75.7, -14.067],
  ],
};
long.length = lengthOf(long.coordinates);
test("long edges preserve geometry, topology and direction in pieces of at most 150 m", () => {
  const before = JSON.stringify(long),
    pieces = subdivideRoads([long]);
  assert.ok(pieces.length > 30);
  assert.equal(JSON.stringify(long), before);
  assert.equal(pieces[0].start, "a");
  assert.equal(pieces.at(-1).end, "b");
  assert.ok(
    Math.abs(pieces.reduce((sum, s) => sum + s.length, 0) - long.length) < 0.01,
  );
  for (const [i, s] of pieces.entries()) {
    assert.ok(lengthOf(s.coordinates) <= 150.001);
    assert.equal(s.parentEdgeId, "long");
    assert.equal(s.osmId, 123);
    assert.equal(s.tags.oneway, "yes");
    assert.ok(Math.abs(s.endOffset - s.startOffset - s.length) < 0.001);
    if (i) {
      assert.equal(pieces[i - 1].end, s.start);
      assert.deepEqual(pieces[i - 1].coordinates.at(-1), s.coordinates[0]);
    }
  }
  assert.ok(pieces.some((s) => s.coordinates.some((p) => p[0] === -75.725)));
});
test("an incident in a 5 km road cannot color the whole road or a crossing carriageway", () => {
  const segments = subdivideRoads([
    long,
    {
      ...long,
      id: "crossing",
      start: "c",
      end: "d",
      coordinates: [
        [-75.725, -14.08],
        [-75.725, -14.05],
      ],
    },
  ]);
  const incident = {
    id: 1,
    latitud: -14.067,
    longitud: -75.7249,
    nivelRiesgo: 5,
    validacion: 1,
    evaluacion: "AGENTE",
    estado: "ACTIVO",
    fechaEvento: now,
  };
  const scores = scoreSegments(segments, [incident], now);
  const affected = scores.filter((s) => s.points > 0);
  assert.ok(affected.length > 0 && affected.length <= 3);
  assert.ok(affected.every((s) => s.parentEdgeId === "long"));
  assert.ok(affected.reduce((sum, s) => sum + s.length, 0) <= 450.01);
});
test("subdivision preserves route length and oneway reachability without joining crossings", () => {
  const network = {
    ...roads,
    segments: [
      { ...roads.segments[0], tags: { highway: "residential", oneway: "yes" } },
    ],
  };
  const partitioned = {
    ...network,
    segments: subdivideRoads(network.segments, 50),
  };
  const original = planRoutes(input, [], now, network).rutas[0];
  const result = planRoutes(input, [], now, partitioned).rutas[0];
  assert.ok(Math.abs(result.distancia - original.distancia) < 0.01);
  assert.throws(
    () =>
      planRoutes(
        { ...input, origen: input.destino, destino: input.origen },
        [],
        now,
        partitioned,
      ),
    (e) => e.code === "NO_ROUTE",
  );
});
test("expired historical severity pending does not leave an eternal gray risk segment", () => {
  const old = {
    publicado: true,
    historico: true,
    estado: "PENDIENTE",
    evaluacion: "PENDIENTE",
    nivelRiesgo: null,
    fechaEvento: "2017-11-04",
  };
  assert.equal(incidentRisk(old, now).pending, false);
  assert.equal(
    incidentRisk({ ...old, fechaEvento: "2026-09-01" }, now).pending,
    true,
  );
});
