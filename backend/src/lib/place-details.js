"use strict";
const { normalizePlaceName, significantTokens } = require("./local-places");
const { distance, HttpError } = require("./http");
function safeUrl(value, hosts) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!hosts ||
        hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h)))
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function curatedDetails(place) {
  const name = normalizePlaceName(place.nombre);
  if (
    name.includes("universidad tecnologica") &&
    distance(place, { latitud: -14.072125, longitud: -75.735996 }) < 700
  )
    return {
      fotos: [
        {
          url: "https://www.utp.edu.pe/sites/default/files/campus/Ica-600x600.webp",
          autor: "Universidad Tecnológica del Perú",
          fuente: "https://www.utp.edu.pe/ica",
          descripcion: "Sede Ica publicada por la UTP",
        },
      ],
      fuente: "UTP",
      fuenteUrl: "https://www.utp.edu.pe/como-llegar",
    };
  return { fotos: [] };
}
function normalizeDetails(data) {
  const photos = (Array.isArray(data.photos) ? data.photos : [])
    .slice(0, 6)
    .flatMap((photo) => {
      const url = safeUrl(`${photo.prefix || ""}800x600${photo.suffix || ""}`, [
        "4sqi.net",
      ]);
      return url
        ? [
            {
              url,
              autor:
                typeof photo.user?.first_name === "string"
                  ? photo.user.first_name.slice(0, 80)
                  : "Foursquare",
              fuente: "https://foursquare.com/",
              descripcion: "Fotografía del lugar en Foursquare",
            },
          ]
        : [];
    });
  return {
    fotos: photos,
    fuente: "Foursquare",
    fuenteUrl: "https://foursquare.com/",
    consultadoEn: new Date().toISOString(),
    horario:
      typeof data.hours?.display === "string"
        ? data.hours.display.slice(0, 900)
        : null,
    abiertoAhora:
      typeof data.hours?.open_now === "boolean" ? data.hours.open_now : null,
    telefono: typeof data.tel === "string" ? data.tel.slice(0, 80) : null,
    web: safeUrl(data.website),
    calificacion:
      typeof data.rating === "number" &&
      Number.isFinite(data.rating) &&
      data.rating >= 0 &&
      data.rating <= 10
        ? data.rating
        : null,
    escala: 10,
    totalValoraciones: Number.isSafeInteger(data.stats?.total_ratings)
      ? data.stats.total_ratings
      : null,
    opiniones: (Array.isArray(data.tips) ? data.tips : [])
      .slice(0, 5)
      .filter((t) => typeof t.text === "string" && t.text.trim())
      .map((t) => ({
        texto: t.text.slice(0, 1500),
        autor:
          typeof t.user?.first_name === "string"
            ? t.user.first_name.slice(0, 80)
            : "Comunidad de Foursquare",
        url: safeUrl(t.url, ["foursquare.com"]),
      })),
  };
}
function createPlaceDetailsService({
  db,
  env = process.env,
  request = fetch,
  now = Date.now,
} = {}) {
  const cache = new Map();
  async function reserve() {
    const limit = Number(env.FOURSQUARE_DAILY_REQUEST_LIMIT || 200);
    if (!Number.isSafeInteger(limit) || limit < 2) return false;
    const day = new Date(now()).toISOString().slice(0, 10),
      clave = `places:foursquare:${day}`;
    await db.usageCounter.upsert({
      where: { clave },
      create: { clave, cantidad: 0, expiresAt: new Date(now() + 2 * 86400000) },
      update: {},
    });
    return (
      (
        await db.usageCounter.updateMany({
          where: { clave, cantidad: { lte: limit - 2 } },
          data: { cantidad: { increment: 2 } },
        })
      ).count === 1
    );
  }
  async function get(path, params) {
    const url = new URL(`https://places-api.foursquare.com${path}`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    const response = await request(url.href, {
      headers: {
        Authorization: `Bearer ${env.FOURSQUARE_SERVICE_KEY}`,
        "X-Places-Api-Version": "2025-06-17",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new HttpError(
        502,
        "No se pudieron actualizar los datos del lugar.",
      );
    return response.json();
  }
  return {
    async details(place) {
      const fallback = curatedDetails(place),
        key = `${normalizePlaceName(place.nombre)}:${place.latitud.toFixed(5)}:${place.longitud.toFixed(5)}`;
      if (!env.FOURSQUARE_SERVICE_KEY || env.FOURSQUARE_ENABLED !== "true")
        return {
          ...fallback,
          opiniones: [],
          calificacion: null,
          horario: null,
          aviso:
            "Las valoraciones y los horarios sólo se muestran cuando la fuente los proporciona.",
        };
      const stored = cache.get(key);
      if (stored && stored.expires > now()) return stored.data;
      try {
        if (!(await reserve()))
          return {
            ...fallback,
            aviso:
              "No se pudieron ampliar los datos del lugar en este momento.",
          };
        const search = await get("/places/search", {
          query: place.nombre,
          ll: `${place.latitud},${place.longitud}`,
          radius: "200",
          limit: "5",
          fields: "fsq_place_id,name,latitude,longitude",
        });
        const tokens = significantTokens(place.nombre);
        const candidates = (search.results || [])
          .filter(
            (p) =>
              typeof p.name === "string" &&
              typeof p.fsq_place_id === "string" &&
              Number.isFinite(p.latitude) &&
              Number.isFinite(p.longitude) &&
              distance(place, { latitud: p.latitude, longitud: p.longitude }) <=
                150 &&
              tokens.filter((t) => significantTokens(p.name).includes(t))
                .length /
                Math.max(tokens.length, 1) >=
                0.75,
          )
          .sort(
            (a, b) =>
              distance(place, { latitud: a.latitude, longitud: a.longitude }) -
              distance(place, { latitud: b.latitude, longitud: b.longitude }),
          );
        if (!candidates.length)
          return {
            ...fallback,
            aviso: "No hay una ficha adicional que coincida con este lugar.",
          };
        const raw = await get(
          `/places/${encodeURIComponent(candidates[0].fsq_place_id)}`,
          {
            fields:
              "fsq_place_id,name,latitude,longitude,photos,hours,rating,stats,tips,tel,website",
          },
        );
        if (
          !Number.isFinite(raw.latitude) ||
          !Number.isFinite(raw.longitude) ||
          distance(place, { latitud: raw.latitude, longitud: raw.longitude }) >
            150
        )
          throw new Error("Ficha de otra ubicación.");
        const data = normalizeDetails(raw);
        if (!data.fotos.length && fallback.fotos.length)
          data.fotos = fallback.fotos;
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(key, { data, expires: now() + 15 * 60000 });
        return data;
      } catch {
        return {
          ...fallback,
          aviso:
            "No se pudieron actualizar los datos adicionales. Puedes consultar la ubicación y elegir tu destino.",
        };
      }
    },
  };
}
module.exports = {
  safeUrl,
  curatedDetails,
  normalizeDetails,
  createPlaceDetailsService,
};
