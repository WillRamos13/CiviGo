"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { importRoads } = require("../scripts/import-roads");
function dataset() {
  return {
    elements: [
      { type: "node", id: 1, lon: -75.74, lat: -14.08 },
      {
        type: "node",
        id: 2,
        lon: -75.71,
        lat: -14.08,
        tags: { barrier: "bollard" },
      },
      { type: "node", id: 3, lon: -75.71, lat: -14.05 },
      { type: "node", id: 4, lon: -75.74, lat: -14.05 },
      {
        type: "way",
        id: 10,
        nodes: [1, 2, 3],
        tags: { highway: "residential" },
      },
      { type: "way", id: 20, nodes: [1, 2, 3, 4, 1] },
      {
        type: "relation",
        id: 100,
        tags: { admin_level: "6" },
        members: [{ type: "way", ref: 20, role: "outer" }],
      },
      {
        type: "relation",
        id: 200,
        tags: { type: "restriction", restriction: "no_u_turn" },
        members: [
          { type: "way", ref: 10, role: "from" },
          { type: "node", ref: 2, role: "via" },
          { type: "way", ref: 10, role: "to" },
        ],
      },
    ],
  };
}
test("road import preserves restrictions/node tags and replaces only complete downloads", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "civigo-road-import-"),
  );
  const destination = path.join(directory, "roads.json"),
    previousFetch = global.fetch;
  try {
    await fs.writeFile(destination, "previous dataset");
    for (const incomplete of [
      { ...dataset(), remark: "runtime timeout" },
      { elements: dataset().elements.filter((e) => e.type !== "relation") },
    ]) {
      global.fetch = async () => new Response(JSON.stringify(incomplete));
      await assert.rejects(
        importRoads({
          endpoint: "https://fixture.invalid/overpass",
          destination,
        }),
      );
      assert.equal(await fs.readFile(destination, "utf8"), "previous dataset");
    }
    global.fetch = async () => new Response(JSON.stringify(dataset()));
    const result = await importRoads({
      endpoint: "https://fixture.invalid/overpass",
      destination,
    });
    assert.equal(result.restricciones, 1);
    assert.equal(result.nodosConEtiquetas, 1);
    assert.equal(
      JSON.parse(await fs.readFile(destination, "utf8")).elements.length,
      8,
    );
    assert.deepEqual(await fs.readdir(directory), ["roads.json"]);
  } finally {
    global.fetch = previousFetch;
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("civigo-road-import-"));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
