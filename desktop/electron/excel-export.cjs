"use strict";

const ExcelJS = require("exceljs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DesktopError, validateExport } = require("./policy.cjs");

const MAX_EXPORT_ROWS = 10000;
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
const TITLES = Object.freeze({
  usuarios: "Usuarios",
  reportes: "Reportes",
  incidentes: "Incidentes",
  catalogo: "Catálogo",
  estadisticas: "Estadísticas",
});
const ALLOWED_KEYS = Object.freeze({
  usuarios: [
    "id",
    "nombreUsuario",
    "nombres",
    "apellidos",
    "correo",
    "telefono",
    "fechaNacimiento",
    "rol",
    "tipoAgente",
    "distrito",
    "permisos",
    "correoVerificado",
    "bloqueado",
    "premium",
    "ocultarAnuncios",
    "reputacion",
    "faltas",
    "monedas",
    "fechaCreacion",
  ],
  reportes: [
    "id",
    "usuarioId",
    "incidenteId",
    "tipoId",
    "tipo",
    "descripcion",
    "latitud",
    "longitud",
    "nivelRiesgo",
    "estado",
    "confirmaciones",
    "fechaEvento",
    "fechaCreacion",
    "recordatorioEnviado",
    "sancionAplicada",
  ],
  incidentes: [
    "id",
    "tipoId",
    "tipo",
    "descripcion",
    "latitud",
    "longitud",
    "distrito",
    "nivelRiesgo",
    "estado",
    "evaluacion",
    "totalReportes",
    "validacion",
    "publicado",
    "individual",
    "historico",
    "emergencia",
    "persistente",
    "fuente",
    "motivoRetiro",
    "fechaEvento",
    "fechaPublicacion",
    "fechaCreacion",
    "fechaActualizacion",
  ],
  catalogo: [
    "id",
    "slug",
    "nombre",
    "categoriaId",
    "categoria",
    "categoriaSlug",
    "emergencia",
    "historico",
    "fotoObligatoria",
    "individual",
    "ubicacionRemota",
    "persistente",
    "activo",
  ],
  estadisticas: [
    "grupo",
    "clave",
    "etiqueta",
    "cantidad",
    "reportes",
    "crimenes",
    "verificados",
    "noVerificados",
    "valor",
  ],
});

function checkSession(client, generation) {
  if (!client.authenticated() || generation !== client.generation())
    throw new DesktopError(
      "La sesión cambió. Vuelve a solicitar la exportación.",
      401,
      "DESKTOP_EXPORT_SESSION",
    );
}

function validatePage(page, table) {
  if (
    !page ||
    typeof page !== "object" ||
    !Array.isArray(page.columns) ||
    !page.columns.length ||
    page.columns.length > 40 ||
    !Array.isArray(page.rows) ||
    page.rows.length > 250 ||
    !page.snapshot ||
    page.snapshot.table !== table ||
    typeof page.snapshot.id !== "string" ||
    !page.snapshot.id ||
    !Number.isSafeInteger(page.snapshot.totalRows) ||
    page.snapshot.totalRows < 0 ||
    page.snapshot.totalRows > MAX_EXPORT_ROWS ||
    !Number.isFinite(+new Date(page.snapshot.createdAt))
  )
    throw new DesktopError(
      "El servidor devolvió una exportación incompleta o demasiado grande.",
      502,
      "DESKTOP_EXPORT_FORMAT",
    );
  const keys = new Set();
  for (const column of page.columns) {
    if (
      !column ||
      !ALLOWED_KEYS[table].includes(column.key) ||
      keys.has(column.key) ||
      typeof column.label !== "string" ||
      !column.label.trim() ||
      column.label.length > 100 ||
      !["string", "text", "number", "boolean", "date", "datetime"].includes(
        column.type,
      )
    )
      throw new DesktopError(
        "La exportación contiene columnas no autorizadas.",
        502,
        "DESKTOP_EXPORT_FORMAT",
      );
    keys.add(column.key);
  }
  for (const row of page.rows) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !keys.has(key))
    )
      throw new DesktopError(
        "La exportación contiene datos no autorizados.",
        502,
        "DESKTOP_EXPORT_FORMAT",
      );
    for (const column of page.columns) {
      const value = row[column.key];
      if (value == null) continue;
      if (
        !["string", "number", "boolean"].includes(typeof value) ||
        (typeof value === "number" && !Number.isFinite(value)) ||
        (typeof value === "string" && value.length > 32767)
      )
        throw new DesktopError(
          "La exportación contiene una celda no admitida.",
          502,
          "DESKTOP_EXPORT_FORMAT",
        );
      if (
        (column.type === "number" && typeof value !== "number") ||
        (column.type === "boolean" && typeof value !== "boolean") ||
        (["string", "text"].includes(column.type) && typeof value !== "string")
      )
        throw new DesktopError(
          "La exportación contiene una celda con un tipo incorrecto.",
          502,
          "DESKTOP_EXPORT_FORMAT",
        );
      if (
        ["date", "datetime"].includes(column.type) &&
        (typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
          !Number.isFinite(+new Date(value)))
      )
        throw new DesktopError(
          "La exportación contiene una fecha inválida.",
          502,
          "DESKTOP_EXPORT_FORMAT",
        );
    }
  }
  if (
    page.nextCursor !== null &&
    (typeof page.nextCursor !== "string" ||
      !/^[a-zA-Z0-9_.-]{1,1000}$/.test(page.nextCursor))
  )
    throw new DesktopError(
      "La paginación de la exportación no es válida.",
      502,
      "DESKTOP_EXPORT_FORMAT",
    );
  return page;
}

async function collectExport(client, input, generation = client.generation()) {
  const options = validateExport(input);
  const rows = [],
    seen = new Set(),
    rowIds = new Set();
  let cursor, first;
  for (let pageIndex = 0; pageIndex < 41; pageIndex++) {
    checkSession(client, generation);
    const params = new URLSearchParams({
      table: options.table,
      limit: "250",
      ...options.filters,
    });
    if (cursor) params.set("cursor", cursor);
    const page = validatePage(
      await client.request({ route: "/admin/exports?" + params.toString() }),
      options.table,
    );
    checkSession(client, generation);
    if (!first) first = page;
    else if (
      page.snapshot.id !== first.snapshot.id ||
      page.snapshot.totalRows !== first.snapshot.totalRows ||
      JSON.stringify(page.columns) !== JSON.stringify(first.columns)
    )
      throw new DesktopError(
        "La exportación cambió durante la lectura. Vuelve a intentarlo.",
        409,
        "DESKTOP_EXPORT_CHANGED",
      );
    for (const row of page.rows) {
      if (Object.hasOwn(row, "id")) {
        if (!Number.isSafeInteger(row.id) || row.id < 1 || rowIds.has(row.id))
          throw new DesktopError(
            "La exportación contiene registros duplicados.",
            502,
            "DESKTOP_EXPORT_FORMAT",
          );
        rowIds.add(row.id);
      }
      rows.push(row);
    }
    if (
      rows.length > MAX_EXPORT_ROWS ||
      Buffer.byteLength(JSON.stringify(rows)) > MAX_EXPORT_BYTES
    )
      throw new DesktopError(
        "La exportación supera el límite de 10 000 filas. Usa filtros para reducirla.",
        413,
        "DESKTOP_EXPORT_LIMIT",
      );
    if (page.nextCursor === null) {
      if (rows.length !== first.snapshot.totalRows)
        throw new DesktopError(
          "Faltan filas de la exportación. No se guardó un archivo parcial.",
          502,
          "DESKTOP_EXPORT_FORMAT",
        );
      return {
        table: options.table,
        filters: options.filters,
        columns: first.columns,
        rows,
        snapshot: first.snapshot,
      };
    }
    if (!page.rows.length || seen.has(page.nextCursor))
      throw new DesktopError(
        "La paginación de la exportación se repitió.",
        502,
        "DESKTOP_EXPORT_FORMAT",
      );
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new DesktopError(
    "La exportación supera el límite permitido.",
    413,
    "DESKTOP_EXPORT_LIMIT",
  );
}

function peruDate(value, dateOnly = false) {
  const date = new Date(value);
  if (dateOnly)
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
}

async function workbookBytes(data) {
  const book = new ExcelJS.Workbook();
  book.creator = "CiviGo Administración";
  book.created = new Date();
  const sheet = book.addWorksheet(TITLES[data.table], {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = data.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: ["descripcion", "motivoRetiro", "permisos"].includes(column.key)
      ? 56
      : column.key === "correo"
        ? 34
        : ["date", "datetime"].includes(column.type)
          ? 23
          : column.key === "id"
            ? 11
            : 23,
  }));
  for (const source of data.rows) {
    const row = sheet.addRow(
      data.columns.map((column) => {
        const value = source[column.key];
        if (value == null) return null;
        if (["date", "datetime"].includes(column.type))
          return peruDate(value, column.key === "fechaNacimiento");
        // Strings remain literal cells; never accept a formula/hyperlink object.
        return typeof value === "string" ? String(value) : value;
      }),
    );
    row.alignment = { vertical: "top", wrapText: true };
    data.columns.forEach((column, index) => {
      if (["date", "datetime"].includes(column.type))
        row.getCell(index + 1).numFmt =
          column.key === "fechaNacimiento" ? "dd/mm/yyyy" : "dd/mm/yyyy hh:mm";
      if (column.type === "number")
        row.getCell(index + 1).numFmt = ["latitud", "longitud"].includes(
          column.key,
        )
          ? "0.000000"
          : "0.##";
    });
    if (row.number % 2 === 0)
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F6FD" },
        };
      });
  }
  const header = sheet.getRow(1);
  header.height = 30;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1554D8" },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, data.rows.length + 1), column: data.columns.length },
  };
  const info = book.addWorksheet("Información");
  info.columns = [
    { header: "Campo", key: "label", width: 32 },
    { header: "Valor", key: "value", width: 72 },
  ];
  info.addRows([
    { label: "Contenido", value: TITLES[data.table] },
    { label: "Filas exportadas", value: data.rows.length },
    { label: "Fechas y horas", value: "America/Lima (hora de Perú)" },
    { label: "Distrito", value: data.filters.district || "Todos" },
    { label: "Tipo de incidente", value: data.filters.type || "Todos" },
    {
      label: "Lectura consistente iniciada",
      value: new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(data.snapshot.createdAt)),
    },
    {
      label: "Privacidad",
      value:
        "No contiene contraseñas, sesiones, tokens ni enlaces a pruebas privadas.",
    },
  ]);
  info.getRow(1).font = { bold: true };
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function saveExport({
  client,
  input,
  showSaveDialog,
  downloads,
  io = fs,
}) {
  const options = validateExport(input);
  const generation = client.generation();
  await client.me();
  checkSession(client, generation);
  const data = await collectExport(client, options, generation);
  const result = await showSaveDialog({
    title: "Exportar " + TITLES[options.table] + " a Excel",
    defaultPath: path.join(
      downloads,
      "CiviGo-" +
        options.table +
        "-" +
        new Date().toISOString().slice(0, 10) +
        ".xlsx",
    ),
    filters: [{ name: "Libro de Excel", extensions: ["xlsx"] }],
  });
  if (result.canceled || !result.filePath) return { cancelado: true };
  if (
    !path.isAbsolute(result.filePath) ||
    path.extname(result.filePath).toLowerCase() !== ".xlsx"
  )
    throw new DesktopError(
      "Guarda la exportación con la extensión .xlsx.",
      400,
    );
  await client.me();
  checkSession(client, generation);
  const bytes = await workbookBytes(data);
  const temporary = path.join(
    path.dirname(result.filePath),
    "." + path.basename(result.filePath) + ".civigo-" + randomUUID() + ".tmp",
  );
  let staged = false;
  try {
    await client.me();
    checkSession(client, generation);
    await io.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    staged = true;
    checkSession(client, generation);
    await io.rename(temporary, result.filePath);
    staged = false;
    return { guardado: true, filas: data.rows.length, tabla: options.table };
  } finally {
    bytes.fill(0);
    data.rows.length = 0;
    if (staged) await io.unlink(temporary).catch(() => {});
  }
}

module.exports = {
  MAX_EXPORT_ROWS,
  MAX_EXPORT_BYTES,
  TITLES,
  ALLOWED_KEYS,
  checkSession,
  validatePage,
  collectExport,
  peruDate,
  workbookBytes,
  saveExport,
};
