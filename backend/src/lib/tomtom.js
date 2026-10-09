"use strict";
const { createHash } = require("node:crypto");
const { FREE_LIMITS, limits } = require("./traffic-quota");
class TrafficUnavailable extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "TrafficUnavailable";
  }
}
const MESSAGES = {
  NOT_CONFIGURED: "Sin tráfico actualizado: TomTom no está configurado.",
  DISABLED:
    "Sin tráfico actualizado: la conexión TomTom todavía no está habilitada.",
  QUOTA_EXHAUSTED:
    "Sin tráfico actualizado: se alcanzó la cuota gratuita asignada a CiviGo.",
  QUOTA_UNAVAILABLE:
    "Sin tráfico actualizado: no se pudo verificar la cuota del proveedor.",
  PROVIDER_UNAVAILABLE:
    "Sin tráfico actualizado: el proveedor no está disponible.",
  BUSY: "Sin tráfico actualizado: el servicio está ocupado. Intenta más tarde.",
};
function unavailable(code) {
  return new TrafficUnavailable(
    code,
    MESSAGES[code] || MESSAGES.PROVIDER_UNAVAILABLE,
  );
}
function configured(env) {
  return Boolean(String(env.TOMTOM_API_KEY || "").trim());
}
function createTomTomClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  quota,
  now = () => new Date(),
} = {}) {
  const cache = new Map(),
    pending = new Map();
  let active = 0,
    blockedUntil = 0;
  const configuration = () => ({
    configurado: configured(env),
    habilitado: env.TOMTOM_ENABLED === "true",
    conexionesProbadas: false,
    api: {
      routing: "Orbis v3 (auto)",
      incidents: "Orbis v2",
      flow: "Orbis v2",
      search: "Fuzzy Search v2 (lugares y direcciones)",
    },
    limites: limits(env),
    limitesGratuitos: FREE_LIMITS,
    alcanceCuota:
      "Uso de CiviGo; comparte los límites con cualquier otra aplicación del mismo proveedor.",
    variablesPendientes: configured(env)
      ? env.TOMTOM_ENABLED === "true"
        ? []
        : ["TOMTOM_ENABLED"]
      : ["TOMTOM_API_KEY", "TOMTOM_ENABLED"],
  });
  async function request(
    product,
    path,
    { body, attributes, binary = false, ttl = 60000, queryKey = false } = {},
  ) {
    if (!configured(env)) throw unavailable("NOT_CONFIGURED");
    if (env.TOMTOM_ENABLED !== "true") throw unavailable("DISABLED");
    const key = createHash("sha256")
      .update(JSON.stringify([product, path, body, attributes]))
      .digest("hex");
    const existing = cache.get(key);
    if (existing && existing.expires > now().getTime()) return existing.value;
    if (pending.has(key)) return pending.get(key);
    if (now().getTime() < blockedUntil)
      throw unavailable("PROVIDER_UNAVAILABLE");
    if (active >= 4) throw unavailable("BUSY");
    active++;
    const promise = (async () => {
      try {
        let allowed;
        try {
          allowed = await quota?.reserve(product, now());
        } catch {
          throw unavailable("QUOTA_UNAVAILABLE");
        }
        if (!quota) throw unavailable("QUOTA_UNAVAILABLE");
        if (!allowed) throw unavailable("QUOTA_EXHAUSTED");
        // Search v2 authenticates through its query string. Construct that
        // URL only on the server and never expose upstream errors or payloads.
        const url = new URL(`https://api.tomtom.com${path}`);
        if (queryKey)
          url.searchParams.set("key", String(env.TOMTOM_API_KEY).trim());
        const response = await fetchImpl(url.href, {
          method: body ? "POST" : "GET",
          headers: {
            "TomTom-Api-Key": String(env.TOMTOM_API_KEY).trim(),
            "Accept-Language": "es-ES",
            Accept: binary ? "image/png" : "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(attributes ? { Attributes: attributes } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        });
        // Never surface upstream error messages/URLs; they can echo credentials.
        if (!response.ok) throw unavailable("PROVIDER_UNAVAILABLE");
        const maximum = binary ? 524288 : 2097152;
        const length = Number(response.headers?.get("content-length") || 0);
        if (length > maximum) throw unavailable("PROVIDER_UNAVAILABLE");
        const reader = response.body?.getReader();
        let bytes;
        if (reader) {
          const chunks = [];
          let size = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maximum) {
              await reader.cancel();
              throw unavailable("PROVIDER_UNAVAILABLE");
            }
            chunks.push(Buffer.from(value));
          }
          bytes = Buffer.concat(chunks);
        } else bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > maximum) throw unavailable("PROVIDER_UNAVAILABLE");
        if (
          binary &&
          !bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          throw unavailable("PROVIDER_UNAVAILABLE");
        const value = {
          data: binary ? bytes : JSON.parse(bytes.toString("utf8")),
          actualizadoEn: now().toISOString(),
        };
        if (cache.size >= 512) cache.delete(cache.keys().next().value);
        cache.set(key, { value, expires: now().getTime() + ttl });
        return value;
      } catch (error) {
        if (error instanceof TrafficUnavailable) {
          if (error.code === "PROVIDER_UNAVAILABLE")
            blockedUntil = now().getTime() + 60000;
          throw error;
        }
        blockedUntil = now().getTime() + 60000;
        throw unavailable("PROVIDER_UNAVAILABLE");
      } finally {
        active--;
        pending.delete(key);
      }
    })();
    pending.set(key, promise);
    return promise;
  }
  return {
    configuration,
    async status() {
      let cuotas = null;
      try {
        cuotas = await quota?.status(now());
      } catch {
        /* inspection is still useful when migrations are pending */
      }
      return {
        ...configuration(),
        cuotas,
        controlCuotaDisponible: cuotas !== null,
      };
    },
    route(route) {
      const coords = route.geometria.coordinates;
      return request(
        "routing",
        "/maps/orbis/routing/routes/calculate?apiVersion=3",
        {
          body: {
            routePlanningLocations: {
              origin: { type: "Point", coordinates: coords[0] },
              destination: { type: "Point", coordinates: coords.at(-1) },
            },
            path: { type: "LineString", coordinates: coords },
            travelMode: "car",
            traffic: "live",
            departureDateTime: "now",
            routeType: "fast",
            maxPathAlternativeRoutes: 0,
          },
          attributes:
            "routes.summary,routes.legs.path,routes.progressPoints,routes.sections.traffic,routes.sections.travelMode",
          ttl: 90000,
        },
      );
    },
    incidents(bbox) {
      return request(
        "incidents",
        `/maps/orbis/traffic/incidents/details?apiVersion=2&bbox=${bbox.join(",")}&timeValidity=present`,
        {
          attributes:
            "incidents(type,geometry(type,coordinates),properties(id,iconCategory,events,startTime,endTime,from,to,delayInSeconds,timeValidity))",
          ttl: 2400000,
        },
      );
    },
    tile(z, x, y) {
      return request(
        "tiles",
        `/maps/orbis/traffic/flow/raster/tile/${z}/${x}/${y}?apiVersion=2&style=light&tileSize=256`,
        { binary: true, ttl: 120000 },
      );
    },
    search(query, bounds) {
      const canonical = query
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
      const parameters = new URLSearchParams({
        typeahead: "true",
        countrySet: "PE",
        language: "es-ES",
        limit: "20",
        geobias: "point:-14.0640293,-75.7290741",
        topLeft: `${bounds.north},${bounds.west}`,
        btmRight: `${bounds.south},${bounds.east}`,
      });
      return request(
        "search",
        `/search/2/search/${encodeURIComponent(canonical)}.json?${parameters}`,
        { ttl: 3600000, queryKey: true },
      );
    },
  };
}
module.exports = { createTomTomClient, TrafficUnavailable, unavailable };
