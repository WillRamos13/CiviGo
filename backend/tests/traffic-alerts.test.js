"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  normalizeTrafficIncidents,
  deduplicateTrafficAlerts,
} = require("../src/lib/traffic-alerts");
const {
  createTrafficService,
  incidentBounds,
  provinceBounds,
  intersectsTile,
} = require("../src/lib/navigation-traffic");
const { planRoutes } = require("../src/lib/navigation");
const { roads, input, incident } = require("./helpers/navigation-fixtures");
const now = new Date("2026-10-08T11:00:00Z");
const feature = (id = "event-a", overrides = {}) => ({
  type: "Feature",
  properties: {
    id,
    iconCategory: "accident",
    events: [{ description: "Accidente en la vía" }],
    startTime: "2026-10-08T10:00:00Z",
    endTime: null,
    timeValidity: "present",
    delayInSeconds: 40,
    ...overrides,
  },
  geometry: {
    type: "LineString",
    coordinates: [
      [-75.7285, -14.067],
      [-75.7275, -14.067],
    ],
  },
});
const normalized = () =>
  normalizeTrafficIncidents([feature()], roads, now.toISOString(), now);
test("avisos son temporales identificados por fuente, sin riesgo histórico ni credibilidad", () => {
  const events = normalized();
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "tomtom:event-a");
  assert.equal(events[0].externoId, "event-a");
  assert.equal(events[0].fuente, "TOMTOM");
  assert.equal(events[0].temporal, true);
  assert.equal(events[0].afectaRiesgo, false);
  assert.equal(events[0].tramoId, "ab");
  assert.equal(events[0].rumbo, 90);
  for (const key of [
    "nivelRiesgo",
    "validacion",
    "reputacion",
    "usuarioId",
    "puntos",
  ])
    assert.equal(events[0][key], undefined);
  const before = planRoutes(input, [incident], now, roads);
  // Provider events are never passed into the CiviGo scoring function.
  deduplicateTrafficAlerts(events, [incident], roads, [], now);
  assert.deepEqual(planRoutes(input, [incident], now, roads), before);
});
test("caducados/futuros/inválidos/IDs repetidos se retiran incluso desde caché", () => {
  const features = [
    feature(),
    feature(),
    feature("expired", { endTime: "2026-10-08T10:30:00Z" }),
    feature("future", { startTime: "2026-10-09T00:00:00Z" }),
    feature("planned", { timeValidity: "future" }),
    {
      ...feature("invalid"),
      geometry: { type: "Point", coordinates: [NaN, 0] },
    },
  ];
  assert.equal(
    normalizeTrafficIncidents(features, roads, now.toISOString(), now).length,
    1,
  );
  assert.equal(
    normalizeTrafficIncidents(
      [feature("expiring", { endTime: "2026-10-08T11:01:00Z" })],
      roads,
      now.toISOString(),
      new Date(+now + 120000),
    ).length,
    0,
  );
});
test("dedup usa tipo + tramo + horario + sentido y no mezcla antecedentes", () => {
  const events = normalized();
  assert.equal(
    deduplicateTrafficAlerts(events, [incident], roads, [], now).length,
    0,
  );
  for (const civic of [
    { ...incident, tipo: "robo" },
    { ...incident, historico: true, estado: "RESUELTO" },
    { ...incident, fuente: "ANTECEDENTE_POLICIAL" },
    { ...incident, estado: "RESUELTO" },
    { ...incident, fechaEvento: "2026-10-07T00:00:00Z" },
    { ...incident, rumbo: 270 },
    { ...incident, latitud: -14.066 },
  ])
    assert.equal(
      deduplicateTrafficAlerts(events, [civic], roads, [], now).length,
      1,
    );
  assert.equal(
    deduplicateTrafficAlerts(events, [], roads, [{ externoId: "event-a" }], now)
      .length,
    0,
  );
  const duplicate = normalizeTrafficIncidents(
    [feature("event-a"), feature("event-b")],
    roads,
    now.toISOString(),
    now,
  );
  assert.equal(
    deduplicateTrafficAlerts(duplicate, [], roads, [], now).length,
    1,
  );
  const opposite = { ...duplicate[1], rumbo: 270 };
  assert.equal(
    deduplicateTrafficAlerts([duplicate[0], opposite], [], roads, [], now)
      .length,
    2,
  );
});
test("moderación se consulta cada vez y falla cerrado sin exponer errores internos", async () => {
  let hidden = [],
    fail = false;
  const service = createTrafficService({
    roads,
    now: () => now,
    client: {
      incidents: async () => ({
        data: { incidents: [feature()] },
        actualizadoEn: now.toISOString(),
      }),
    },
    db: {
      externalTrafficModeration: {
        findMany: async () => {
          if (fail) throw new Error("secret-connection-url");
          return hidden;
        },
      },
    },
  });
  assert.equal((await service.incidents()).incidentes.length, 1);
  hidden = [{ externoId: "event-a" }];
  assert.equal((await service.incidents()).incidentes.length, 0);
  fail = true;
  const result = await service.incidents();
  assert.equal(result.incidentes.length, 0);
  assert.equal(result.trafico.disponible, false);
  assert.equal(JSON.stringify(result).includes("secret-connection-url"), false);
});
test("consulta siempre cajas fijas y filtro de viewport no añade consultas diferentes", async () => {
  const boxes = [];
  const service = createTrafficService({
    roads,
    now: () => now,
    client: {
      incidents: async (bbox) => {
        boxes.push(bbox);
        return {
          data: { incidents: [feature()] },
          actualizadoEn: now.toISOString(),
        };
      },
    },
    db: { externalTrafficModeration: { findMany: async () => [] } },
  });
  const all = await service.incidents([], null);
  assert.equal(all.incidentes.length, 1);
  const outside = await service.incidents([], [-75.74, -14.08, -75.73, -14.07]);
  assert.equal(outside.incidentes.length, 0);
  assert.deepEqual(boxes[0], boxes[1]);
  const actual = require("../src/lib/roads").getRoads();
  const partition = incidentBounds(actual);
  assert.ok(partition.length >= 2);
  for (const box of partition)
    assert.ok(
      (box[2] - box[0]) *
        (box[3] - box[1]) *
        111.32 ** 2 *
        Math.cos(((box[1] + box[3]) * Math.PI) / 360) <=
        10000,
    );
  assert.deepEqual(
    [
      partition[0][0],
      partition[0][1],
      partition.at(-1)[2],
      partition.at(-1)[3],
    ],
    provinceBounds(actual),
  );
});
test("proxy de teselas admite Ica y rechaza coordenadas ajenas antes de proveedor", async () => {
  let calls = 0;
  const service = createTrafficService({
    roads,
    client: {
      tile: async () => {
        calls++;
        return { data: Buffer.alloc(0), actualizadoEn: now.toISOString() };
      },
    },
  });
  const z = 14,
    lon = -75.728,
    lat = -14.067,
    x = Math.floor(((lon + 180) / 360) * 2 ** z),
    y = Math.floor(
      ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) *
        2 ** z,
    );
  assert.equal(intersectsTile(z, x, y, provinceBounds(roads)), true);
  await service.tile(z, x, y);
  assert.equal(calls, 1);
  for (const triple of [
    [-1, 0, 0],
    [14, 0, 0],
    [14, x + 0.2, y],
    [23, x, y],
    [14, 999999, y],
  ])
    await assert.rejects(
      service.tile(...triple),
      (error) => error.status === 400,
    );
  assert.equal(calls, 1);
});
