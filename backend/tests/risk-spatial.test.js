"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const {
  projectToLine,
  nearestRiskSegment,
  scoreSegments,
} = require("../src/lib/risk");
const { getRoads } = require("../src/lib/roads");
function brute(point, segments) {
  let best = null;
  for (const segment of segments) {
    const projection = projectToLine(point, segment.coordinates);
    if (projection && (!best || projection.distance < best.projection.distance))
      best = { segment, projection };
  }
  return best && best.projection.distance <= 150 ? best : null;
}
function compare(point, segments) {
  const expected = brute(point, segments),
    actual = nearestRiskSegment(point, segments);
  assert.equal(actual?.segment.id ?? null, expected?.segment.id ?? null);
  if (expected) assert.deepEqual(actual.projection, expected.projection);
}

test("spatial attribution preserves exact projection, curved roads, junction ties and distance limit", () => {
  const segments = [
    {
      id: "first",
      coordinates: [
        [-75.75, -14.07],
        [-75.75, -14.068],
        [-75.748, -14.068],
      ],
    },
    {
      id: "second",
      coordinates: [
        [-75.75, -14.068],
        [-75.752, -14.068],
      ],
    },
    {
      id: "large",
      coordinates: [
        [-80, -14.075],
        [-70, -14.075],
      ],
    },
  ];
  for (const point of [
    [-75.75, -14.068],
    [-75.749, -14.0685],
    [-75.751, -14.0685],
    [-75.75, -14.0713],
    [-75.75, -14.09],
    [-75.75, -14.0751],
  ])
    compare(point, segments);
  assert.equal(
    nearestRiskSegment([-75.75, -14.068], segments).segment.id,
    "first",
  );
  assert.equal(nearestRiskSegment([-75.75, -14.09], segments), null);
  compare(
    [0, 89.9995],
    [
      {
        id: "polar",
        coordinates: [
          [-1, 89.999],
          [1, 89.999],
        ],
      },
    ],
  );
  compare(
    [179.9998, 0],
    [
      {
        id: "dateline",
        coordinates: [
          [-179.9998, -0.001],
          [-179.9998, 0.001],
        ],
      },
    ],
  );
  compare(
    [-179.9998, 0],
    [
      {
        id: "dateline",
        coordinates: [
          [179.9998, -0.001],
          [179.9998, 0.001],
        ],
      },
    ],
  );
});

test("spatial attribution matches exhaustive search across deterministic samples", () => {
  const segments = [];
  for (let i = 0; i < 200; i++) {
    const x = -75.8 + (i % 20) * 0.0005,
      y = -14.1 + Math.floor(i / 20) * 0.0005;
    segments.push({
      id: String(i),
      coordinates: [
        [x, y],
        [x + 0.0002, y + 0.0001],
        [x + 0.0004, y],
      ],
    });
  }
  for (let i = 0; i < 100; i++)
    compare(
      [
        -75.8005 + ((i * 37) % 100) * 0.00011,
        -14.1005 + ((i * 29) % 53) * 0.00011,
      ],
      segments,
    );
});

test("real Ica attribution benchmark records timings without a flaky performance threshold", (t) => {
  const roads = getRoads(),
    segments = roads.segments;
  const points = Array.from(
    { length: 100 },
    (_, i) => segments[(i * 347) % segments.length].coordinates[0],
  );
  const startBrute = performance.now();
  const expected = points.map(
    (point) => brute(point, segments)?.segment.id ?? null,
  );
  const bruteMs = performance.now() - startBrute;
  const startIndexed = performance.now();
  const actual = points.map(
    (point) => nearestRiskSegment(point, segments)?.segment.id ?? null,
  );
  const indexedMs = performance.now() - startIndexed;
  assert.deepEqual(actual, expected);
  const incidents = points.map((point, id) => ({
    id,
    longitud: point[0],
    latitud: point[1],
    publicado: true,
    nivelRiesgo: 4,
    validacion: 1,
    evaluacion: "AGENTE",
    estado: "ACTIVO",
  }));
  const startScores = performance.now();
  const scored = scoreSegments(segments, incidents);
  assert.equal(scored.length, segments.length);
  const scoresMs = performance.now() - startScores;
  t.diagnostic(
    `${segments.length} tramos / 100 hechos: exhaustivo ${bruteMs.toFixed(1)}ms; índice ${indexedMs.toFixed(1)}ms; puntuación completa ${scoresMs.toFixed(1)}ms`,
  );
});
