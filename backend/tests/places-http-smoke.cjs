// Run manually while the local Next frontend forwards to fixture port 55709.
// This mounts the real router/catalog with no database or provider requests.
const assert = require("node:assert/strict");
const express = require("express");
const { once } = require("node:events");
process.env.TOMTOM_ENABLED = "false";
process.env.TOMTOM_API_KEY = "";
const router = require("../src/routes/navigation");
const db = require("../src/lib/db");
db.$queryRaw = () => assert.fail("Local search must not access the database");
const app = express();
app.use("/api/navigation", router);
app.use((error, _request, response, _next) =>
  response
    .status(error.status || 500)
    .json({ error: "Solicitud inválida", code: error.code }),
);
const port = Number(process.env.CIVIGO_PLACES_HTTP_PORT || 55709);
const frontend = `http://127.0.0.1:${Number(process.env.CIVIGO_MAP_SMOKE_FRONTEND_PORT || 55710)}`;
let server;
async function run() {
  server = app.listen(port, "127.0.0.1");
  await once(server, "listening");
  const endpoints = [`http://127.0.0.1:${port}`, frontend];
  let checks = 0;
  for (const origin of endpoints) {
    for (const [query, expected] of [
      ["plaza de armas de ica", "Plaza de Armas de Ica"],
      ["plaza armas ica", "Plaza de Armas de Ica"],
      ["laguna huacachina", "Laguna de Huacachina"],
      ["universidad san luis gonzaga", "Universidad Nacional San Luis Gonzaga"],
      ["av. grau", "Avenida Grau"],
      ["hospital regional", "Hospital Regional de Ica"],
    ]) {
      const response = await fetch(
        `${origin}/api/navigation/places?q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(10000) },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const places = await response.json();
      assert.equal(places[0].nombre, expected);
      assert.ok(
        Number.isFinite(places[0].latitud) &&
          Number.isFinite(places[0].longitud),
      );
      assert.ok(places.length <= 12);
      checks++;
    }
    for (const query of ["ab", "x".repeat(161)]) {
      const response = await fetch(
        `${origin}/api/navigation/places?q=${query}`,
        { signal: AbortSignal.timeout(10000) },
      );
      assert.equal(response.status, 400);
      checks++;
    }
    const empty = await fetch(`${origin}/api/navigation/places?q=!!!`, {
      signal: AbortSignal.timeout(10000),
    });
    assert.deepEqual(await empty.json(), []);
    checks++;
  }
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      realRouter: true,
      realCatalog: true,
      databaseOrProviderCalls: false,
    }),
  );
}
run()
  .then(() => server.close())
  .catch((error) => {
    console.error(error.stack);
    server?.close();
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
