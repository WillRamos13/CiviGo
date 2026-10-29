"use strict";
const { randomUUID, createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { HttpError } = require("./http");
const PREFIX = "telemetry:v1:",
  RETENTION = 7 * 86400000;
const BUCKETS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];
const PAGES = new Set([
  "/",
  "/mapa",
  "/reportar",
  "/ingresar",
  "/registro",
  "/perfil",
  "/mis-reportes",
  "/alertas",
  "/ranking",
  "/recompensas",
  "/premium",
  "/contactanos",
  "/verificar",
]);
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function routeFamily(path) {
  return (
    /^\/api\/(users|incidents|reports|navigation|uploads|catalog|payments|admin|announcements|chatbot|history|contact)(?:\/|$)/.exec(
      path,
    )?.[1] || "otros"
  );
}
function emptyHistogram() {
  return Array(BUCKETS.length).fill(0);
}
function observe(histogram, ms) {
  histogram[
    BUCKETS.findIndex((limit) => ms <= limit) >= 0
      ? BUCKETS.findIndex((limit) => ms <= limit)
      : BUCKETS.length - 1
  ]++;
}
function percentile(histogram, quantile) {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let sum = 0;
  for (let i = 0; i < histogram.length; i++) {
    sum += histogram[i];
    if (sum >= total * quantile) return BUCKETS[i];
  }
  return null;
}
function createTelemetry({ db, now = Date.now, enabled = true } = {}) {
  const instance = randomUUID(),
    started = now(),
    buckets = new Map(),
    presence = new Map(),
    pages = new Map();
  let flushing = null,
    lastPersisted = null,
    lastFailure = null,
    lastCleanup = 0;
  const minute = () => {
    const key = new Date(now()).toISOString().slice(0, 16);
    if (!buckets.has(key))
      buckets.set(key, {
        at: key,
        count: 0,
        errors: 0,
        clientErrors: 0,
        totalMs: 0,
        hist: emptyHistogram(),
        routes: {},
        views: 0,
        vitals: {},
      });
    // Keep memory bounded even during a database outage.
    while (buckets.size > 120) buckets.delete(buckets.keys().next().value);
    return buckets.get(key);
  };
  function middleware(req, res, next) {
    if (
      !enabled ||
      !req.path.startsWith("/api/") ||
      /^\/api\/(health|ready|telemetry|admin\/control)(\/|$)/.test(req.path)
    )
      return next();
    const start = performance.now(),
      family = routeFamily(req.path);
    res.once("finish", () => {
      const bucket = minute(),
        ms = Math.min(60000, Math.max(0, performance.now() - start));
      bucket.count++;
      bucket.totalMs += ms;
      bucket.errors += Number(res.statusCode >= 500);
      bucket.clientErrors += Number(
        res.statusCode >= 400 && res.statusCode < 500,
      );
      observe(bucket.hist, ms);
      const row = bucket.routes[family] || {
        count: 0,
        errors: 0,
        totalMs: 0,
        hist: emptyHistogram(),
      };
      row.count++;
      row.errors += Number(res.statusCode >= 500);
      row.totalMs += ms;
      observe(row.hist, ms);
      bucket.routes[family] = row;
    });
    next();
  }
  function client(body, user) {
    if (!enabled) return;
    if (
      !body ||
      !uuid(body.session) ||
      !uuid(body.pageId) ||
      !PAGES.has(body.path) ||
      !["web", "mobile"].includes(body.platform) ||
      typeof body.visible !== "boolean"
    )
      throw new HttpError(400, "Métrica inválida.");
    const stamp = now(),
      id =
        user && !user.bloqueado
          ? `u:${createHash("sha256").update(`civigo-online:${user.id}`).digest("hex")}`
          : `s:${body.session}`;
    const presenceKey = body.session;
    for (const [key, row] of presence)
      if (stamp - row.at > 120000) presence.delete(key);
    for (const [key, row] of pages)
      if (stamp - row.at > 3600000) pages.delete(key);
    if (!body.visible) {
      presence.delete(presenceKey);
      return;
    }
    if (presence.size < 3000 || presence.has(presenceKey))
      presence.set(presenceKey, {
        id,
        at: stamp,
        platform: body.platform,
        authenticated: id.startsWith("u:"),
      });
    const pageKey = `${body.session}:${body.pageId}`,
      previous = pages.get(pageKey);
    if (!previous && pages.size >= 10000) return;
    const bucket = minute();
    if (!previous) {
      bucket.views++;
      pages.set(pageKey, { at: stamp, vitals: false });
    }
    if (body.vitals && !previous?.vitals) {
      const accepted = {};
      for (const [key, max] of Object.entries({
        ttfb: 60000,
        lcp: 60000,
        cls: 10,
      })) {
        const value = body.vitals[key];
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= max
        )
          accepted[key] = value;
      }
      if (Object.keys(accepted).length) {
        const row = bucket.vitals[body.path] || {
          views: 0,
          ttfb: { sum: 0, count: 0 },
          lcp: { sum: 0, count: 0 },
          cls: { sum: 0, count: 0 },
        };
        row.views++;
        for (const [key, value] of Object.entries(accepted)) {
          row[key].sum += value;
          row[key].count++;
        }
        bucket.vitals[body.path] = row;
        pages.get(pageKey).vitals = true;
      }
    }
  }
  async function persist() {
    if (!enabled) return;
    if (flushing) return flushing;
    flushing = (async () => {
      const stamp = now(),
        hours = new Map();
      for (const bucket of buckets.values()) {
        const hour = bucket.at.slice(0, 13),
          list = hours.get(hour) || [];
        list.push(structuredClone(bucket));
        hours.set(hour, list);
      }
      const currentHour = new Date(stamp).toISOString().slice(0, 13);
      for (const [hour, minutes] of hours) {
        const clave = `${PREFIX}${hour}:${instance}`,
          valor = {
            instance,
            started,
            at: stamp,
            minutes,
            presence:
              hour === currentHour
                ? [...presence]
                    .filter(([, row]) => stamp - row.at <= 120000)
                    .map(([id, row]) => ({ id, ...row }))
                : [],
          };
        await db.appConfig.upsert({
          where: { clave },
          create: { clave, valor },
          update: { valor },
        });
      }
      lastPersisted = stamp;
      lastFailure = null;
      if (stamp - lastCleanup > 3600000) {
        await db.appConfig.deleteMany({
          where: {
            clave: { startsWith: PREFIX },
            actualizadoEn: { lt: new Date(stamp - RETENTION) },
          },
        });
        lastCleanup = stamp;
      }
    })()
      .catch((error) => {
        lastFailure = now();
        console.warn("Telemetría pendiente:", error.code || error.name);
      })
      .finally(() => {
        flushing = null;
      });
    return flushing;
  }
  async function snapshot() {
    await persist();
    const stamp = now(),
      since = new Date(stamp - 86400000),
      rows = await db.appConfig.findMany({
        where: { clave: { startsWith: PREFIX }, actualizadoEn: { gte: since } },
        select: { valor: true },
      });
    const merged = new Map(),
      online = new Map(),
      routes = {},
      vitals = {};
    let first = null;
    for (const { valor } of rows) {
      if (!valor || !Array.isArray(valor.minutes)) continue;
      first = first === null ? valor.started : Math.min(first, valor.started);
      for (const row of valor.presence || [])
        if (stamp - row.at <= 120000) online.set(row.id, row);
      for (const row of valor.minutes) {
        if (Date.parse(row.at + ":00Z") < since.getTime()) continue;
        const out = merged.get(row.at) || {
          at: row.at,
          count: 0,
          errors: 0,
          clientErrors: 0,
          totalMs: 0,
          hist: emptyHistogram(),
          views: 0,
        };
        for (const key of [
          "count",
          "errors",
          "clientErrors",
          "totalMs",
          "views",
        ])
          out[key] += row[key] || 0;
        row.hist.forEach((value, i) => (out.hist[i] += value));
        merged.set(row.at, out);
        for (const [key, value] of Object.entries(row.routes || {})) {
          const item = routes[key] || {
            label: key,
            count: 0,
            errors: 0,
            totalMs: 0,
            hist: emptyHistogram(),
          };
          item.count += value.count;
          item.errors += value.errors;
          item.totalMs += value.totalMs;
          value.hist.forEach((n, i) => (item.hist[i] += n));
          routes[key] = item;
        }
        for (const [path, value] of Object.entries(row.vitals || {})) {
          const item = vitals[path] || {
            path,
            views: 0,
            ttfb: { sum: 0, count: 0 },
            lcp: { sum: 0, count: 0 },
            cls: { sum: 0, count: 0 },
          };
          item.views += value.views;
          for (const key of ["ttfb", "lcp", "cls"]) {
            item[key].sum += value[key].sum;
            item[key].count += value[key].count;
          }
          vitals[path] = item;
        }
      }
    }
    const timeline = [...merged.values()].sort((a, b) =>
        a.at.localeCompare(b.at),
      ),
      hist = emptyHistogram();
    let count = 0,
      errors = 0,
      totalMs = 0,
      views = 0,
      clientErrors = 0;
    for (const row of timeline) {
      count += row.count;
      errors += row.errors;
      clientErrors += row.clientErrors;
      totalMs += row.totalMs;
      views += row.views;
      row.hist.forEach((n, i) => (hist[i] += n));
    }
    let databaseMs = null,
      databaseOk = false;
    const ping = performance.now();
    try {
      await db.$queryRaw`SELECT 1`;
      databaseOk = true;
      databaseMs = Math.round(performance.now() - ping);
    } catch {
      /* Health failure is represented explicitly. */
    }
    return {
      enabled,
      generatedAt: new Date(stamp).toISOString(),
      since: first
        ? new Date(Math.max(first, since.getTime())).toISOString()
        : null,
      lastPersisted: lastPersisted
        ? new Date(lastPersisted).toISOString()
        : null,
      persistenceError: !!lastFailure,
      online: {
        users: [...online.values()].filter((row) => row.authenticated).length,
        visitors: [...online.values()].filter((row) => !row.authenticated)
          .length,
        web: [...online.values()].filter((row) => row.platform === "web")
          .length,
        mobile: [...online.values()].filter((row) => row.platform === "mobile")
          .length,
      },
      api: {
        count,
        errors,
        clientErrors,
        meanMs: count ? Math.round(totalMs / count) : null,
        p50Ms: percentile(hist, 0.5),
        p95Ms: percentile(hist, 0.95),
        errorPercent: count ? Math.round((errors / count) * 10000) / 100 : null,
        views,
      },
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
        databaseOk,
        databaseMs,
      },
      timeline: timeline.map((row) => ({
        at: row.at,
        count: row.count,
        errors: row.errors,
        views: row.views,
        meanMs: row.count ? Math.round(row.totalMs / row.count) : null,
      })),
      routes: Object.values(routes).map((row) => ({
        label: row.label,
        count: row.count,
        errors: row.errors,
        meanMs: Math.round(row.totalMs / row.count),
        p95Ms: percentile(row.hist, 0.95),
      })),
      pages: Object.values(vitals).map((row) => ({
        path: row.path,
        samples: row.views,
        ...Object.fromEntries(
          ["ttfb", "lcp", "cls"].map((key) => [
            key,
            row[key].count
              ? Math.round((row[key].sum / row[key].count) * 1000) / 1000
              : null,
          ]),
        ),
      })),
      notes: [
        "Ventana de 24 horas; retención de agregados: 7 días. Se empieza a medir al publicar esta versión.",
        "En línea: actividad visible en los últimos 120 segundos; usuarios autenticados únicos y sesiones visitantes estimadas. No es el total de cuentas con sesión abierta.",
        "p50 y p95 son límites superiores de intervalos de latencia. No son tiempos exactos individuales.",
        "Las métricas de página dependen del navegador y de que el cliente pueda enviarlas. No se guardan IP, textos, coordenadas ni correos.",
        "La memoria y el estado de base de datos corresponden a esta instancia. No se mide disponibilidad externa ni se inventan visitas anteriores.",
      ],
    };
  }
  function start() {
    if (!enabled) return () => {};
    const timer = setInterval(() => void persist(), 60000);
    timer.unref();
    return () => clearInterval(timer);
  }
  return { middleware, client, persist, snapshot, start };
}
let singleton;
function telemetry() {
  return (singleton ||= createTelemetry({
    db: require("./db"),
    enabled:
      process.env.TELEMETRY_ENABLED !== "false" &&
      process.env.NODE_ENV !== "test",
  }));
}
module.exports = { createTelemetry, telemetry, percentile, routeFamily };
