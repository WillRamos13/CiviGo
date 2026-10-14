"use strict";

const crypto = require("node:crypto");
const { HttpError } = require("./http");
const {
  collectStatistics,
  statisticsFilters,
  incidentScope,
} = require("./admin-statistics");

// Explicit selects and projections are deliberate: adding a model property must
// never silently add credentials, GPS origins, private URLs or tokens to Excel.
const column = (key, label, type = "string") => ({ key, label, type });
const USER_COLUMNS = [
  column("id", "ID", "number"),
  column("nombreUsuario", "Usuario"),
  column("nombres", "Nombres"),
  column("apellidos", "Apellidos"),
  column("correo", "Correo"),
  column("telefono", "Teléfono"),
  column("fechaNacimiento", "Nacimiento", "date"),
  column("rol", "Rol"),
  column("tipoAgente", "Tipo de agente"),
  column("distrito", "Distrito"),
  column("permisos", "Permisos"),
  column("correoVerificado", "Correo verificado", "boolean"),
  column("bloqueado", "Bloqueado", "boolean"),
  column("premium", "Premium", "boolean"),
  column("ocultarAnuncios", "Ocultar anuncios", "boolean"),
  column("reputacion", "Reputación", "number"),
  column("faltas", "Faltas", "number"),
  column("monedas", "Monedas", "number"),
  column("fechaCreacion", "Creación", "date"),
];
const REPORT_COLUMNS = [
  column("id", "ID", "number"),
  column("usuarioId", "Usuario ID", "number"),
  column("incidenteId", "Incidente ID", "number"),
  column("tipoId", "Tipo ID", "number"),
  column("tipo", "Tipo"),
  column("descripcion", "Descripción"),
  column("latitud", "Latitud", "number"),
  column("longitud", "Longitud", "number"),
  column("nivelRiesgo", "Gravedad", "number"),
  column("estado", "Estado"),
  column("confirmaciones", "Confirmaciones", "number"),
  column("fechaEvento", "Fecha del hecho", "date"),
  column("fechaCreacion", "Creación", "date"),
  column("recordatorioEnviado", "Recordatorio enviado", "boolean"),
  column("sancionAplicada", "Sanción aplicada", "boolean"),
];
const INCIDENT_COLUMNS = [
  column("id", "ID", "number"),
  column("tipoId", "Tipo ID", "number"),
  column("tipo", "Tipo"),
  column("descripcion", "Descripción"),
  column("latitud", "Latitud", "number"),
  column("longitud", "Longitud", "number"),
  column("distrito", "Distrito"),
  column("nivelRiesgo", "Gravedad", "number"),
  column("estado", "Estado"),
  column("evaluacion", "Evaluación"),
  column("totalReportes", "Aportes", "number"),
  column("validacion", "Peso de validación", "number"),
  column("publicado", "Publicado", "boolean"),
  column("individual", "Individual", "boolean"),
  column("historico", "Histórico", "boolean"),
  column("emergencia", "Emergencia", "boolean"),
  column("persistente", "Persistente", "boolean"),
  column("fuente", "Fuente"),
  column("motivoRetiro", "Motivo de retiro"),
  column("fechaEvento", "Fecha del hecho", "date"),
  column("fechaPublicacion", "Publicación", "date"),
  column("fechaCreacion", "Creación", "date"),
  column("fechaActualizacion", "Actualización", "date"),
];
const CATALOG_COLUMNS = [
  column("id", "ID", "number"),
  column("slug", "Código"),
  column("nombre", "Tipo"),
  column("categoriaId", "Categoría ID", "number"),
  column("categoria", "Categoría"),
  column("categoriaSlug", "Código de categoría"),
  column("emergencia", "Emergencia", "boolean"),
  column("historico", "Histórico", "boolean"),
  column("fotoObligatoria", "Foto obligatoria", "boolean"),
  column("individual", "Individual", "boolean"),
  column("ubicacionRemota", "Ubicación remota", "boolean"),
  column("persistente", "Persistente", "boolean"),
  column("activo", "Activo", "boolean"),
];
const STATISTICS_COLUMNS = [
  column("grupo", "Grupo"),
  column("clave", "Código"),
  column("etiqueta", "Etiqueta"),
  column("cantidad", "Cantidad", "number"),
  column("reportes", "Reportes", "number"),
  column("crimenes", "Seguridad", "number"),
  column("verificados", "Verificados", "number"),
  column("noVerificados", "No verificados", "number"),
  column("valor", "Valor"),
];
const COLUMNS = Object.freeze({
  usuarios: USER_COLUMNS,
  reportes: REPORT_COLUMNS,
  incidentes: INCIDENT_COLUMNS,
  catalogo: CATALOG_COLUMNS,
  estadisticas: STATISTICS_COLUMNS,
});
const selectColumns = (columns) =>
  Object.fromEntries(columns.map(({ key }) => [key, true]));
function projectRow(row, columns) {
  return Object.fromEntries(
    columns.map(({ key }) => {
      const value = row[key];
      if (value === null || value === undefined) return [key, null];
      if (value instanceof Date) return [key, value.toISOString()];
      if (key === "permisos" && Array.isArray(value))
        return [key, value.join(", ")];
      if (
        (typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "string" ||
        typeof value === "boolean"
      )
        return [key, value];
      throw new Error("Valor no exportable.");
    }),
  );
}
function statisticsRows(statistics) {
  const rows = Object.entries(statistics.totals).map(([key, count]) => ({
    grupo: "totales",
    clave: key,
    etiqueta: key,
    cantidad: count,
  }));
  for (const group of ["types", "districts", "statuses", "severities"])
    rows.push(
      ...statistics.datasets[group].map((row) => ({
        grupo: group,
        clave: row.key,
        etiqueta: row.label,
        cantidad: row.count,
      })),
    );
  rows.push(
    ...statistics.datasets.timeline.map((row) => ({
      grupo: "timeline",
      clave: row.month,
      etiqueta: row.label,
      cantidad: row.incidents,
      reportes: row.reports,
      crimenes: row.crimes,
    })),
  );
  rows.push(
    ...statistics.datasets.accounts.map((row) => ({
      grupo: "accounts",
      clave: row.role,
      etiqueta: row.role,
      cantidad: row.count,
      verificados: row.verified,
      noVerificados: row.unverified,
    })),
  );
  const comparisonLabels = {
    current: "Mes actual (parcial)",
    previousSameDays: "Mes anterior (mismos días)",
    previousFullMonth: "Mes anterior completo",
    deltaPercent: "Variación frente al mismo período (%)",
  };
  for (const [group, label] of [
    ["incidentComparison", "Todos los incidentes"],
    ["crimeComparison", "Incidentes de seguridad"],
  ])
    for (const [key, value] of Object.entries(statistics[group]))
      rows.push({
        grupo: group,
        clave: key,
        etiqueta: `${label}: ${comparisonLabels[key]}`,
        cantidad: value,
      });
  rows.push(
    {
      grupo: "periodo",
      clave: "inicio",
      etiqueta: "Fecha del hecho: desde",
      valor: statistics.period.start,
    },
    {
      grupo: "periodo",
      clave: "fin",
      etiqueta: "Hasta (exclusivo)",
      valor: statistics.period.end,
    },
    {
      grupo: "periodo",
      clave: "zonaHoraria",
      etiqueta: "Zona horaria",
      valor: statistics.timeZone,
    },
  );
  for (const [key, range] of Object.entries(statistics.period))
    if (range && typeof range === "object") {
      rows.push(
        {
          grupo: "periodo",
          clave: `${key}.inicio`,
          etiqueta: `${key}: desde`,
          valor: range.start,
        },
        {
          grupo: "periodo",
          clave: `${key}.fin`,
          etiqueta: `${key}: hasta`,
          valor: range.end,
        },
      );
    }
  return rows.map((row) => projectRow(row, STATISTICS_COLUMNS));
}
async function collectExport(db, table, filters, now, maxRows) {
  const columns = COLUMNS[table];
  if (table === "estadisticas")
    return statisticsRows(await collectStatistics(db, filters, now));
  const model =
    table === "usuarios"
      ? db.user
      : table === "reportes"
        ? db.report
        : table === "incidentes"
          ? db.incident
          : db.incidentType;
  const where =
    table === "usuarios"
      ? {
          ...(filters.district ? { distrito: filters.district } : {}),
          fechaCreacion: { lte: now },
        }
      : table === "reportes"
        ? {
            fechaCreacion: { lte: now },
            ...(filters.district
              ? { incidente: { distrito: filters.district } }
              : {}),
            ...(filters.type ? { tipoCatalogo: { slug: filters.type } } : {}),
          }
        : table === "incidentes"
          ? { ...incidentScope(filters), fechaCreacion: { lte: now } }
          : { ...(filters.type ? { slug: filters.type } : {}) };
  const select =
    table === "catalogo"
      ? {
          ...selectColumns(
            columns.filter(
              ({ key }) => !["categoria", "categoriaSlug"].includes(key),
            ),
          ),
          categoria: { select: { nombre: true, slug: true } },
        }
      : selectColumns(columns);
  const rows = [];
  let after = 0;
  for (;;) {
    const batch = await model.findMany({
      where: { AND: [where, { id: { gt: after } }] },
      select,
      orderBy: { id: "asc" },
      take: Math.min(1000, maxRows - rows.length + 1),
    });
    for (const row of batch)
      rows.push(
        projectRow(
          table === "catalogo"
            ? {
                ...row,
                categoria: row.categoria.nombre,
                categoriaSlug: row.categoria.slug,
              }
            : row,
          columns,
        ),
      );
    if (rows.length > maxRows)
      throw new HttpError(
        413,
        "La exportación supera 10 000 filas. Usa filtros para dividirla.",
        "EXPORT_TOO_LARGE",
      );
    if (!batch.length || batch.length < 1000) break;
    after = batch.at(-1).id;
  }
  return rows;
}
function createExportService({
  secret = crypto.randomBytes(32),
  clock = () => Date.now(),
  ttlMs = 600000,
  maxRows = 10000,
  maxBytes = 10 * 1024 * 1024,
  maxSnapshots = 8,
  maxOwnerSnapshots = 2,
} = {}) {
  const snapshots = new Map();
  const reservations = new Map();
  const invalid = () =>
    new HttpError(
      400,
      "Cursor de exportación inválido o vencido.",
      "EXPORT_CURSOR_INVALID",
    );
  // Bind pagination to the same session without exposing its identifier in
  // the readable, signed cursor payload.
  const ownerKey = (actor) =>
    crypto
      .createHmac("sha256", secret)
      .update(`${actor.id}:${actor.sessionId || ""}`)
      .digest("base64url");
  function sweep() {
    for (const [key, value] of snapshots)
      if (value.expiresAt <= clock()) {
        clearTimeout(value.expiryTimer);
        snapshots.delete(key);
      }
  }
  function sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
  }
  function decode(value) {
    if (
      typeof value !== "string" ||
      value.length > 1500 ||
      !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(value)
    )
      throw invalid();
    const [body, signature] = value.split(".");
    const expected = crypto.createHmac("sha256", secret).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    )
      throw invalid();
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      throw invalid();
    }
  }
  function page(snapshot, position, limit) {
    const next = position + limit;
    if (next >= snapshot.rows.length) snapshot.completed = true;
    return {
      columns: COLUMNS[snapshot.table],
      rows: snapshot.rows.slice(position, next),
      nextCursor:
        next < snapshot.rows.length
          ? sign({
              v: 1,
              id: snapshot.id,
              owner: snapshot.owner,
              position: next,
              limit,
              exp: snapshot.expiresAt,
            })
          : null,
      snapshot: {
        id: snapshot.id,
        createdAt: snapshot.createdAt.toISOString(),
        expiresAt: new Date(snapshot.expiresAt).toISOString(),
        totalRows: snapshot.rows.length,
        table: snapshot.table,
        filters: snapshot.filters,
        maxId: snapshot.rows.at(-1)?.id ?? null,
        cutoff: snapshot.createdAt.toISOString(),
      },
    };
  }
  async function exportPage(db, actor, query = {}) {
    if (actor?.rol !== "ADMIN" || actor.bloqueado)
      throw new HttpError(403, "Solo administradores.");
    sweep();
    if (typeof query.table !== "string" || !Object.hasOwn(COLUMNS, query.table))
      throw new HttpError(400, "Tabla de exportación inválida.");
    const limit =
      query.limit === undefined
        ? 250
        : typeof query.limit === "string" && /^[1-9]\d*$/.test(query.limit)
          ? Number(query.limit)
          : NaN;
    if (!Number.isSafeInteger(limit) || limit > 250)
      throw new HttpError(400, "La página admite entre 1 y 250 filas.");
    const owner = ownerKey(actor);
    if (query.cursor !== undefined) {
      const cursor = decode(query.cursor),
        snapshot = snapshots.get(cursor.id);
      if (
        cursor.v !== 1 ||
        !snapshot ||
        cursor.owner !== owner ||
        snapshot.owner !== owner ||
        cursor.exp !== snapshot.expiresAt ||
        cursor.exp <= clock() ||
        snapshot.table !== query.table ||
        cursor.limit !== limit ||
        !Number.isSafeInteger(cursor.position) ||
        cursor.position < 1 ||
        cursor.position >= snapshot.rows.length
      )
        throw invalid();
      for (const field of ["district", "type"])
        if (
          query[field] !== undefined &&
          query[field] !== (snapshot.filters[field] ?? "")
        )
          throw invalid();
      return page(snapshot, cursor.position, limit);
    }
    const filters = await statisticsFilters(db, query);
    const pending = [...reservations.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    // Finished downloads remain briefly retryable, but do not occupy an owner's
    // active-download quota. Evict them first when the global bound is reached.
    for (const [key, row] of snapshots)
      if (snapshots.size + pending >= maxSnapshots && row.completed) {
        clearTimeout(row.expiryTimer);
        snapshots.delete(key);
      }
    const ownCount =
      [...snapshots.values()].filter(
        (row) => row.owner === owner && !row.completed,
      ).length + (reservations.get(owner) || 0);
    if (
      snapshots.size + pending >= maxSnapshots ||
      ownCount >= maxOwnerSnapshots
    )
      throw new HttpError(
        429,
        "Hay exportaciones abiertas. Espera a que venzan para iniciar otra.",
        "EXPORT_SNAPSHOT_LIMIT",
      );
    reservations.set(owner, (reservations.get(owner) || 0) + 1);
    try {
      const createdAt = new Date(clock());
      const rows = await db.$transaction(
        (transaction) =>
          collectExport(transaction, query.table, filters, createdAt, maxRows),
        { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 30000 },
      );
      if (rows.length > maxRows)
        throw new HttpError(
          413,
          "La exportación supera 10 000 filas. Usa filtros para dividirla.",
          "EXPORT_TOO_LARGE",
        );
      if (Buffer.byteLength(JSON.stringify(rows)) > maxBytes)
        throw new HttpError(
          413,
          "La exportación supera 10 MB. Usa filtros para dividirla.",
          "EXPORT_TOO_LARGE",
        );
      const snapshot = {
        id: crypto.randomBytes(24).toString("base64url"),
        owner,
        table: query.table,
        filters,
        rows,
        createdAt,
        expiresAt: clock() + ttlMs,
      };
      // Single-page downloads need no retained snapshot; multi-page downloads
      // retain their immutable projection until expiry, allowing safe retries.
      if (rows.length > limit) {
        snapshots.set(snapshot.id, snapshot);
        snapshot.expiryTimer = setTimeout(
          () => snapshots.delete(snapshot.id),
          ttlMs,
        );
        snapshot.expiryTimer.unref();
      }
      return page(snapshot, 0, limit);
    } finally {
      const count = (reservations.get(owner) || 1) - 1;
      if (count) reservations.set(owner, count);
      else reservations.delete(owner);
    }
  }
  return {
    exportPage,
    close() {
      for (const row of snapshots.values()) clearTimeout(row.expiryTimer);
      snapshots.clear();
    },
  };
}
const exportService = createExportService();
module.exports = {
  COLUMNS,
  createExportService,
  exportPage: exportService.exportPage,
  projectRow,
  statisticsRows,
};
