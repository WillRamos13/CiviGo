const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { once } = require("node:events");
test("Road geometry is independently cacheable; unchanged compact risk shares computation", async (t) => {
  const roads = {};
  let calls = 0;
  const dependencies = {
    getRoads: () => roads,
    coveredSegments: () => [
      {
        id: "a",
        nombre: "Calle A",
        coordinates: [
          [-75, -14],
          [-75.01, -14.01],
        ],
      },
      {
        id: "b",
        nombre: "Calle B",
        coordinates: [
          [-75.1, -14],
          [-75.11, -14.01],
        ],
      },
    ],
    incidents: async () => {
      calls++;
      return [];
    },
    config: async () => ({}),
    scoreSegments: (rows) =>
      rows.map((s, i) => ({
        ...s,
        points: i ? 0 : 3,
        level: i ? 0 : 1,
        pending: false,
      })),
  };
  const app = express();
  app.use(require("../src/routes/road-map")(dependencies));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = "http://127.0.0.1:" + server.address().port;
  const geometry = await fetch(url + "/geometry");
  const data = await geometry.json();
  assert.equal(data.features.length, 2);
  assert.match(geometry.headers.get("cache-control"), /max-age=3600/);
  assert.equal(
    (
      await fetch(url + "/geometry", {
        headers: { "If-None-Match": geometry.headers.get("etag") },
      })
    ).status,
    304,
  );
  const snapshots = await Promise.all([
    fetch(url + "/risk").then((r) => r.json()),
    fetch(url + "/risk").then((r) => r.json()),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.equal(snapshots[0].version, data.version);
  assert.deepEqual(snapshots[0].values, [["a", 3, 1, false]]);
  assert.equal(JSON.stringify(snapshots).includes("coordinates"), false);
});
test("Viewport and cursor are validated before querying incidents", () => {
  const { mapQuery } = require("../src/lib/map-query");
  assert.equal(mapQuery({}), null);
  assert.deepEqual(
    mapQuery({ bbox: "-76,-15,-75,-14", after: "500" }).where.id,
    { lt: 500 },
  );
  for (const query of [
    { bbox: "NaN,1,2,3" },
    { bbox: "0,0,0,1" },
    { bbox: "-200,-15,0,0" },
    { bbox: "0,0,1,1", after: "-2" },
  ])
    assert.throws(() => mapQuery(query), { status: 400 });
});
