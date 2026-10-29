const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  { EventEmitter } = require("node:events");
const {
  createTelemetry,
  percentile,
  routeFamily,
} = require("../src/lib/telemetry");
function fixture() {
  const rows = new Map();
  let clock = Date.parse("2026-10-28T14:00:00Z");
  const db = {
    appConfig: {
      upsert: async ({ where, create, update }) =>
        rows.set(
          where.clave,
          structuredClone(rows.has(where.clave) ? update : create),
        ),
      findMany: async () => [...rows.values()],
      deleteMany: async () => ({ count: 0 }),
    },
    $queryRaw: async () => [{ one: 1 }],
  };
  return {
    rows,
    db,
    get clock() {
      return clock;
    },
    tick: (n) => {
      clock += n;
    },
    service: createTelemetry({ db, now: () => clock }),
  };
}
test("telemetry validates finite values, coarse pages and UUIDs; never stores supplied identity, text or location", async () => {
  const f = fixture(),
    body = {
      session: randomUUID(),
      pageId: randomUUID(),
      path: "/mapa",
      platform: "web",
      visible: true,
      vitals: { lcp: 2000, ttfb: 100, cls: 0.1 },
      correo: "SECRET_EMAIL",
      latitud: 123,
      usuarioId: 999,
    };
  f.service.client(body, { id: 7 });
  f.service.client(body, { id: 7 });
  await f.service.persist();
  const raw = JSON.stringify([...f.rows.values()]);
  assert.ok(!raw.includes("SECRET_EMAIL"));
  assert.ok(!raw.includes("latitud"));
  assert.ok(!raw.includes("usuarioId"));
  const result = await f.service.snapshot();
  assert.equal(result.online.users, 1);
  assert.equal(result.api.views, 1);
  assert.equal(result.pages[0].samples, 1);
  assert.equal(result.pages[0].lcp, 2000);
  assert.ok(!JSON.stringify(result).includes("u:"));
  for (const bad of [
    { ...body, path: "/mapa?secret=1" },
    { ...body, session: "bad" },
    { ...body, visible: "true" },
  ])
    assert.throws(() => f.service.client(bad), /Métrica inválida/);
  f.tick(121000);
  assert.equal((await f.service.snapshot()).online.users, 0);
});
test("two tabs count one account; hiding one tab does not hide the other", async () => {
  const f = fixture(),
    a = {
      session: randomUUID(),
      pageId: randomUUID(),
      path: "/mapa",
      platform: "web",
      visible: true,
    },
    b = { ...a, session: randomUUID() };
  f.service.client(a, { id: 7 });
  f.service.client(b, { id: 7 });
  f.service.client({ ...a, visible: false }, { id: 7 });
  assert.equal((await f.service.snapshot()).online.users, 1);
  f.service.client({ ...b, visible: false }, { id: 7 });
  assert.equal((await f.service.snapshot()).online.users, 0);
});
test("API counts status classes by bounded service family and reports histogram limits without paths or query strings", async () => {
  const f = fixture();
  for (const code of [200, 404, 503]) {
    const res = new EventEmitter();
    res.statusCode = code;
    f.service.middleware(
      { path: "/api/reports/123?secret=private" },
      res,
      () => {},
    );
    res.emit("finish");
  }
  const s = await f.service.snapshot();
  assert.equal(s.api.count, 3);
  assert.equal(s.api.errors, 1);
  assert.equal(s.api.clientErrors, 1);
  assert.equal(s.api.errorPercent, 33.33);
  assert.equal(s.routes[0].label, "reports");
  assert.equal(routeFamily("/api/evil/secret"), "otros");
  assert.equal(percentile([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.95), null);
  assert.ok(!JSON.stringify(s).includes("private"));
});
test("metrics persist across instances, never double add a snapshot, and do not break API requests during DB failure", async () => {
  const f = fixture();
  f.service.client(
    {
      session: randomUUID(),
      pageId: randomUUID(),
      path: "/mapa",
      platform: "web",
      visible: true,
    },
    null,
  );
  await f.service.persist();
  await f.service.persist();
  const other = createTelemetry({ db: f.db, now: () => f.clock });
  assert.equal((await other.snapshot()).api.views, 1);
  f.db.appConfig.upsert = async () => {
    throw Object.assign(new Error("PRIVATE_DATABASE_STRING"), {
      code: "TEST_OFFLINE",
    });
  };
  await assert.doesNotReject(f.service.persist());
});
