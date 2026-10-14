"use strict";

const { HttpError } = require("./http");
const { DISTRICTS } = require("./catalog");

// Peru uses UTC-5 all year. Keep event dates separate from insertion dates:
// importing older incidents today must not count them as today's events.
const OFFSET = 5 * 60 * 60 * 1000;
function monthStart(year, month) {
  return new Date(Date.UTC(year, month, 1) + OFFSET);
}
function statisticsPeriod(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new TypeError("Fecha de estadísticas inválida.");
  const local = new Date(now.getTime() - OFFSET);
  const year = local.getUTCFullYear(),
    month = local.getUTCMonth();
  const previous = monthStart(year, month - 1);
  const current = monthStart(year, month);
  const previousDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Compare elapsed days and time with the previous month; when that month
  // is shorter, its end is the greatest comparable exclusive boundary.
  const comparisonEnd =
    local.getUTCDate() > previousDays
      ? current
      : new Date(
          previous.getTime() +
            (local.getUTCDate() - 1) * 86400000 +
            local.getUTCHours() * 3600000 +
            local.getUTCMinutes() * 60000 +
            local.getUTCSeconds() * 1000 +
            local.getUTCMilliseconds(),
        );
  const months = Array.from({ length: 6 }, (_, index) => {
    const start = monthStart(year, month - 5 + index);
    const localStart = new Date(start.getTime() - OFFSET);
    return {
      month: `${localStart.getUTCFullYear()}-${String(localStart.getUTCMonth() + 1).padStart(2, "0")}`,
      label: new Intl.DateTimeFormat("es-PE", {
        month: "short",
        year: "numeric",
        timeZone: "America/Lima",
      }).format(start),
      start,
      end: index === 5 ? now : monthStart(year, month - 4 + index),
    };
  });
  return {
    start: months[0].start,
    end: now,
    currentMonth: { start: current, end: now },
    previousSameDays: { start: previous, end: comparisonEnd },
    previousFullMonth: { start: previous, end: current },
    months,
  };
}
function primitiveQuery(value, label) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 100)
    throw new HttpError(400, `${label} inválido.`);
  return value;
}
async function statisticsFilters(db, query = {}) {
  const district = primitiveQuery(query.district, "Distrito");
  const type = primitiveQuery(query.type, "Tipo");
  if (district !== null && !DISTRICTS.includes(district))
    throw new HttpError(400, "Distrito inválido.");
  if (type !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(type))
    throw new HttpError(400, "Tipo inválido.");
  if (
    type !== null &&
    !(await db.incidentType.findUnique({
      where: { slug: type },
      select: { id: true },
    }))
  )
    throw new HttpError(400, "Tipo de incidente no encontrado.");
  return { district, type };
}
function incidentScope(filters) {
  return {
    ...(filters.district ? { distrito: filters.district } : {}),
    ...(filters.type ? { tipoCatalogo: { slug: filters.type } } : {}),
  };
}
function grouped(rows, keyOf, labelOf = keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(keyOf(row));
    const entry = groups.get(key) || {
      key,
      label: String(labelOf(row)),
      count: 0,
    };
    entry.count++;
    groups.set(key, entry);
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"),
  );
}
const serialRange = ({ start, end }) => ({
  start: start.toISOString(),
  end: end.toISOString(),
});
const inside = (date, range) => date >= range.start && date < range.end;
function deltaPercent(current, previous) {
  return previous === 0
    ? null
    : Math.round(((current - previous) / previous) * 10000) / 100;
}
async function collectStatistics(db, filters, now = new Date()) {
  const period = statisticsPeriod(now);
  const scope = incidentScope(filters);
  const [incidents, reportDates, accounts] = await Promise.all([
    db.incident.findMany({
      where: { ...scope, fechaEvento: { gte: period.start, lt: period.end } },
      select: {
        tipo: true,
        distrito: true,
        nivelRiesgo: true,
        estado: true,
        publicado: true,
        fechaEvento: true,
        tipoCatalogo: {
          select: { slug: true, categoria: { select: { slug: true } } },
        },
      },
    }),
    db.report.findMany({
      where: {
        fechaEvento: { gte: period.start, lt: period.end },
        ...(filters.district
          ? { incidente: { distrito: filters.district } }
          : {}),
        ...(filters.type ? { tipoCatalogo: { slug: filters.type } } : {}),
      },
      select: { fechaEvento: true },
    }),
    db.user.groupBy({
      by: ["rol", "correoVerificado"],
      _count: { _all: true },
    }),
  ]);
  const roles = new Map();
  for (const row of accounts) {
    const entry = roles.get(row.rol) || {
      role: row.rol,
      count: 0,
      verified: 0,
      unverified: 0,
    };
    entry.count += row._count._all;
    entry[row.correoVerificado ? "verified" : "unverified"] += row._count._all;
    roles.set(row.rol, entry);
  }
  const accountRows = [...roles.values()].sort((a, b) =>
    a.role.localeCompare(b.role),
  );
  const crimes = incidents.filter(
    (row) => row.tipoCatalogo?.categoria.slug === "seguridad",
  );
  const comparison = (rows) => {
    const current = rows.filter((row) =>
      inside(row.fechaEvento, period.currentMonth),
    ).length;
    const previousSameDays = rows.filter((row) =>
      inside(row.fechaEvento, period.previousSameDays),
    ).length;
    return {
      current,
      previousSameDays,
      previousFullMonth: rows.filter((row) =>
        inside(row.fechaEvento, period.previousFullMonth),
      ).length,
      deltaPercent: deltaPercent(current, previousSameDays),
    };
  };
  const incidentComparison = comparison(incidents);
  const crimeComparison = comparison(crimes);
  return {
    generatedAt: now.toISOString(),
    timeZone: "America/Lima",
    filters,
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      currentMonth: serialRange(period.currentMonth),
      previousSameDays: serialRange(period.previousSameDays),
      previousFullMonth: serialRange(period.previousFullMonth),
      dateField: "fechaEvento",
      endExclusive: true,
    },
    accountScope: "ALL_ACCOUNTS",
    totals: {
      incidents: incidents.length,
      reports: reportDates.length,
      accounts: accountRows.reduce((sum, row) => sum + row.count, 0),
      verifiedAccounts: accountRows.reduce((sum, row) => sum + row.verified, 0),
      published: incidents.filter((row) => row.publicado).length,
      active: incidents.filter((row) =>
        ["ACTIVO", "VALIDADO"].includes(row.estado),
      ).length,
      validated: incidents.filter((row) => row.estado === "VALIDADO").length,
      resolved: incidents.filter((row) => row.estado === "RESUELTO").length,
      securityIncidents: crimes.length,
    },
    datasets: {
      types: grouped(
        incidents,
        (row) => row.tipoCatalogo?.slug || "sin-catalogo",
        (row) => row.tipo,
      ),
      districts: grouped(
        incidents,
        (row) => row.distrito || "sin-distrito",
        (row) => row.distrito || "Sin distrito",
      ),
      statuses: grouped(incidents, (row) => row.estado),
      severities: grouped(
        incidents,
        (row) => (row.nivelRiesgo === null ? "sin-evaluar" : row.nivelRiesgo),
        (row) =>
          row.nivelRiesgo === null ? "Sin evaluar" : `Nivel ${row.nivelRiesgo}`,
      ),
      timeline: period.months.map((range) => ({
        month: range.month,
        label: range.label,
        incidents: incidents.filter((row) => inside(row.fechaEvento, range))
          .length,
        reports: reportDates.filter((row) => inside(row.fechaEvento, range))
          .length,
        crimes: crimes.filter((row) => inside(row.fechaEvento, range)).length,
      })),
      accounts: accountRows,
    },
    incidentComparison,
    crimeComparison,
  };
}
async function adminStatistics(db, query = {}, now = new Date()) {
  const filters = await statisticsFilters(db, query);
  return db.$transaction(
    (transaction) => collectStatistics(transaction, filters, now),
    { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 30000 },
  );
}
module.exports = {
  adminStatistics,
  collectStatistics,
  statisticsFilters,
  incidentScope,
  statisticsPeriod,
  deltaPercent,
};
