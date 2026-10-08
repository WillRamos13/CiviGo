"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  planRoutes,
  routeCandidates,
  selectRoutes,
} = require("../src/lib/navigation");
const { heading, maneuver } = require("../src/lib/navigation-steps");
const {
  planRoutesWithTraffic,
  pathMatches,
  applyTraffic,
} = require("../src/lib/navigation-traffic");
const { roads, input, incident } = require("./helpers/navigation-fixtures");
const now = new Date("2026-10-08T11:00:00Z");
function response(route, seconds) {
  return {
    actualizadoEn: now.toISOString(),
    data: {
      routes: [
        {
          path: route.geometria,
          summary: {
            lengthInMeters: route.distancia,
            travelDurationInSeconds: seconds,
            trafficDelayDurationInSeconds: 10,
          },
        },
      ],
    },
  };
}
test("seguridad admite un recorrido mucho más largo sin límite manual de desvío", () => {
  const longRoads = {
    ...roads,
    boundary: {
      outer: [
        [
          [-75.74, -14.08],
          [-75.71, -14.08],
          [-75.71, -14.0],
          [-75.74, -14.0],
          [-75.74, -14.08],
        ],
      ],
      inner: [],
    },
    segments: roads.segments.map((segment) => {
      const coords = segment.coordinates.map((point) => [
        point[0],
        point[1] === -14.066 ? -14.01 : point[1],
      ]);
      return {
        ...segment,
        coordinates: coords,
        length: require("../src/lib/roads").lengthOf(coords),
      };
    }),
  };
  const result = planRoutes(
    { ...input, maxDesvioSeguro: 0, maxDesvioEquilibrado: 0 },
    [incident],
    now,
    longRoads,
    { influenciaVecina: 0 },
  );
  const fast = result.rutas.find((route) => route.criterios.includes("rapida"));
  const safe = result.rutas.find((route) => route.criterios.includes("segura"));
  assert.ok(safe.duracion > fast.duracion * 10);
  assert.ok(safe.exposicionTotal < fast.exposicionTotal);
  assert.equal(result.limitesDesvio, undefined);
});
test("la ruta rápida minimiza tiempo y no longitud; conserva modos y criterios coincidentes", () => {
  const quick = {
    ...roads,
    segments: roads.segments.map((segment) => ({
      ...segment,
      tags: { ...segment.tags, maxspeed: segment.id === "ab" ? "walk" : "80" },
    })),
  };
  const result = planRoutes({ ...input, criterio: "segura" }, [], now, quick);
  const fast = result.rutas.find((route) => route.criterios.includes("rapida"));
  assert.ok(fast.tramos.includes("cd"));
  assert.equal(
    result.seleccionadaId,
    result.rutas.find((route) => route.criterios.includes("segura")).id,
  );
  for (const mode of ["walking", "cycling", "driving"]) {
    const planned = planRoutes({ ...input, modo: mode }, [], now, roads);
    assert.ok(planned.rutas.length <= 3);
    assert.equal(
      new Set(planned.rutas.map((route) => JSON.stringify(route.geometria)))
        .size,
      planned.rutas.length,
    );
    assert.equal(planned.rutas[0].modo, mode);
    assert.ok(planned.rutas[0].criterios.includes("segura"));
  }
});
test("pasos incluyen giros españoles, distancia y tiempos acumulados hasta llegada", () => {
  const route = planRoutes(input, [incident], now, roads, {
    influenciaVecina: 0,
  }).rutas.find((item) => item.criterios.includes("segura"));
  assert.equal(route.pasos[0].tipo, "salida");
  assert.equal(route.pasos.at(-1).tipo, "llegada");
  assert.ok(
    route.pasos.some((step) => ["derecha", "izquierda"].includes(step.tipo)),
  );
  assert.ok(
    Math.abs(
      route.pasos.reduce((total, step) => total + step.distancia, 0) -
        route.distancia,
    ) < 0.01,
  );
  assert.ok(
    Math.abs(route.pasos.at(-1).duracionAcumulada - route.duracion) < 0.01,
  );
  assert.equal(
    route.llegadaEstimada,
    new Date(+now + route.duracion * 1000).toISOString(),
  );
  for (const step of route.pasos) {
    assert.ok(step.indiceInicio <= step.indiceFin);
    assert.deepEqual(
      step.coordenadas,
      route.geometria.coordinates[step.indiceInicio],
    );
    assert.ok(step.geometria.coordinates.length >= 2);
  }
  assert.ok(Math.abs(heading([0, 0], [1, 0]) - 90) < 0.01);
});
test("GPS como origen nuevo conserva destino y criterio al recalcular", () => {
  const origin = { latitud: -14.066, longitud: -75.728 };
  const result = planRoutes(
    { ...input, origen: origin, criterio: "segura" },
    [incident],
    now,
    roads,
  );
  const selected = result.rutas.find(
    (route) => route.id === result.seleccionadaId,
  );
  assert.deepEqual(selected.origen, origin);
  assert.deepEqual(selected.destino, input.destino);
  assert.ok(selected.criterios.includes("segura"));
});
test("no presenta condiciones pendientes como seguridad conocida", () => {
  const result = planRoutes(
    input,
    [{ ...incident, nivelRiesgo: null, evaluacion: "PENDIENTE" }],
    now,
    { ...roads, segments: [roads.segments[0]] },
  );
  assert.equal(result.rutas[0].riesgoConocido, false);
  assert.match(result.rutas[0].advertencias.join(" "), /por evaluar/);
});
test("tráfico cambia selección rápida y ETA sin cambiar riesgo ni geometría", async () => {
  const before = routeCandidates(input, [incident], now, roads, {
    influenciaVecina: 0,
  });
  const direct = before.candidates[0];
  const client = {
    route: async (route) =>
      response(route, route.tramos.includes("cd") ? 60 : 500),
  };
  const result = await planRoutesWithTraffic(input, [incident], {
    client,
    roads,
    now,
    rules: { influenciaVecina: 0 },
  });
  const fast = result.rutas.find((route) => route.criterios.includes("rapida"));
  assert.ok(fast.tramos.includes("cd"));
  assert.equal(fast.duracion, 60);
  assert.equal(fast.trafico.disponible, true);
  assert.ok(
    !fast.advertencias.some((warning) =>
      warning.includes("no incluye tráfico"),
    ),
  );
  const initial = before.candidates.find(
    (route) =>
      JSON.stringify(route.geometria) === JSON.stringify(fast.geometria),
  );
  assert.equal(fast.puntosRiesgo, initial.puntosRiesgo);
  assert.deepEqual(fast.incidentes, initial.incidentes);
  const applied = applyTraffic(direct, response(direct, 500));
  assert.equal(applied.pasos.at(-1).duracionAcumulada, 500);
  const cached = {
    ...response(direct, 500),
    actualizadoEn: new Date(+now - 80000).toISOString(),
  };
  assert.equal(
    applyTraffic(direct, cached).llegadaEstimada,
    new Date(+now + 500000).toISOString(),
  );
});
test("si falta una ETA o cuota se conserva comparación local completa", async () => {
  let calls = 0;
  const failure = new Error("Sin tráfico actualizado: cuota agotada.");
  const client = {
    route: async (route) => {
      if (++calls === 2) throw failure;
      return response(route, 9000);
    },
  };
  const result = await planRoutesWithTraffic(input, [incident], {
    client,
    roads,
    now,
  });
  const local = planRoutes(input, [incident], now, roads);
  assert.deepEqual(
    result.rutas.map((route) => [
      route.geometria,
      route.duracion,
      route.puntosRiesgo,
    ]),
    local.rutas.map((route) => [
      route.geometria,
      route.duracion,
      route.puntosRiesgo,
    ]),
  );
  assert.equal(result.trafico.disponible, false);
  assert.match(result.trafico.motivo, /cuota/);
});
test("tiempos por paso usan progreso TomTom y ETA parte de la consulta actual", () => {
  const route = planRoutes(input, [incident], now, roads, {
    influenciaVecina: 0,
  }).rutas.find((item) => item.criterios.includes("segura"));
  const traffic = response(route, 500),
    boundary = route.pasos[1].distanciaAcumulada;
  traffic.data.routes[0].progressPoints = [
    { distanceInMeters: 0, travelDurationInSeconds: 0 },
    { distanceInMeters: boundary, travelDurationInSeconds: 120 },
    { distanceInMeters: route.distancia, travelDurationInSeconds: 500 },
  ];
  const updated = applyTraffic(route, traffic);
  assert.equal(updated.pasos[1].duracionAcumulada, 120);
  assert.equal(updated.pasos[0].duracion, 120);
  assert.equal(updated.pasos.at(-1).duracionAcumulada, 500);
  assert.ok(
    Math.abs(
      updated.pasos.reduce((sum, step) => sum + step.duracion, 0) - 500,
    ) < 0.0001,
  );
  const exactStart = planRoutes(
    { ...input, origen: { latitud: -14.067, longitud: -75.729 } },
    [],
    now,
    roads,
  ).rutas[0];
  assert.equal(exactStart.pasos[0].tipo, "salida");
});
test("TomTom no se consulta para caminar o bici y rutas ajenas al trazado se rechazan", async () => {
  const client = {
    route: async () => {
      throw new Error("no debe llamarse");
    },
  };
  for (const mode of ["walking", "cycling"]) {
    const result = await planRoutesWithTraffic({ ...input, modo: mode }, [], {
      client,
      roads,
      now,
    });
    assert.equal(result.trafico.disponible, false);
  }
  const route = planRoutes(input, [], now, roads).rutas[0];
  const raw = response(route, 10).data.routes[0];
  assert.equal(pathMatches(route, raw), true);
  assert.equal(
    pathMatches(route, {
      ...raw,
      path: {
        type: "LineString",
        coordinates: [...route.geometria.coordinates].reverse(),
      },
    }),
    false,
  );
  assert.equal(
    pathMatches(route, {
      ...raw,
      sections: { travelMode: [{ travelMode: "other" }] },
    }),
    false,
  );
  assert.equal(
    pathMatches(route, {
      ...raw,
      path: {
        type: "LineString",
        coordinates: [
          route.geometria.coordinates[0],
          [-75.73, -14.064],
          route.geometria.coordinates.at(-1),
        ],
      },
    }),
    false,
  );
});
