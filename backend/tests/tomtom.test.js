"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createTomTomClient } = require("../src/lib/tomtom");
const {
  FREE_LIMITS,
  limits,
  createDatabaseQuota,
} = require("../src/lib/traffic-quota");
const { planRoutes } = require("../src/lib/navigation");
const { roads, input } = require("./helpers/navigation-fixtures");
const env = {
  TOMTOM_API_KEY: "private-fixture-never-real",
  TOMTOM_ENABLED: "true",
};
const route = () =>
  planRoutes(input, [], new Date("2026-10-08"), roads).rutas[0];
function quota(allowed = true) {
  return {
    reserve: async () => allowed,
    status: async () => ({ routing: { usadas: 0, limite: 20000 } }),
  };
}
test("falta clave, activación o cuota bloquea fetch sin revelar secretos", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error("unexpected");
  };
  for (const options of [
    { env: {} },
    { env: { ...env, TOMTOM_ENABLED: "false" } },
    { env },
    { env, quota: quota(false) },
    {
      env,
      quota: {
        reserve: async () => {
          throw new Error(env.TOMTOM_API_KEY);
        },
      },
    },
  ]) {
    const client = createTomTomClient({ ...options, fetchImpl });
    await assert.rejects(
      client.route(route()),
      (error) => !error.message.includes(env.TOMTOM_API_KEY),
    );
  }
  assert.equal(calls, 0);
});
test("Orbis v3 usa cabecera privada, POST de geometría local y cache concurrente", async () => {
  let calls = 0,
    reservations = 0,
    clock = new Date("2026-10-08");
  const client = createTomTomClient({
    env,
    quota: {
      reserve: async (product) => {
        reservations++;
        assert.equal(product, "routing");
        return true;
      },
    },
    now: () => clock,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(
        url,
        "https://api.tomtom.com/maps/orbis/routing/routes/calculate?apiVersion=3",
      );
      assert.equal(url.includes(env.TOMTOM_API_KEY), false);
      assert.equal(options.headers["TomTom-Api-Key"], env.TOMTOM_API_KEY);
      const body = JSON.parse(options.body);
      assert.equal(body.travelMode, "car");
      assert.equal(body.traffic, "live");
      assert.deepEqual(body.path, route().geometria);
      assert.equal(body.reconstructionMode, undefined);
      return new Response(JSON.stringify({ routes: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  await Promise.all([
    client.route(route()),
    client.route(route()),
    client.route(route()),
  ]);
  assert.equal(calls, 1);
  assert.equal(reservations, 1);
  await client.route(route());
  assert.equal(calls, 1);
  clock = new Date(+clock + 90001);
  await client.route(route());
  assert.equal(calls, 2);
});
test("diagnóstico nunca hace red ni imprime clave y límites no superan gratuidad", async () => {
  const client = createTomTomClient({
    env,
    quota: quota(),
    fetchImpl: () => assert.fail("diagnostic fetch"),
  });
  const report = await client.status();
  assert.equal(report.configurado, true);
  assert.equal(report.habilitado, true);
  assert.equal(report.conexionesProbadas, false);
  assert.equal(JSON.stringify(report).includes(env.TOMTOM_API_KEY), false);
  assert.deepEqual(FREE_LIMITS, {
    routing: 20000,
    incidents: 2500,
    tiles: 200000,
    search: 2500,
  });
  assert.deepEqual(
    limits({
      TOMTOM_MONTHLY_ROUTING_LIMIT: "999999",
      TOMTOM_MONTHLY_INCIDENTS_LIMIT: "garbage",
      TOMTOM_MONTHLY_TILES_LIMIT: "0",
    }),
    { routing: 20000, incidents: 0, tiles: 0, search: 2500 },
  );
});
test("error del proveedor es genérico, no devuelve payload y respeta enfriamiento", async () => {
  let calls = 0;
  const client = createTomTomClient({
    env,
    quota: quota(),
    fetchImpl: async () => {
      calls++;
      return new Response(env.TOMTOM_API_KEY, { status: 429 });
    },
  });
  await assert.rejects(
    client.route(route()),
    (error) =>
      error.code === "PROVIDER_RATE_LIMIT" &&
      !error.message.includes(env.TOMTOM_API_KEY),
  );
  await assert.rejects(client.route(route()), /limitó temporalmente/);
  assert.equal(calls, 1);
});
test("incidentes Orbis v2 consultan presentes y Flow v2 valida bytes PNG", async () => {
  const products = [];
  const client = createTomTomClient({
    env,
    quota: {
      reserve: async (product) => {
        products.push(product);
        return true;
      },
    },
    fetchImpl: async (url, options) => {
      assert.equal(options.headers["TomTom-Api-Key"], env.TOMTOM_API_KEY);
      if (url.includes("incidents/details")) {
        assert.ok(url.includes("apiVersion=2"));
        assert.ok(url.includes("timeValidity=present"));
        return new Response('{"incidents":[]}');
      }
      assert.match(url, /flow\/raster\/tile\/14\/4745\/8838\?apiVersion=2/);
      return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { "Content-Type": "image/png" },
      });
    },
  });
  await client.incidents([-75.8, -14.1, -75.7, -14]);
  const tile = await client.tile(14, 4745, 8838);
  assert.equal(Buffer.isBuffer(tile.data), true);
  assert.deepEqual(products, ["incidents", "tiles"]);
});

test("incident freshness defaults to five minutes, is configurable, and still reserves quota on refresh", async () => {
  let clock = new Date("2026-10-11T12:00:00Z"),
    calls = 0,
    reservations = 0;
  const client = createTomTomClient({
    env,
    now: () => clock,
    quota: {
      reserve: async (product) => {
        assert.equal(product, "incidents");
        reservations++;
        return true;
      },
    },
    fetchImpl: async () => {
      calls++;
      return new Response('{"incidents":[]}');
    },
  });
  const bounds = [-75.8, -14.1, -75.7, -14];
  assert.equal(client.configuration().frescuraIncidentesSegundos, 300);
  await client.incidents(bounds);
  clock = new Date(+clock + 299999);
  await client.incidents(bounds);
  assert.equal(calls, 1);
  clock = new Date(+clock + 2);
  await client.incidents(bounds);
  assert.equal(calls, 2);
  assert.equal(reservations, 2);
  for (const [value, expected] of [
    ["1", 60],
    ["600", 600],
    ["99999", 3600],
    ["invalid", 300],
  ]) {
    assert.equal(
      createTomTomClient({
        env: { ...env, TOMTOM_INCIDENT_CACHE_SECONDS: value },
      }).configuration().frescuraIncidentesSegundos,
      expected,
    );
  }
});
test("reserva SQL atómica cuenta intentos y deniega cuota agotada antes de red", async () => {
  let count = 0;
  const db = {
    $queryRaw: async (parts, ...values) => {
      const sql = parts.join("?");
      assert.match(sql, /ON CONFLICT/);
      assert.match(sql, /WHERE "ExternalApiUsage"\."usadas" </);
      const maximum = values.at(-1);
      assert.equal(values[0], "routing");
      assert.equal(values[1], "2026-10");
      return count < maximum ? [{ usadas: ++count }] : [];
    },
    externalApiUsage: {
      findMany: async () => [{ producto: "routing", usadas: count }],
    },
  };
  const control = createDatabaseQuota(db, {
    TOMTOM_MONTHLY_ROUTING_LIMIT: "1",
  });
  assert.equal(await control.reserve("routing", new Date("2026-10-08")), true);
  assert.equal(await control.reserve("routing", new Date("2026-10-08")), false);
  assert.equal(
    (await control.status(new Date("2026-10-08"))).routing.restantes,
    0,
  );
});

test("place search is predictive, limited to Peru and provincial bounds, cached before quota use", async () => {
  let calls = 0;
  const products = [];
  const client = createTomTomClient({
    env,
    quota: {
      reserve: async (product) => {
        products.push(product);
        return true;
      },
    },
    fetchImpl: async (url, options) => {
      calls++;
      const target = new URL(url);
      assert.equal(target.origin, "https://api.tomtom.com");
      assert.equal(
        decodeURIComponent(target.pathname),
        "/search/2/search/plaza de armas de ica.json",
      );
      assert.equal(target.searchParams.get("key"), env.TOMTOM_API_KEY);
      assert.equal(target.searchParams.get("countrySet"), "PE");
      assert.equal(target.searchParams.get("typeahead"), "true");
      assert.equal(target.searchParams.get("topLeft"), "-14.05,-75.74");
      assert.equal(target.searchParams.get("btmRight"), "-14.08,-75.71");
      assert.equal(target.searchParams.has("radius"), false);
      assert.equal(options.redirect, "error");
      return new Response('{"results":[]}');
    },
  });
  const bounds = { north: -14.05, south: -14.08, west: -75.74, east: -75.71 };
  await Promise.all([
    client.search("Plaza de Armas de Ica", bounds),
    client.search("Plaza de Armas de Ica", bounds),
  ]);
  await client.search("Plaza de Armas de Ica", bounds);
  await client.search("  PLÁZA  DE ARMAS DE ICA  ", bounds);
  assert.equal(calls, 1);
  assert.deepEqual(products, ["search"]);
  assert.equal(limits({ TOMTOM_MONTHLY_SEARCH_LIMIT: "99999" }).search, 2500);
  assert.equal(limits({ TOMTOM_MONTHLY_SEARCH_LIMIT: "invalid" }).search, 0);
  assert.equal(limits({ TOMTOM_MONTHLY_SEARCH_LIMIT: "0" }).search, 0);
});

test("search provider errors and exhausted quotas cannot leak a key or call the network", async () => {
  const bounds = { north: -14.05, south: -14.08, west: -75.74, east: -75.71 };
  const blocked = createTomTomClient({
    env,
    quota: quota(false),
    fetchImpl: () => assert.fail("Quota must be checked first"),
  });
  await assert.rejects(
    blocked.search("Missing place", bounds),
    (error) => error.code === "QUOTA_EXHAUSTED",
  );
  const failed = createTomTomClient({
    env,
    quota: quota(),
    fetchImpl: async () => {
      throw new Error(`url?key=${env.TOMTOM_API_KEY}`);
    },
  });
  await assert.rejects(
    failed.search("Missing place", bounds),
    (error) =>
      error.code === "PROVIDER_UNAVAILABLE" &&
      !error.message.includes(env.TOMTOM_API_KEY),
  );
});

test("a viewport burst queues distinct tiles and coalesces duplicates without exceeding four upstream calls", async () => {
  let active = 0,
    maximum = 0,
    requests = 0,
    reservations = 0;
  const releases = [];
  const client = createTomTomClient({
    env,
    quota: {
      reserve: async () => {
        reservations++;
        return true;
      },
    },
    fetchImpl: async () => {
      requests++;
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => releases.push(resolve));
      active--;
      return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    },
  });
  const pending = [
    ...Array.from({ length: 12 }, (_, x) => client.tile(14, x, 0)),
    client.tile(14, 0, 0),
  ];
  for (let batch = 0; batch < 3; batch++) {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases.length, 4);
    releases.splice(0).forEach((resolve) => resolve());
  }
  const responses = await Promise.all(pending);
  assert.equal(responses.length, 13);
  assert.equal(maximum, 4);
  assert.equal(requests, 12);
  assert.equal(reservations, 12);
});

test("tile authorization and rate limits are diagnosed safely and do not block route/search products", async () => {
  for (const [status, code] of [
    [403, "PROVIDER_AUTHORIZATION"],
    [429, "PROVIDER_RATE_LIMIT"],
    [400, "PROVIDER_REQUEST_REJECTED"],
    [503, "PROVIDER_UNAVAILABLE"],
  ]) {
    let clock = new Date("2026-10-13T12:00:00Z"),
      calls = 0;
    const client = createTomTomClient({
      env,
      quota: quota(),
      now: () => clock,
      fetchImpl: async (url) => {
        calls++;
        return url.includes("flow/raster")
          ? new Response(env.TOMTOM_API_KEY, {
              status,
              headers: { "Retry-After": "90" },
            })
          : new Response('{"routes":[]}');
      },
    });
    await assert.rejects(client.tile(14, 1, 1), (error) => error.code === code);
    await assert.rejects(client.tile(14, 2, 1), (error) => error.code === code);
    assert.equal(calls, 1);
    const report = await client.status();
    assert.equal(report.fallos.tiles.codigo, code);
    assert.equal(report.fallos.tiles.reintentarEn, "2026-10-13T12:01:30.000Z");
    assert.equal(JSON.stringify(report).includes(env.TOMTOM_API_KEY), false);
    await client.route(route());
    assert.equal(calls, 2);
    clock = new Date(+clock + 90001);
    assert.deepEqual((await client.status()).fallos, {});
  }
});

test("flow cache expires at the next refresh bucket and successful recovery clears its diagnostic", async () => {
  let clock = new Date("2026-10-13T12:01:59Z"),
    calls = 0,
    failed = true;
  const client = createTomTomClient({
    env,
    quota: quota(),
    now: () => clock,
    fetchImpl: async () => {
      calls++;
      return failed
        ? new Response("unavailable", { status: 503 })
        : new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    },
  });
  await assert.rejects(client.tile(14, 1, 1));
  assert.ok((await client.status()).fallos.tiles);
  failed = false;
  clock = new Date("2026-10-13T12:03:59Z");
  await client.tile(14, 1, 1);
  assert.deepEqual((await client.status()).fallos, {});
  assert.equal(
    (await client.status()).ultimaActualizacion.tiles,
    clock.toISOString(),
  );
  await client.tile(14, 1, 1);
  assert.equal(calls, 2);
  clock = new Date("2026-10-13T12:04:00Z");
  await client.tile(14, 1, 1);
  assert.equal(calls, 3);
});
