"use strict";
const { createHash } = require("node:crypto");
const { HttpError } = require("./http");
const { inProvince, districtFor, normalize } = require("./roads");
function csvRows(content) {
  const first = content.split(/\r?\n/, 1)[0],
    delimiter =
      (first.match(/;/g) || []).length > (first.match(/,/g) || []).length
        ? ";"
        : ",";
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') {
      if (quoted && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell.length === 0) quoted = !quoted;
      else
        throw new HttpError(
          400,
          "CSV inválido: comillas dentro de un campo sin delimitar.",
        );
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted)
    throw new HttpError(400, "CSV inválido: campo entre comillas sin cierre.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  const headers = (rows.shift() || []).map((h) =>
    h.replace(/^\uFEFF/, "").trim(),
  );
  if (!headers.includes("tipo") || !headers.includes("fechaEvento"))
    throw new HttpError(
      400,
      "El CSV necesita encabezados tipo,fechaEvento,latitud,longitud,nivelRiesgo,descripcion.",
    );
  return rows.map((values, index) =>
    Object.assign(
      Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])),
      { _fila: index + 2 },
    ),
  );
}
function parseContent(body) {
  if (
    !["csv", "json"].includes(body.formato) ||
    typeof body.contenido !== "string" ||
    Buffer.byteLength(body.contenido, "utf8") > 2 * 1024 * 1024 ||
    !body.contenido.trim()
  )
    throw new HttpError(400, "Selecciona un CSV o JSON de hasta 2 MB.");
  if (
    typeof body.fuente !== "string" ||
    !body.fuente.trim() ||
    body.fuente.length > 150
  )
    throw new HttpError(400, "Indica una fuente de hasta 150 caracteres.");
  let rows;
  if (body.formato === "csv") rows = csvRows(body.contenido);
  else {
    try {
      rows = JSON.parse(body.contenido);
    } catch {
      throw new HttpError(400, "JSON inválido.");
    }
    if (!Array.isArray(rows))
      throw new HttpError(400, "El JSON debe ser un arreglo de registros.");
  }
  if (rows.length > 2000 || !rows.length)
    throw new HttpError(400, "Importa entre 1 y 2000 registros por archivo.");
  return rows;
}
function prepareImport(body, types, now = new Date()) {
  const rows = parseContent(body),
    registros = [],
    errores = [],
    seen = new Set();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index],
      fila = body.formato === "csv" ? row?._fila || index + 2 : index + 1;
    try {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error("Registro inválido.");
      if (typeof row.tipo !== "string")
        throw new Error("El tipo debe ser texto del catálogo.");
      const type = types.find(
        (t) =>
          normalize(t.slug) === normalize(row.tipo) ||
          normalize(t.nombre) === normalize(row.tipo),
      );
      if (!type?.historico || type.activo === false)
        throw new Error(
          "El tipo debe ser un delito histórico o persona desaparecida del catálogo activo.",
        );
      const iso =
        typeof row.fechaEvento === "string" &&
        row.fechaEvento.match(
          /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
        );
      if (
        !iso ||
        Number(iso[2] || 0) > 23 ||
        Number(iso[3] || 0) > 59 ||
        Number(iso[4] || 0) > 59
      )
        throw new Error(
          "La fecha del hecho debe usar ISO, por ejemplo 2025-10-01.",
        );
      const day = iso[1],
        calendarCheck = new Date(day + "T12:00:00Z");
      const fecha = new Date(
        row.fechaEvento.length === 10
          ? row.fechaEvento + "T00:00:00-05:00"
          : row.fechaEvento + (iso[5] ? "" : "-05:00"),
      );
      if (
        !Number.isFinite(fecha.getTime()) ||
        fecha > now ||
        !Number.isFinite(calendarCheck.getTime()) ||
        calendarCheck.toISOString().slice(0, 10) !== day
      )
        throw new Error("Fecha del hecho inválida o futura.");
      if (
        row.latitud === "" ||
        row.longitud === "" ||
        row.nivelRiesgo === "" ||
        row.latitud == null ||
        row.longitud == null ||
        row.nivelRiesgo == null
      )
        throw new Error("Faltan coordenadas o gravedad.");
      const numeric = (value) =>
        typeof value === "number" || (typeof value === "string" && value.trim())
          ? Number(value)
          : NaN;
      const latitud = numeric(row.latitud),
        longitud = numeric(row.longitud),
        nivelRiesgo = numeric(row.nivelRiesgo);
      if (
        !Number.isFinite(latitud) ||
        !Number.isFinite(longitud) ||
        !inProvince({ latitud, longitud })
      )
        throw new Error(
          "Coordenadas fuera de la cobertura de la provincia de Ica.",
        );
      if (!Number.isInteger(nivelRiesgo) || nivelRiesgo < 1 || nivelRiesgo > 5)
        throw new Error("La gravedad debe ser un entero de 1 a 5.");
      if (row.descripcion != null && typeof row.descripcion !== "string")
        throw new Error("La descripción debe ser texto.");
      const descripcion = (row.descripcion || "").trim();
      if (descripcion.length > 2000)
        throw new Error("Descripción demasiado extensa.");
      if (
        row.referencia != null &&
        !["string", "number"].includes(typeof row.referencia)
      )
        throw new Error("La referencia debe ser texto o un número.");
      if (
        typeof row.referencia === "number" &&
        !Number.isFinite(row.referencia)
      )
        throw new Error("Referencia inválida.");
      const referencia =
        row.referencia == null ? null : String(row.referencia).trim() || null;
      if (referencia?.length > 200)
        throw new Error("La referencia no puede superar 200 caracteres.");
      const record = {
        fila,
        tipo: type.slug,
        tipoId: type.id,
        tipoNombre: type.nombre,
        descripcion,
        fechaEvento: fecha.toISOString(),
        latitud,
        longitud,
        nivelRiesgo,
        referencia,
        distrito: districtFor({ latitud, longitud }),
        individual: type.individual === true,
      };
      const identity =
        referencia ||
        JSON.stringify([
          record.tipo,
          record.fechaEvento,
          latitud,
          longitud,
          nivelRiesgo,
          descripcion,
        ]);
      record.clave =
        "historical:" +
        createHash("sha256")
          .update(body.fuente.trim() + "\n" + identity)
          .digest("hex");
      if (seen.has(record.clave))
        throw new Error("Registro repetido dentro del archivo.");
      seen.add(record.clave);
      registros.push(record);
    } catch (error) {
      errores.push({ fila, mensaje: error.message });
    }
  }
  return {
    registros,
    errores,
    total: rows.length,
    totalValidos: registros.length,
  };
}
module.exports = { csvRows, parseContent, prepareImport };
