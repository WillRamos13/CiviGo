"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRoads } = require("../src/lib/roads");
const { planRoutes } = require("../src/lib/navigation");
const {
  permitsNode,
  restrictionValue,
  turnController,
  parseTurnRestrictions,
} = require("../src/lib/navigation-restrictions");
const { QUERY } = require("../scripts/import-roads");

function fixture({ restriction = null, barrier = null } = {}) {
  const points = {
    1: [-75.729, -14.067],
    2: [-75.727, -14.067],
    3: [-75.727, -14.066],
    4: [-75.729, -14.066],
    5: [-75.728, -14.067],
    101: [-75.74, -14.08],
    102: [-75.71, -14.08],
    103: [-75.71, -14.05],
    104: [-75.74, -14.05],
  };
  const elements = Object.entries(points).map(([id, [lon, lat]]) => ({
    type: "node",
    id: Number(id),
    lon,
    lat,
    ...(id === "5" && barrier ? { tags: barrier } : {}),
  }));
  for (const [id, nodes] of [
    [10, [1, 5, 2]],
    [20, [2, 3]],
    [30, [3, 4]],
    [40, [4, 1]],
  ])
    elements.push({ type: "way", id, nodes, tags: { highway: "residential" } });
  elements.push({ type: "way", id: 99, nodes: [101, 102, 103, 104, 101] });
  elements.push({
    type: "relation",
    id: 100,
    tags: { "pe:ubigeo": "1101", admin_level: "6" },
    members: [{ type: "way", ref: 99, role: "outer" }],
  });
  if (restriction)
    elements.push({
      type: "relation",
      id: 200,
      tags: { type: "restriction", ...restriction },
      members: [
        { type: "way", ref: 10, role: "from" },
        { type: "node", ref: 2, role: "via" },
        { type: "way", ref: 20, role: "to" },
      ],
    });
  return parseRoads({ elements });
}
const trip = {
  origen: { longitud: -75.7289, latitud: -14.067 },
  destino: { longitud: -75.727, latitud: -14.0665 },
  modo: "driving",
};

test("routing avoids forbidden node turns, but respects bicycle exceptions and pedestrian scope", () => {
  const roads = fixture({
    restriction: { restriction: "no_left_turn", except: "bicycle" },
  });
  assert.equal(roads.restrictions.length, 1);
  const drive = planRoutes(trip, [], new Date(), roads).rutas[0];
  assert.ok(
    drive.geometria.coordinates.some(
      ([lon, lat]) => lon === -75.729 && lat === -14.066,
    ),
  );
  for (const modo of ["cycling", "walking"]) {
    const result = planRoutes({ ...trip, modo }, [], new Date(), roads)
      .rutas[0];
    assert.ok(result.distancia + 100 < drive.distancia);
    assert.ok(
      result.geometria.coordinates.some(
        ([lon, lat]) => lon === -75.727 && lat === -14.067,
      ),
    );
  }
});

test("tagged barriers split a way and prevent driving through its interior", () => {
  const roads = fixture({
    barrier: { barrier: "bollard", motor_vehicle: "no" },
  });
  assert.equal(roads.segments.filter((s) => s.osmId === 10).length, 2);
  const input = { ...trip, destino: { longitud: -75.7271, latitud: -14.067 } };
  const drive = planRoutes(input, [], new Date(), roads).rutas[0];
  const walk = planRoutes({ ...input, modo: "walking" }, [], new Date(), roads)
    .rutas[0];
  assert.ok(drive.distancia > walk.distancia * 2);
  assert.equal(
    permitsNode({ access: "private", foot: "yes" }, "walking"),
    true,
  );
  assert.equal(permitsNode({ barrier: "cycle_barrier" }, "cycling"), false);
  assert.equal(
    permitsNode({ barrier: "bollard", motorcar: "yes" }, "driving"),
    true,
  );
});

function edge(way, a = [0, 0], b = [1, 0]) {
  return { segment: { osmId: way }, coordinates: [a, b], length: 100 };
}
const rule = (value, overrides = {}) => ({
  tags: { restriction: value },
  from: ["10"],
  to: ["20"],
  node: "x",
  via: [],
  ...overrides,
});

test("same-way U-turn restrictions distinguish going straight from reversing", () => {
  const previous = edge(10, [0, 0], [1, 0]);
  for (const restriction of ["no_u_turn", "only_straight_on"]) {
    const controller = turnController(
      [rule(restriction, { to: ["10"] })],
      "driving",
    );
    assert.deepEqual(
      controller.next([], previous, "x", edge(10, [1, 0], [2, 0])),
      [],
    );
    assert.equal(
      controller.next([], previous, "x", edge(10, [1, 0], [0, 0])),
      null,
    );
  }
});

test("via-way restrictions retain state across split edges until the restricted exit", () => {
  const parsed = parseTurnRestrictions(
    [
      {
        type: "relation",
        id: 90,
        tags: { type: "restriction", restriction: "no_straight_on" },
        members: [
          { type: "way", role: "from", ref: 10 },
          { type: "way", role: "via", ref: 15 },
          { type: "way", role: "via", ref: 16 },
          { type: "way", role: "to", ref: 20 },
        ],
      },
    ],
    new Map([
      [10, { nodes: [1, 2] }],
      [15, { nodes: [2, 3] }],
      [16, { nodes: [3, 4] }],
      [20, { nodes: [4, 5] }],
    ]),
  );
  assert.deepEqual(parsed[0].entries, ["2"]);
  assert.deepEqual(parsed[0].via, ["15", "16"]);
  const controller = turnController(
    [rule("no_straight_on", { node: null, via: ["15", "16"], entries: ["x"] })],
    "driving",
  );
  const state = controller.next([], edge(10), "x", edge(15));
  assert.equal(state.length, 1);
  assert.deepEqual(
    controller.next(state, edge(15), "mid", edge(15, [1, 0], [2, 0])),
    state,
  );
  const next = controller.next(state, edge(15), "y", edge(16));
  assert.equal(controller.next(next, edge(16), "z", edge(20)), null);
  assert.deepEqual(controller.next(next, edge(16), "z", edge(30)), []);
  const only = turnController(
    [rule("only_straight_on", { node: null, via: ["15"], entries: ["x"] })],
    "driving",
  );
  assert.equal(only.next([], edge(10), "x", edge(30)), null);
  const entered = only.next([], edge(10), "x", edge(15));
  assert.equal(only.next(entered, edge(15), "y", edge(30)), null);
  assert.deepEqual(only.next(entered, edge(15), "y", edge(20)), []);
});

test("transport-specific and conditional restrictions have explicit conservative scope", () => {
  assert.equal(
    restrictionValue({ restriction: "no_left_turn" }, "walking"),
    null,
  );
  assert.equal(
    restrictionValue({ "restriction:foot": "no_entry" }, "walking"),
    "no_entry",
  );
  assert.equal(
    restrictionValue(
      { type: "restriction:bicycle", restriction: "no_right_turn" },
      "driving",
    ),
    null,
  );
  assert.equal(
    restrictionValue(
      { "restriction:conditional": "no_left_turn @ (Mo-Fr 08:00-10:00)" },
      "driving",
    ),
    "no_left_turn",
  );
  assert.match(QUERY, /restriction/);
  assert.match(QUERY, /out body qt/);
  assert.doesNotMatch(QUERY, /out skel/);
});
