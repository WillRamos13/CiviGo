"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { validateRequest, validateExport } = require("../electron/policy.cjs");
const {
  collectExport,
  workbookBytes,
  validatePage,
  saveExport,
} = require("../electron/excel-export.cjs");

const columns = [
  { key: "id", label: "ID", type: "number" },
  { key: "descripcion", label: "Descripción", type: "string" },
  { key: "fechaEvento", label: "Fecha del hecho", type: "date" },
];
function fixture(total = 550) {
  let generation = 1,
    authenticated = true;
  const calls = [],
    rows = Array.from({ length: total }, (_, index) => ({
      id: index + 1,
      descripcion:
        index === 0
          ? '=HYPERLINK("https://untrusted.test","literal")'
          : "Incidente " + (index + 1),
      fechaEvento: "2026-10-13T05:30:00.000Z",
    }));
  const snapshot = {
    id: "isolated-snapshot",
    table: "incidentes",
    totalRows: total,
    createdAt: "2026-10-13T05:30:00.000Z",
  };
  const client = {
    authenticated: () => authenticated,
    generation: () => generation,
    me: async () => ({ rol: "ADMIN" }),
    request: async ({ route }) => {
      calls.push(route);
      const url = new URL("https://fixture.test" + route);
      const offset = Number(url.searchParams.get("cursor") || 0),
        end = Math.min(total, offset + 250);
      return {
        columns,
        rows: rows.slice(offset, end),
        nextCursor: end === total ? null : String(end),
        snapshot,
      };
    },
  };
  return {
    client,
    rows,
    snapshot,
    calls,
    logout: () => {
      generation++;
      authenticated = false;
    },
  };
}

test("Excel export IPC accepts only declared tables and concrete district/type filters, never output paths or arbitrary server routes", () => {
  assert.deepEqual(
    validateExport({
      table: "incidentes",
      filters: { district: "Ica", type: "robo" },
    }),
    { table: "incidentes", filters: { district: "Ica", type: "robo" } },
  );
  assert.equal(
    validateRequest({
      route: "/admin/statistics?district=La+Tingui%C3%B1a&type=robo",
    }).method,
    "GET",
  );
  assert.equal(
    validateRequest({
      route: "/admin/exports?table=reportes&limit=250&cursor=abc_def.123",
    }).method,
    "GET",
  );
  for (const input of [
    { table: "sesiones" },
    { table: "usuarios", filePath: "C:/secret.xlsx" },
    { table: "usuarios", filters: { district: "Unknown" } },
    { table: "usuarios", filters: { type: "../passwords" } },
    { table: "usuarios", filters: { redirect: "https://evil.test" } },
  ])
    assert.throws(() => validateExport(input));
  for (const route of [
    "/admin/statistics?district=Unknown",
    "/admin/statistics?district=Ica&district=Ica",
    "/admin/statistics?period=all",
    "/admin/exports?table=sessions",
    "/admin/exports?table=usuarios&limit=251",
    "/admin/exports?table=usuarios&cursor=https://evil.test",
    "/admin/exports?table=usuarios&password=true",
  ])
    assert.throws(() => validateRequest({ route }));
});

test("550 rows are collected from all three pages and written as real Excel with safe literal text, frozen headers and Peru dates", async () => {
  const value = fixture();
  const data = await collectExport(value.client, { table: "incidentes" });
  assert.equal(data.rows.length, 550);
  assert.equal(value.calls.length, 3);
  assert.ok(value.calls[1].includes("cursor=250"));
  assert.ok(value.calls[2].includes("cursor=500"));
  const bytes = await workbookBytes(data),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet("Incidentes");
  assert.equal(sheet.rowCount, 551);
  assert.equal(sheet.getCell("A551").value, 550);
  assert.equal(sheet.getCell("B2").value, value.rows[0].descripcion);
  assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("B2").formula, undefined);
  assert.equal(
    sheet.getCell("C2").value.toISOString(),
    "2026-10-13T00:30:00.000Z",
  );
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.getCell("A1").fill.fgColor.argb, "FF1554D8");
  assert.ok(sheet.autoFilter);
  assert.equal(book.getWorksheet("Información").getCell("B3").value, 550);
  bytes.fill(0);
});

test("empty exports produce a valid workbook with headers, and spreadsheet-looking strings never become formulas", async () => {
  const value = fixture(0),
    data = await collectExport(value.client, { table: "incidentes" });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await workbookBytes(data));
  assert.equal(book.getWorksheet("Incidentes").rowCount, 1);
  data.rows = [
    "=1+1",
    "+SUM(1,2)",
    "-2+3",
    "@SUM(1,2)",
    '\t=HYPERLINK("x")',
  ].map((descripcion, index) => ({
    id: index + 1,
    descripcion,
    fechaEvento: null,
  }));
  const strings = new ExcelJS.Workbook();
  await strings.xlsx.load(await workbookBytes(data));
  data.rows.forEach((row, index) => {
    const cell = strings.getWorksheet("Incidentes").getCell(index + 2, 2);
    assert.equal(cell.value, row.descripcion);
    assert.equal(cell.type, ExcelJS.ValueType.String);
  });
});

test("secret columns, formula objects, malformed dates and type changes are rejected before file generation", () => {
  const base = {
    columns,
    rows: [
      { id: 1, descripcion: "Valid", fechaEvento: "2026-10-13T05:00:00Z" },
    ],
    nextCursor: null,
    snapshot: {
      id: "fixture",
      table: "incidentes",
      totalRows: 1,
      createdAt: "2026-10-13T05:00:00Z",
    },
  };
  for (const modify of [
    (page) => {
      page.columns.push({ key: "password", label: "Secret", type: "string" });
    },
    (page) => {
      page.rows[0].privateAttachmentUrl = "https://private.test";
    },
    (page) => {
      page.rows[0].descripcion = { formula: 'HYPERLINK("evil")' };
    },
    (page) => {
      page.rows[0].fechaEvento = "invalid";
    },
    (page) => {
      page.rows[0].id = "1";
    },
    (page) => {
      page.snapshot.totalRows = 10001;
    },
    (page) => {
      page.nextCursor = "https://evil.test";
    },
  ]) {
    const page = structuredClone(base);
    modify(page);
    assert.throws(() => validatePage(page, "incidentes"));
  }
});

test("partial, repeated or changed snapshot pages fail without silently producing an incomplete spreadsheet", async () => {
  for (const modify of [
    (page) => {
      page.snapshot = { ...page.snapshot, id: "different-snapshot" };
    },
    (page) => {
      page.rows = [{ ...page.rows[0], id: 1 }];
    },
    (page) => {
      page.nextCursor = null;
      page.rows = [];
    },
    (page) => {
      page.nextCursor = "250";
    },
  ]) {
    const value = fixture();
    const original = value.client.request;
    value.client.request = async (options) => {
      const page = await original(options);
      if (value.calls.length > 1) modify(page);
      return page;
    };
    await assert.rejects(collectExport(value.client, { table: "incidentes" }));
  }
});

test("logout while the save dialog or disk write is pending prevents the final file and cleans temporary output", async () => {
  const local = path.resolve(__dirname, "../.local/excel-export-unit");
  await fs.mkdir(local, { recursive: true });
  const destination = path.join(local, randomUUID() + ".xlsx");
  const value = fixture();
  await assert.rejects(
    saveExport({
      client: value.client,
      input: { table: "incidentes" },
      downloads: local,
      showSaveDialog: async () => {
        value.logout();
        return { canceled: false, filePath: destination };
      },
    }),
    (error) => error.status === 401,
  );
  await assert.rejects(fs.access(destination));
  const disk = fixture();
  let temporary;
  const io = {
    writeFile: async (file, bytes, options) => {
      temporary = file;
      await fs.writeFile(file, bytes, options);
      disk.logout();
    },
    rename: fs.rename,
    unlink: fs.unlink,
  };
  await assert.rejects(
    saveExport({
      client: disk.client,
      input: { table: "incidentes" },
      downloads: local,
      showSaveDialog: async () => ({ canceled: false, filePath: destination }),
      io,
    }),
    (error) => error.status === 401,
  );
  await assert.rejects(fs.access(destination));
  await assert.rejects(fs.access(temporary));
});

test("saving succeeds only through the native dialog; cancellation writes nothing", async () => {
  const local = path.resolve(__dirname, "../.local/excel-export-unit");
  await fs.mkdir(local, { recursive: true });
  const destination = path.join(local, randomUUID() + ".xlsx");
  const value = fixture();
  const canceled = await saveExport({
    client: value.client,
    input: { table: "incidentes" },
    downloads: local,
    showSaveDialog: async () => ({ canceled: true }),
  });
  assert.equal(canceled.cancelado, true);
  const result = await saveExport({
    client: value.client,
    input: { table: "incidentes" },
    downloads: local,
    showSaveDialog: async (options) => {
      assert.equal(options.filters[0].extensions[0], "xlsx");
      return { canceled: false, filePath: destination };
    },
  });
  assert.equal(result.filas, 550);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(destination);
  assert.equal(book.getWorksheet("Incidentes").rowCount, 551);
  await fs.unlink(destination);
});
