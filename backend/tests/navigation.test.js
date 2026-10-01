"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { planRoutes, Heap } = require("../src/lib/navigation");
const { getRoads, inProvince, allows, lengthOf } = require("../src/lib/roads");
const points = {
  a: [-75.729, -14.067],
  b: [-75.727, -14.067],
  c: [-75.727, -14.066],
  d: [-75.729, -14.066],
};
function road(id, start, end, tags = { highway: "residential" }) {
  const coordinates = [points[start], points[end]];
  return {
    id,
    start,
    end,
    coordinates,
    length: lengthOf(coordinates),
    tags,
    nombre: id,
  };
}
const roads = {
  segments: [
    road("ab", "a", "b"),
    road("bc", "b", "c"),
    road("cd", "c", "d"),
    road("da", "d", "a"),
  ],
  boundary: {
    outer: [
      [
        [-75.74, -14.08],
        [-75.71, -14.08],
        [-75.71, -14.05],
        [-75.74, -14.05],
        [-75.74, -14.08],
      ],
    ],
    inner: [],
  },
  atribucion: "Test graph",
  actualizadoEn: "2026-10-01",
};
test("Heap ordena costos para Dijkstra", () => {
  const heap = new Heap();
  [4, 1, 8, 2, 0].forEach((cost) => heap.push({ cost }));
  assert.deepEqual(
    [
      heap.pop().cost,
      heap.pop().cost,
      heap.pop().cost,
      heap.pop().cost,
      heap.pop().cost,
    ],
    [0, 1, 2, 4, 8],
  );
});
test("Una ruta sigue la geometría de las calles y ofrece un desvío más seguro cuando cambia la exposición", () => {
  const incident = {
    id: 1,
    latitud: -14.067,
    longitud: -75.728,
    nivelRiesgo: 5,
    validacion: 1,
    estado: "ACTIVO",
    evaluacion: "AGENTE",
    emergencia: true,
  };
  const result = planRoutes(
    {
      origen: { latitud: -14.067, longitud: -75.7289 },
      destino: { latitud: -14.067, longitud: -75.7271 },
      maxDesvioSeguro: 2,
      maxDesvioEquilibrado: 2,
    },
    [incident],
    new Date(),
    roads,
  );
  assert.ok(result.rutas.length >= 2);
  assert.equal(result.rutas[0].geometria.type, "LineString");
  assert.ok(result.rutas[0].puntosRiesgo > result.rutas[1].puntosRiesgo);
  assert.ok(result.rutas[0].advertencias.some((w) => w.includes("emergencia")));
});
test("Puntos del mismo tramo conservan el recorrido parcial y las alternativas coincidentes se deduplican", () => {
  const result = planRoutes(
    {
      origen: { latitud: -14.067, longitud: -75.7289 },
      destino: { latitud: -14.067, longitud: -75.7271 },
    },
    [],
    new Date(),
    roads,
  );
  assert.equal(result.rutas.length, 1);
  assert.ok(result.rutas[0].distancia > 190 && result.rutas[0].distancia < 200);
  assert.equal(result.rutas[0].geometria.coordinates.length, 2);
});
test("El límite real de Ica permite el centro y rechaza Nazca; la red tiene intersecciones", () => {
  const actual = getRoads();
  assert.ok(actual.segments.length > 10000);
  assert.ok(actual.boundary.outer.length > 0);
  assert.equal(
    inProvince({ latitud: -14.0678, longitud: -75.7286 }, actual),
    true,
  );
  assert.equal(
    inProvince({ latitud: -14.8359, longitud: -74.9328 }, actual),
    false,
  );
});
test("Respeta restricciones del transporte y no ofrece una línea ficticia fuera de cobertura", () => {
  assert.equal(allows({ tags: { highway: "footway" } }, "driving"), false);
  assert.equal(
    allows({ tags: { highway: "residential", access: "private" } }, "walking"),
    false,
  );
  assert.throws(
    () =>
      planRoutes(
        {
          origen: { latitud: 0, longitud: 0 },
          destino: { latitud: -14.067, longitud: -75.7271 },
        },
        [],
        new Date(),
        roads,
      ),
    (e) => e.code === "OUTSIDE_COVERAGE",
  );
});
test("Una calle bloqueada validada se excluye, mientras una sospecha pendiente mantiene un aviso", () => {
  const incident = {
    id: 2,
    tipoCatalogo: { slug: "calle-bloqueada" },
    latitud: -14.067,
    longitud: -75.728,
    nivelRiesgo: 4,
    validacion: 1,
    estado: "ACTIVO",
    evaluacion: "AGENTE",
  };
  const result = planRoutes(
    {
      origen: { latitud: -14.066, longitud: -75.7289 },
      destino: { latitud: -14.067, longitud: -75.727 },
    },
    [incident],
    new Date(),
    roads,
  );
  assert.ok(result.rutas.every((r) => !r.tramos.includes("ab")));
});

test("Los sentidos explícitos por transporte prevalecen sobre sentidos generales e implícitos", () => {
  const origin = { latitud: -14.067, longitud: -75.7271 };
  const destination = { latitud: -14.067, longitud: -75.7289 };
  const backwards = (tags, modo) =>
    planRoutes({ origen: origin, destino: destination, modo }, [], new Date(), {
      ...roads,
      segments: [road("ab", "a", "b", tags)],
    });
  assert.ok(
    backwards(
      { highway: "residential", junction: "roundabout", oneway: "no" },
      "driving",
    ).rutas.length,
  );
  assert.ok(
    backwards(
      { highway: "residential", oneway: "yes", "oneway:bicycle": "no" },
      "cycling",
    ).rutas.length,
  );
  assert.ok(
    backwards({ highway: "residential", oneway: "yes" }, "walking").rutas
      .length,
  );
  for (const [tags, mode] of [
    [
      { highway: "residential", oneway: "no", "oneway:bicycle": "yes" },
      "cycling",
    ],
    [{ highway: "residential", "oneway:foot": "yes" }, "walking"],
    [{ highway: "steps", oneway: "yes" }, "walking"],
    [{ highway: "motorway" }, "driving"],
  ])
    assert.throws(
      () => backwards(tags, mode),
      (error) => error.code === "NO_ROUTE",
    );
});

test("La duración siempre es finita con límites inválidos y respeta unidades explícitas", () => {
  const route = (maxspeed) =>
    planRoutes(
      {
        origen: { latitud: -14.067, longitud: -75.7289 },
        destino: { latitud: -14.067, longitud: -75.7271 },
        modo: "driving",
      },
      [],
      new Date(),
      {
        ...roads,
        segments: [road("ab", "a", "b", { highway: "residential", maxspeed })],
      },
    ).rutas[0];
  for (const value of ["0", "-10", "desconocido", "Infinity"]) {
    const result = route(value);
    assert.ok(Number.isFinite(result.duracion) && result.duracion > 0);
    assert.equal(JSON.parse(JSON.stringify(result)).duracion, result.duracion);
  }
  assert.ok(
    Math.abs(route("25").duracion / route("25 mph").duracion - 1.609344) < 1e-9,
  );
  assert.ok(route("walk").duracion > route("35").duracion);
});
