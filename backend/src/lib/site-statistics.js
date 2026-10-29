"use strict";
const { statisticsPeriod, deltaPercent } = require("./admin-statistics");
const { premiumEnd } = require("./payments");
const group = (rows, label) =>
  rows.map((row) => ({ label: String(label(row)), count: row._count._all }));
// Only aggregates leave this service. Credentials, evidence, route coordinates and
// individual browsing histories are never part of the dashboard response.
async function collectSiteStatistics(tx, now = new Date()) {
  const period = statisticsPeriod(now);
  const [
    incidents,
    accounts,
    reportStates,
    attachments,
    votes,
    messages,
    flags,
    appeals,
    rewards,
    redemptions,
    points,
    favorites,
    history,
    ads,
    announcements,
    businesses,
    providers,
    orders,
    paidGrants,
  ] = await Promise.all([
    tx.incident.findMany({
      select: {
        fechaEvento: true,
        historico: true,
        fuente: true,
        evaluacion: true,
        distrito: true,
        tipo: true,
        publicado: true,
        nivelRiesgo: true,
        tipoCatalogo: { select: { categoria: { select: { slug: true } } } },
      },
    }),
    tx.user.findMany({
      select: {
        id: true,
        fechaCreacion: true,
        rol: true,
        correoVerificado: true,
        bloqueado: true,
        premium: true,
        monedas: true,
      },
    }),
    tx.report.groupBy({ by: ["estado"], _count: { _all: true } }),
    tx.attachment.groupBy({
      by: ["privado", "mimeType"],
      _count: { _all: true },
      _sum: { size: true },
    }),
    tx.vote.groupBy({ by: ["tipo"], _count: { _all: true } }),
    tx.chatMessage.count(),
    tx.flag.groupBy({ by: ["estado"], _count: { _all: true } }),
    tx.appeal.groupBy({ by: ["estado"], _count: { _all: true } }),
    tx.reward.aggregate({ _count: { _all: true }, _sum: { stock: true } }),
    tx.redemption.groupBy({
      by: ["estado"],
      _count: { _all: true },
      _sum: { costoMonedas: true },
    }),
    tx.pointEvent.groupBy({
      by: ["tipo"],
      _count: { _all: true },
      _sum: { puntos: true },
    }),
    tx.routeFavorite.groupBy({ by: ["modo"], _count: { _all: true } }),
    tx.routeHistory.groupBy({ by: ["modo"], _count: { _all: true } }),
    tx.adImpression.count(),
    tx.mapAnnouncement.groupBy({
      by: ["ubicacion", "activo"],
      _count: { _all: true },
    }),
    tx.business.count({ where: { activo: true } }),
    tx.externalApiUsage.findMany({
      where: { mes: now.toISOString().slice(0, 7) },
      select: { proveedor: true, producto: true, usadas: true },
    }),
    tx.appConfig.findMany({
      where: { clave: { startsWith: "payments:order:" } },
      select: { valor: true },
    }),
    tx.appConfig.findMany({
      where: { clave: { startsWith: "premium:paid:" } },
      select: { clave: true, valor: true },
    }),
  ]);
  const counts = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      const label = String(key(row));
      map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  };
  const inRange = (date, range) => date >= range.start && date < range.end;
  const comparisons = (field) => {
    const groups = new Map();
    for (const row of incidents) {
      if (
        !inRange(row.fechaEvento, period.previousFullMonth) &&
        !inRange(row.fechaEvento, period.currentMonth)
      )
        continue;
      const label = row[field] || "Sin distrito";
      const entry = groups.get(label) || { label, current: 0, previous: 0 };
      if (inRange(row.fechaEvento, period.currentMonth)) entry.current++;
      if (inRange(row.fechaEvento, period.previousSameDays)) entry.previous++;
      groups.set(label, entry);
    }
    return [...groups.values()]
      .map((row) => ({
        ...row,
        deltaPercent: deltaPercent(row.current, row.previous),
      }))
      .sort((a, b) => b.current - a.current);
  };
  const currentPayments = orders
    .map((row) => row.valor)
    .filter((row) => row && typeof row === "object");
  const approved = currentPayments.filter(
    (row) => row.estado === "approved" && row.modo === "production",
  );
  const localDate = (date) => new Date(date.getTime() - 5 * 3600000);
  const paidUsers = new Set(
    paidGrants
      .filter((row) => premiumEnd(row.valor?.periodos || []) > now.getTime())
      .map((row) => Number(row.clave.slice("premium:paid:".length))),
  );
  return {
    generatedAt: now.toISOString(),
    scope: "GLOBAL_ALL_TIME",
    timeZone: "America/Lima",
    totals: {
      incidents: incidents.length,
      historical: incidents.filter((row) => row.historico).length,
      unevaluated: incidents.filter((row) => row.nivelRiesgo === null).length,
      accounts: accounts.length,
      blocked: accounts.filter((row) => row.bloqueado).length,
      premium: accounts.filter((row) => row.premium || paidUsers.has(row.id))
        .length,
      premiumManual: accounts.filter((row) => row.premium).length,
      premiumPaid: accounts.filter((row) => paidUsers.has(row.id)).length,
      coinBalance: accounts.reduce((sum, row) => sum + row.monedas, 0),
      messages,
      adImpressions: ads,
      activeBusinesses: businesses,
      attachments: attachments.reduce((sum, row) => sum + row._count._all, 0),
      attachmentBytes: attachments.reduce(
        (sum, row) => sum + (row._sum.size || 0),
        0,
      ),
      rewardCatalog: rewards._count._all,
      rewardStock: rewards._sum.stock || 0,
      approvedProductionPayments: approved.length,
      productionRevenueCents: approved.reduce(
        (sum, row) => sum + (row.centimos || 0),
        0,
      ),
    },
    charts: {
      years: counts(incidents, (row) =>
        localDate(row.fechaEvento).getUTCFullYear(),
      ).sort((a, b) => a.label.localeCompare(b.label)),
      sources: counts(incidents, (row) => row.fuente),
      evaluations: counts(incidents, (row) => row.evaluacion),
      hours: Array.from({ length: 24 }, (_, hour) => ({
        label: `${String(hour).padStart(2, "0")}:00`,
        count: incidents.filter(
          (row) =>
            !row.historico && localDate(row.fechaEvento).getUTCHours() === hour,
        ).length,
      })),
      weekdays: [
        "Domingo",
        "Lunes",
        "Martes",
        "Miércoles",
        "Jueves",
        "Viernes",
        "Sábado",
      ].map((label, day) => ({
        label,
        count: incidents.filter(
          (row) => localDate(row.fechaEvento).getUTCDay() === day,
        ).length,
      })),
      registrations: period.months.map((range) => ({
        label: range.label,
        count: accounts.filter((row) => inRange(row.fechaCreacion, range))
          .length,
      })),
      reportStates: group(reportStates, (row) => row.estado),
      votes: group(votes, (row) => row.tipo),
      flags: group(flags, (row) => row.estado),
      appeals: group(appeals, (row) => row.estado),
      redemptions: group(redemptions, (row) => row.estado),
      points: points.map((row) => ({
        label: row.tipo,
        count: row._sum.puntos || 0,
      })),
      favorites: group(favorites, (row) => row.modo),
      routeHistory: group(history, (row) => row.modo),
      announcements: group(
        announcements,
        (row) => `${row.ubicacion} · ${row.activo ? "Activo" : "Inactivo"}`,
      ),
      providers: providers.map((row) => ({
        label: `${row.proveedor} · ${row.producto}`,
        count: row.usadas,
      })),
      payments: counts(currentPayments, (row) => `${row.modo} · ${row.estado}`),
      attachmentTypes: group(
        attachments,
        (row) => `${row.mimeType} · ${row.privado ? "Privado" : "Público"}`,
      ),
    },
    districtComparison: comparisons("distrito"),
    typeComparison: comparisons("tipo"),
    comparisonPeriod: {
      current: period.currentMonth.start.toISOString(),
      previous: period.previousSameDays.start.toISOString(),
      previousEnd: period.previousSameDays.end.toISOString(),
    },
    notes: [
      "Las cifras de incidentes usan la fecha del hecho; los registros históricos no son emergencias actuales. El gráfico de horas excluye antecedentes porque su hora puede ser desconocida.",
      "Los recorridos guardados no equivalen a todos los viajes realizados.",
      "Los ingresos excluyen pruebas, devoluciones y pagos sin aprobación. Una cuenta puede tener Premium manual y de pago a la vez; el total cuenta cada cuenta una sola vez.",
      "Las comparaciones mensuales usan los mismos días transcurridos. Sin base anterior no se calcula porcentaje.",
    ],
  };
}
async function siteStatistics(db, now = new Date()) {
  return db.$transaction((tx) => collectSiteStatistics(tx, now), {
    isolationLevel: "RepeatableRead",
    maxWait: 10000,
    timeout: 30000,
  });
}
const snapshots = new WeakMap();
async function cachedSiteStatistics(db) {
  const cached = snapshots.get(db);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = siteStatistics(db).catch((error) => {
    if (snapshots.get(db)?.promise === promise) snapshots.delete(db);
    throw error;
  });
  snapshots.set(db, { expires: Date.now() + 60000, promise });
  return promise;
}
module.exports = {
  siteStatistics,
  collectSiteStatistics,
  cachedSiteStatistics,
};
