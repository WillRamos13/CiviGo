"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  planRoutesWithTraffic,
  createTrafficService,
} = require("../src/lib/navigation-traffic");
const { closureExclusions } = require("../src/lib/navigation-closures");
const { roads, input } = require("./helpers/navigation-fixtures");
const now = new Date("2026-10-11T12:00:00Z");
const closure = {
  id: "tomtom:closed",
  externoId: "closed",
  fuente: "TOMTOM",
  tipo: "calle-bloqueada",
  temporal: true,
  inicio: "2026-10-11T11:00:00Z",
  fin: "2026-10-11T13:00:00Z",
  geometria: {
    type: "LineString",
    coordinates: [
      [-75.7286, -14.067],
      [-75.7274, -14.067],
    ],
  },
};

test("an active matched road closure detours cars without adding risk or persisting events", async () => {
  const result = await planRoutesWithTraffic(input, [], {
    roads,
    now,
    trafficIncidents: [closure],
  });
  for (const route of result.rutas) {
    assert.ok(route.distancia > 450);
    assert.ok(
      route.geometria.coordinates.some(
        ([lon, lat]) => lon === -75.729 && lat === -14.066,
      ),
    );
    assert.equal(route.puntosRiesgo, 0);
    assert.ok(route.advertencias.some((w) => w.includes("cierres temporales")));
  }
  const walking = await planRoutesWithTraffic(
    { ...input, modo: "walking" },
    [],
    { roads, now, trafficIncidents: [closure] },
  );
  assert.ok(walking.rutas[0].distancia < 210);
  const reverse = await planRoutesWithTraffic(
    { ...input, origen: input.destino, destino: input.origen },
    [],
    { roads, now, trafficIncidents: [closure] },
  );
  assert.ok(reverse.rutas[0].distancia > 450);
});

test("expired, future, lane-only and unmatched closures do not fabricate blocked streets", async () => {
  for (const event of [
    { ...closure, fin: now.toISOString() },
    { ...closure, inicio: "2026-10-12T12:00:00Z" },
    { ...closure, tipo: "carril-cerrado" },
    {
      ...closure,
      geometria: {
        type: "LineString",
        coordinates: [
          [-75.728, -14.0675],
          [-75.728, -14.0665],
        ],
      },
    },
    {
      ...closure,
      geometria: { type: "Point", coordinates: [-75.728, -14.067] },
    },
  ]) {
    const result = await planRoutesWithTraffic(input, [], {
      roads,
      now,
      trafficIncidents: [event],
    });
    assert.ok(result.rutas[0].distancia < 210);
  }
  const index = closureExclusions([closure], roads, now);
  assert.equal(
    index.blocks(roads.segments[0], [
      [-75.729, -14.067],
      [-75.7288, -14.067],
    ]),
    false,
  );
  assert.equal(
    index.blocks(roads.segments[1], roads.segments[1].coordinates),
    false,
  );
});

test("a traffic ETA outage retains known exclusions and human moderation removes them", async () => {
  let hidden = [],
    requests = 0;
  const service = createTrafficService({
    roads,
    now: () => now,
    db: { externalTrafficModeration: { findMany: async () => hidden } },
    client: {
      incidents: async () => ({
        actualizadoEn: now.toISOString(),
        data: {
          incidents: [
            {
              type: "Feature",
              geometry: closure.geometria,
              properties: {
                id: "closed",
                iconCategory: "roadClosed",
                timeValidity: "present",
                startTime: closure.inicio,
                endTime: closure.fin,
              },
            },
          ],
        },
      }),
      route: async () => {
        requests++;
        throw new Error("Sin tráfico actualizado.");
      },
    },
  });
  const result = await service.plan(input, []);
  assert.ok(requests > 0);
  assert.ok(result.rutas[0].distancia > 450);
  assert.equal(result.trafico.disponible, false);
  hidden = [{ externoId: "closed" }];
  assert.ok((await service.plan(input, [])).rutas[0].distancia < 210);
});
