"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planPresentationDates } = require("../src/lib/presentation-dates");
const fixtures = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    fuente: "CARGA_INICIAL",
    reportes: [{ id: 1000 + i }],
  }));
const localMonth = (date) =>
  new Date(+date - 5 * 3600000).toISOString().slice(0, 7);

test("550 pares se distribuyen en seis meses de Perú, sin fechas futuras ni alterar los registros", () => {
  const incidents = fixtures(550),
    original = structuredClone(incidents),
    now = new Date("2026-10-13T23:40:23Z");
  const result = planPresentationDates({ incidents, now });
  assert.equal(result.entries.length, 550);
  assert.deepEqual(incidents, original);
  assert.deepEqual(result.summary.countsByMonth, {
    "2026-05": 44,
    "2026-06": 55,
    "2026-07": 77,
    "2026-08": 99,
    "2026-09": 132,
    "2026-10": 143,
  });
  const counts = {};
  for (const row of result.entries) {
    assert.ok(
      row.fechaEvento <= row.fechaCreacion &&
        row.fechaCreacion <= row.fechaPublicacion &&
        row.fechaPublicacion <= now,
    );
    const month = localMonth(row.fechaEvento);
    counts[month] = (counts[month] || 0) + 1;
    assert.equal(localMonth(row.fechaCreacion), month);
    assert.equal(localMonth(row.fechaPublicacion), month);
  }
  assert.deepEqual(counts, result.summary.countsByMonth);
  assert.ok(new Set(result.entries.map((row) => +row.fechaEvento)).size > 500);
  assert.deepEqual(planPresentationDates({ incidents, now }), result);
});

test("el cambio de mes usa hora de Perú y limita el primer instante del mes sin retroceder", () => {
  for (const now of [
    new Date("2026-11-01T00:01:00Z"),
    new Date("2026-11-01T05:00:00Z"),
    new Date("2026-11-01T05:00:01Z"),
  ]) {
    const result = planPresentationDates({ incidents: fixtures(500), now });
    assert.equal(
      Object.keys(result.summary.countsByMonth).at(-1),
      localMonth(now),
    );
    for (const row of result.entries)
      assert.ok(
        row.fechaEvento <= row.fechaCreacion && row.fechaPublicacion <= now,
      );
    assert.equal(result.entries.length, 500);
  }
});

test("no se pueden retrofechar datos reales, incompletos o con referencias duplicadas", () => {
  for (const alter of [
    (rows) => {
      rows[0].fuente = "CIUDADANO";
    },
    (rows) => {
      rows[1].id = rows[0].id;
    },
    (rows) => {
      rows[1].reportes = rows[0].reportes;
    },
    (rows) => {
      rows[1].reportes = [];
    },
  ]) {
    const incidents = fixtures(550);
    alter(incidents);
    assert.throws(() => planPresentationDates({ incidents }), {
      code: "PRESENTATION_DATES",
    });
  }
  assert.throws(() => planPresentationDates({ incidents: fixtures(49) }), {
    code: "PRESENTATION_DATES",
  });
});
