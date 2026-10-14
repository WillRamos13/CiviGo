"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  statisticsPeriod,
  statisticsFilters,
  deltaPercent,
} = require("../src/lib/admin-statistics");
const {
  COLUMNS,
  projectRow,
  createExportService,
} = require("../src/lib/admin-exports");

test("Peru month windows use the event clock, six months and comparable elapsed days", () => {
  const range = statisticsPeriod(new Date("2026-10-13T19:45:30.000Z"));
  assert.equal(range.start.toISOString(), "2026-05-01T05:00:00.000Z");
  assert.equal(
    range.currentMonth.start.toISOString(),
    "2026-10-01T05:00:00.000Z",
  );
  assert.equal(
    range.previousSameDays.end.toISOString(),
    "2026-09-13T19:45:30.000Z",
  );
  assert.equal(
    range.previousFullMonth.end.toISOString(),
    "2026-10-01T05:00:00.000Z",
  );
  assert.deepEqual(
    range.months.map((row) => row.month),
    ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
  );
  assert.equal(
    statisticsPeriod(new Date("2026-10-01T04:59:59Z")).months.at(-1).month,
    "2026-09",
  );
  assert.equal(
    statisticsPeriod(
      new Date("2026-03-31T12:00:00Z"),
    ).previousSameDays.end.toISOString(),
    "2026-03-01T05:00:00.000Z",
  );
  assert.equal(
    statisticsPeriod(
      new Date("2028-03-29T12:00:00Z"),
    ).previousSameDays.end.toISOString(),
    "2028-02-29T12:00:00.000Z",
  );
});
test("zero baseline is explicitly incomparable rather than infinite", () => {
  assert.equal(deltaPercent(0, 0), null);
  assert.equal(deltaPercent(5, 0), null);
  assert.equal(deltaPercent(3, 2), 50);
  assert.equal(deltaPercent(0, 4), -100);
});
test("filters only accept actual districts and catalog slugs, rejecting duplicate/nested query values", async () => {
  const db = {
    incidentType: {
      findUnique: async ({ where }) =>
        where.slug === "robo" ? { id: 1 } : null,
    },
  };
  assert.deepEqual(
    await statisticsFilters(db, { district: "Ica", type: "robo" }),
    { district: "Ica", type: "robo" },
  );
  for (const query of [
    { district: "Lima" },
    { type: "missing" },
    { type: "Robo" },
    { type: ["robo"] },
    { district: { a: "Ica" } },
  ])
    await assert.rejects(
      statisticsFilters(db, query),
      (error) => error.status === 400,
    );
});
test("export projection never expands model fields and returns scalar cells with ISO dates", () => {
  const row = projectRow(
    {
      id: 1,
      nombreUsuario: "safe",
      fechaNacimiento: null,
      fechaCreacion: new Date("2026-10-01T12:00Z"),
      permisos: ["consultar", "validar"],
      password: "private",
      firebaseId: "private",
      session: "private",
      imagen: "private://secret",
    },
    COLUMNS.usuarios,
  );
  assert.equal(row.fechaCreacion, "2026-10-01T12:00:00.000Z");
  assert.equal(row.permisos, "consultar, validar");
  assert.equal(row.fechaNacimiento, null);
  for (const columns of Object.values(COLUMNS))
    assert.equal(
      columns.some(({ key }) =>
        /password|token|session|firebase|imagen|url|gps|^ip$/i.test(key),
      ),
      false,
    );
  assert.equal("password" in row, false);
  assert.throws(
    () => projectRow({ id: Infinity }, [COLUMNS.usuarios[0]]),
    /exportable/,
  );
});
test("cursor signature, admin/session binding, expiry and memory quotas are enforced", async () => {
  let clock = Date.parse("2026-10-13T18:00Z");
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const db = {
    incidentType: { findUnique: async () => ({ id: 1 }) },
    $transaction: (fn) => fn(db),
    incident: {
      findMany: async ({ where }) =>
        rows.filter((row) => row.id > where.AND[1].id.gt),
    },
  };
  const service = createExportService({
    clock: () => clock,
    ttlMs: 1000,
    maxOwnerSnapshots: 1,
  });
  const actor = { id: 1, rol: "ADMIN", sessionId: "one" };
  try {
    await assert.rejects(
      service.exportPage(db, { id: 1, rol: "AGENTE" }, { table: "incidentes" }),
      (error) => error.status === 403,
    );
    const first = await service.exportPage(db, actor, {
      table: "incidentes",
      limit: "2",
    });
    assert.equal(first.rows.length, 2);
    const cursorPayload = JSON.parse(
      Buffer.from(first.nextCursor.split(".")[0], "base64url").toString("utf8"),
    );
    assert.match(cursorPayload.owner, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(cursorPayload.owner, `${actor.id}:${actor.sessionId}`);
    assert.equal(JSON.stringify(cursorPayload).includes(actor.sessionId), false);
    await assert.rejects(
      service.exportPage(db, actor, { table: "incidentes", limit: "2" }),
      (error) => error.status === 429,
    );
    for (const [query, owner] of [
      [
        { table: "incidentes", limit: "2", cursor: first.nextCursor + "x" },
        actor,
      ],
      [
        { table: "incidentes", limit: "2", cursor: first.nextCursor },
        { ...actor, id: 2 },
      ],
      [
        { table: "incidentes", limit: "2", cursor: first.nextCursor },
        { ...actor, sessionId: "two" },
      ],
      [{ table: "reportes", limit: "2", cursor: first.nextCursor }, actor],
      [
        {
          table: "incidentes",
          limit: "2",
          cursor: first.nextCursor,
          district: "Ica",
        },
        actor,
      ],
    ])
      await assert.rejects(
        service.exportPage(db, owner, query),
        (error) => error.status === 400,
      );
    const last = await service.exportPage(db, actor, {
      table: "incidentes",
      limit: "2",
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      last.rows.map((row) => row.id),
      [3],
    );
    assert.equal(last.nextCursor, null);
    assert.equal(
      (await service.exportPage(db, actor, { table: "incidentes", limit: "2" }))
        .rows.length,
      2,
    );
    clock += 1001;
    await assert.rejects(
      service.exportPage(db, actor, {
        table: "incidentes",
        limit: "2",
        cursor: first.nextCursor,
      }),
      (error) => error.code === "EXPORT_CURSOR_INVALID",
    );
  } finally {
    service.close();
  }
});
test("parallel snapshot creation is reserved before querying and releases the reservation on failure", async () => {
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let queries = 0;
  const db = {
    $transaction: async () => {
      queries++;
      entered();
      await pending;
      throw new Error("fixture query failed");
    },
  };
  const service = createExportService({ maxOwnerSnapshots: 1 });
  const actor = { id: 1, rol: "ADMIN", sessionId: "parallel" };
  try {
    const first = service.exportPage(db, actor, { table: "incidentes" });
    await started;
    await assert.rejects(
      service.exportPage(db, actor, { table: "incidentes" }),
      (error) => error.status === 429,
    );
    assert.equal(queries, 1);
    release();
    await assert.rejects(first, /fixture query failed/);
    await assert.rejects(
      service.exportPage(db, actor, { table: "incidentes" }),
      /fixture query failed/,
    );
    assert.equal(queries, 2);
  } finally {
    release();
    service.close();
  }
});
