const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseNearbyIncidentQuery,
  publicIncidentWhere,
  isVisiblePublicIncident,
  findNearbyRecentIncidents,
  nearbyBounds,
  CANDIDATE_PAGE_SIZE,
} = require("../src/lib/recent-incidents");
const { publicIncidentEligibility } = require("../src/lib/publication");
const origin = { latitud: -14.0678, longitud: -75.7286 };
const now = new Date("2026-10-08T12:00:00Z");
const north = (meters) => ({
  ...origin,
  latitud: origin.latitud + ((meters / 6371000) * 180) / Math.PI,
});
const row = (id, values = {}) => ({
  id,
  tipo: "Robo",
  tipoCatalogo: { slug: "robo" },
  ...origin,
  publicado: true,
  estado: "ACTIVO",
  historico: false,
  fechaCreacion: new Date("2026-10-01T12:00:00Z"),
  fechaEvento: now,
  ...values,
});
function database(rows, hydration = rows) {
  const calls = [];
  return {
    calls,
    incident: {
      findMany: async (query) => {
        calls.push(query);
        if (query.include)
          return hydration.filter((row) => query.where.id.in.includes(row.id));
        return rows
          .filter((row) => row.id > query.where.id.gt)
          .sort((a, b) => a.id - b.id)
          .slice(0, query.take);
      },
    },
  };
}

test("Nearby query requires both valid GPS coordinates and preserves map queries without GPS", () => {
  assert.equal(parseNearbyIncidentQuery({ tipo: "robo" }), null);
  assert.deepEqual(
    parseNearbyIncidentQuery({
      latitud: "-14.0678",
      longitud: "-75.7286",
      tipo: "Róbo",
    }),
    { position: origin, tipo: "robo" },
  );
  for (const query of [
    { latitud: "-14" },
    { longitud: "-75" },
    { latitud: "", longitud: "-75" },
    { latitud: "100", longitud: "-75" },
    { latitud: "-14", longitud: "181" },
    { latitud: "NaN", longitud: "-75" },
    { latitud: ["-14", "-15"], longitud: "-75" },
    { latitud: "-14", longitud: "-75", tipo: ["robo"] },
  ])
    assert.throws(
      () => parseNearbyIncidentQuery(query),
      (error) => error.status === 400,
    );
});

test("Public visibility keeps verified contributors and active administrative historical incidents", () => {
  const where = publicIncidentWhere(now);
  assert.equal(where.publicado, true);
  assert.deepEqual(where.AND, [publicIncidentEligibility()]);
  assert.equal(
    where.OR[1].fechaEvento.gte.toISOString(),
    "2023-10-08T12:00:00.000Z",
  );
  assert.equal(
    isVisiblePublicIncident(row(1, { estado: "RESUELTO" }), now),
    false,
  );
  assert.equal(
    isVisiblePublicIncident(
      row(1, { estado: "RESUELTO", historico: true }),
      now,
    ),
    true,
  );
  assert.equal(
    isVisiblePublicIncident(
      row(1, { historico: true, fechaEvento: new Date("2022-01-01") }),
      now,
    ),
    false,
  );
  assert.equal(
    isVisiblePublicIncident(
      row(1, { historico: true, fechaEvento: new Date("2027-01-01") }),
      now,
    ),
    false,
  );
});

test("Near radius bounds contain one-km points and handle date line and polar GPS", () => {
  const bounds = nearbyBounds(origin);
  assert.ok(bounds.latitud.gte < north(-999.9).latitud);
  assert.ok(bounds.latitud.lte > north(999.9).latitud);
  assert.equal(nearbyBounds({ latitud: 0, longitud: 179.999 }).OR.length, 2);
  assert.equal(nearbyBounds({ latitud: 0, longitud: -179.999 }).OR.length, 2);
  assert.equal(
    nearbyBounds({ latitud: 89.999, longitud: 0 }).longitud,
    undefined,
  );
});

test("Recent query scans beyond 500 lightweight rows, orders publication and hydrates only the latest ten", async () => {
  const rows = Array.from({ length: 511 }, (_, index) =>
    row(index + 1, {
      fechaCreacion: new Date(+now - index * 60000),
      fechaPublicacion:
        index < 500 ? new Date("2026-09-01") : new Date(+now + index * 1000),
    }),
  );
  rows.push(
    row(512, { ...north(1000.1), fechaPublicacion: new Date(+now + 999000) }),
  );
  const db = database(rows);
  const include = { reportes: { include: { usuario: true, adjuntos: true } } };
  const selected = await findNearbyRecentIncidents(
    db,
    { position: origin, tipo: "robo" },
    include,
    now,
  );
  assert.deepEqual(
    selected.map((row) => row.id),
    [511, 510, 509, 508, 507, 506, 505, 504, 503, 502],
  );
  const minimal = db.calls.filter((call) => call.select);
  assert.equal(minimal.length, 3);
  assert.ok(
    minimal.every(
      (call) =>
        call.take === CANDIDATE_PAGE_SIZE &&
        !call.include &&
        !call.select.reportes &&
        !call.select.descripcion,
    ),
  );
  assert.deepEqual(minimal[0].where.AND[0], publicIncidentEligibility());
  const hydrate = db.calls.at(-1);
  assert.equal(hydrate.where.id.in.length, 10);
  assert.deepEqual(hydrate.include, include);
});

test("Selection excludes square corners, mismatched legacy types and expired history before limiting", async () => {
  const rows = [
    row(1, { tipoCatalogo: null, tipo: "Intento de róbo", ...north(999.9) }),
    row(2, { tipoCatalogo: null, tipo: "Intento de robo", ...north(1000.1) }),
    row(3, { tipoCatalogo: null, tipo: "Inundación" }),
    row(4, {
      tipoCatalogo: null,
      tipo: "Intento de robo",
      historico: true,
      fechaEvento: new Date("2022-01-01"),
    }),
    row(5, { tipoCatalogo: null, tipo: "Intento de robo", latitud: NaN }),
  ];
  assert.deepEqual(
    (
      await findNearbyRecentIncidents(
        database(rows),
        { position: origin, tipo: "intento-de-robo" },
        {},
        now,
      )
    ).map((row) => row.id),
    [1],
  );
});

test("Nullable publication falls back to creation, ties use descending id, and hydration rechecks removals", async () => {
  const rows = [
    row(1),
    row(2),
    row(3, { fechaCreacion: new Date("2026-10-02") }),
    row(4, { fechaPublicacion: new Date("2026-10-03") }),
  ];
  assert.deepEqual(
    (
      await findNearbyRecentIncidents(
        database(rows),
        { position: origin, tipo: "" },
        {},
        now,
      )
    ).map((row) => row.id),
    [4, 3, 2, 1],
  );
  assert.deepEqual(
    (
      await findNearbyRecentIncidents(
        database(
          rows,
          rows.map((value) =>
            value.id === 4 ? { ...value, publicado: false } : value,
          ),
        ),
        { position: origin, tipo: "" },
        {},
        now,
      )
    ).map((row) => row.id),
    [3, 2, 1],
  );
});
