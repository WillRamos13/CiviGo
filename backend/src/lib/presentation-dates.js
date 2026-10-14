"use strict";

const { createHash } = require("node:crypto");
const VERSION = "presentation-six-months-v1";
const WEIGHTS = [8, 10, 14, 18, 24, 26];
const OFFSET = 5 * 60 * 60 * 1000;
const digest = (value) =>
  createHash("sha256").update(value).digest().readUInt32BE(0);
const fail = (message) => {
  throw Object.assign(new Error(message), { code: "PRESENTATION_DATES" });
};

function planPresentationDates({
  incidents,
  now = new Date(),
  seed = VERSION,
} = {}) {
  const current = new Date(now);
  if (
    !Number.isFinite(+current) ||
    typeof seed !== "string" ||
    !seed ||
    seed.length > 200 ||
    !Array.isArray(incidents) ||
    ![500, 550].includes(incidents.length)
  )
    fail(
      "La distribución de fechas requiere la carga inicial completa y una fecha válida.",
    );
  const identifiers = new Set(),
    reportIds = new Set();
  for (const incident of incidents) {
    if (
      !Number.isSafeInteger(incident.id) ||
      incident.id < 1 ||
      identifiers.has(incident.id) ||
      incident.fuente !== "CARGA_INICIAL" ||
      !Array.isArray(incident.reportes) ||
      incident.reportes.length !== 1 ||
      !Number.isSafeInteger(incident.reportes[0].id) ||
      reportIds.has(incident.reportes[0].id)
    )
      fail(
        "Sólo se redistribuyen las fechas de los pares únicos de la carga inicial.",
      );
    identifiers.add(incident.id);
    reportIds.add(incident.reportes[0].id);
  }
  const localNow = new Date(+current - OFFSET);
  const year = localNow.getUTCFullYear(),
    month = localNow.getUTCMonth();
  const quotas = WEIGHTS.map((weight) =>
    Math.floor((incidents.length * weight) / 100),
  );
  quotas[quotas.length - 1] +=
    incidents.length - quotas.reduce((sum, count) => sum + count, 0);
  const records = incidents
    .slice()
    .sort(
      (a, b) =>
        digest(seed + ":order:" + a.id) - digest(seed + ":order:" + b.id) ||
        a.id - b.id,
    );
  const entries = [],
    countsByMonth = {};
  let cursor = 0;
  for (let index = 0; index < quotas.length; index++) {
    const monthStart = new Date(Date.UTC(year, month - 5 + index, 1));
    const monthYear = monthStart.getUTCFullYear(),
      monthNumber = monthStart.getUTCMonth();
    const monthEnd = Date.UTC(monthYear, monthNumber + 1, 1) + OFFSET - 1;
    const cutoff = Math.min(monthEnd, +current);
    const maximumDay =
      index === 5
        ? localNow.getUTCDate()
        : new Date(Date.UTC(monthYear, monthNumber + 1, 0)).getUTCDate();
    const key = `${monthYear}-${String(monthNumber + 1).padStart(2, "0")}`;
    countsByMonth[key] = quotas[index];
    for (let ordinal = 0; ordinal < quotas[index]; ordinal++) {
      const incident = records[cursor++],
        salt = seed + ":date:" + incident.id;
      const day = 1 + (digest(salt + ":day") % maximumDay);
      const hour = 9 + (digest(salt + ":hour") % 9);
      const minute = digest(salt + ":minute") % 60,
        second = digest(salt + ":second") % 60;
      const delay = (5 + (digest(salt + ":delay") % 41)) * 60000;
      const publicationDelay =
        (1 + (digest(salt + ":publication") % 10)) * 60000;
      let event = Date.UTC(
        monthYear,
        monthNumber,
        day,
        hour + 5,
        minute,
        second,
        incident.id % 1000,
      );
      if (event + delay + publicationDelay > cutoff) {
        const start = Date.UTC(monthYear, monthNumber, 1) + OFFSET;
        event = Math.max(
          start,
          cutoff - delay - publicationDelay - (digest(salt + ":clamp") % 60000),
        );
      }
      const created = Math.min(cutoff, event + delay),
        published = Math.min(cutoff, created + publicationDelay);
      entries.push({
        incidenteId: incident.id,
        reporteId: incident.reportes[0].id,
        fechaEvento: new Date(event),
        fechaCreacion: new Date(created),
        fechaPublicacion: new Date(published),
      });
    }
  }
  return {
    entries,
    summary: {
      version: VERSION,
      synthetic: true,
      basis:
        "Fechas de escenario para una presentación; no corresponden a hechos reales verificados",
      timezone: "America/Lima",
      total: entries.length,
      countsByMonth,
      preparedAt: current.toISOString(),
    },
  };
}

module.exports = { planPresentationDates, VERSION };
