"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { coveredSegments, getRoads, lengthOf } = require("../src/lib/roads");
const { planRoutes } = require("../src/lib/navigation");
function segment(id, start, end, coordinates) {
  return {
    id,
    start,
    end,
    coordinates,
    length: lengthOf(coordinates),
    tags: { highway: "residential" },
  };
}

test("coverage rejects concavity crossings and holes while accepting the exact boundary", () => {
  const outer = [
    [0, 0],
    [0.04, 0],
    [0.04, 0.04],
    [0.009, 0.04],
    [0.009, 0.02],
    [0.008, 0.02],
    [0.008, 0.04],
    [0, 0.04],
    [0, 0],
  ];
  const inner = [
    [0.02, 0.01],
    [0.022, 0.01],
    [0.022, 0.012],
    [0.02, 0.012],
    [0.02, 0.01],
  ];
  const roads = {
    boundary: { outer: [outer], inner: [inner] },
    segments: [
      segment("inside", "a", "b", [
        [0.002, 0.002],
        [0.003, 0.003],
      ]),
      segment("concavity", "a", "b", [
        [0.004, 0.03],
        [0.03, 0.03],
      ]),
      segment("hole", "a", "b", [
        [0.015, 0.011],
        [0.025, 0.011],
      ]),
      segment("border", "a", "b", [
        [0, 0.01],
        [0, 0.03],
      ]),
      segment("outside", "a", "b", [
        [-0.001, 0.01],
        [0, 0.01],
      ]),
      segment("curved-outside", "a", "b", [
        [0.002, 0.002],
        [-0.001, 0.003],
        [0.003, 0.003],
      ]),
    ],
  };
  assert.deepEqual(
    coveredSegments(roads).map((s) => s.id),
    ["inside", "border"],
  );
  assert.equal(
    coveredSegments(roads),
    coveredSegments(roads),
    "the original roads object caches its coverage result",
  );
  assert.equal(roads.segments.length, 6, "source OSM geometry is retained");
});

test("planner rejects an outside shortcut and retains a connected route within coverage", () => {
  const a = [0.001, 0.001],
    b = [0.003, 0.001],
    c = [0.003, 0.003];
  const roads = {
    boundary: {
      outer: [
        [
          [0, 0],
          [0.004, 0],
          [0.004, 0.004],
          [0, 0.004],
          [0, 0],
        ],
      ],
      inner: [],
    },
    segments: [
      segment("outside", "a", "b", [a, [0.002, -0.0001], b]),
      segment("ac", "a", "c", [a, c]),
      segment("cb", "c", "b", [c, b]),
    ],
    atribucion: "Test",
    actualizadoEn: "2026-10-01",
  };
  const result = planRoutes(
    {
      origen: { longitud: a[0], latitud: a[1] },
      destino: { longitud: b[0], latitud: b[1] },
      modo: "driving",
    },
    [],
    new Date(),
    roads,
  );
  assert.ok(result.rutas.length);
  assert.ok(result.rutas.every((route) => !route.tramos.includes("outside")));
  assert.ok(
    result.rutas.every((route) =>
      route.geometria.coordinates.every(
        (p) => p[0] >= 0 && p[0] <= 0.004 && p[1] >= 0 && p[1] <= 0.004,
      ),
    ),
  );
  const disconnected = { ...roads, segments: [roads.segments[0]] };
  assert.throws(
    () =>
      planRoutes(
        {
          origen: { longitud: a[0], latitud: a[1] },
          destino: { longitud: b[0], latitud: b[1] },
        },
        [],
        new Date(),
        disconnected,
      ),
    (error) => error.code === "ROAD_NOT_FOUND",
  );
});

test("real Ica coverage is prepared once and preserves the source network", (t) => {
  const roads = getRoads(),
    start = performance.now();
  const covered = coveredSegments(roads);
  const ms = performance.now() - start;
  assert.ok(covered.length > 30000);
  assert.ok(covered.length < roads.segments.length);
  assert.equal(coveredSegments(roads), covered);
  t.diagnostic(
    `${roads.segments.length} tramos OSM / ${covered.length} dentro de cobertura; primera preparación ${ms.toFixed(1)}ms`,
  );
});

test("planner accepts endpoints exactly on the provincial boundary without extending coverage", () => {
  const roads = {
    boundary: {
      outer: [
        [
          [0, 0],
          [0.004, 0],
          [0.004, 0.004],
          [0, 0.004],
          [0, 0],
        ],
      ],
      inner: [],
    },
    segments: [
      segment("border", "a", "b", [
        [0.004, 0.001],
        [0.004, 0.003],
      ]),
    ],
    atribucion: "Test",
    actualizadoEn: "2026-10-01",
  };
  assert.ok(
    planRoutes(
      {
        origen: { longitud: 0.004, latitud: 0.001 },
        destino: { longitud: 0.004, latitud: 0.003 },
      },
      [],
      new Date(),
      roads,
    ).rutas.length,
  );
  assert.throws(
    () =>
      planRoutes(
        {
          origen: { longitud: 0.004001, latitud: 0.001 },
          destino: { longitud: 0.004, latitud: 0.003 },
        },
        [],
        new Date(),
        roads,
      ),
    (error) => error.code === "OUTSIDE_COVERAGE",
  );
});
