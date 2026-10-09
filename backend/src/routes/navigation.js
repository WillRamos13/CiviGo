"use strict";
const express = require("express");
const prisma = require("../lib/db");
const { auth } = require("../lib/auth");
const { asyncRoute, HttpError, coordinates, id, text } = require("../lib/http");
const { getRoads, coveredSegments } = require("../lib/roads");
const { createPlaceService } = require("../lib/places");
const { scoreSegments } = require("../lib/risk");
const { MODES } = require("../lib/navigation");
const { config } = require("../lib/catalog");
const { transaction } = require("../lib/workflows");
const { publicIncidentEligibility } = require("../lib/publication");
const { createTrafficService } = require("../lib/navigation-traffic");
const router = express.Router();
const traffic = createTrafficService({ db: prisma });
const places = createPlaceService({ db: prisma });
router.use("/roads", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
async function incidents() {
  return prisma.incident
    .findMany({
      where: {
        publicado: true,
        estado: { notIn: ["FALSO", "RETIRADO"] },
        AND: [publicIncidentEligibility()],
      },
      include: {
        tipoCatalogo: true,
        reportes: {
          where: { usuario: { correoVerificado: true } },
          select: {
            adjuntos: {
              where: { tipo: "EVIDENCIA", privado: true },
              select: { id: true },
            },
          },
        },
      },
    })
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        pruebasRecibidas: row.reportes.some((r) => r.adjuntos.length > 0),
      })),
    );
}
router.get(
  "/roads",
  asyncRoute(async (req, res) => {
    const roads = getRoads();
    const scored = scoreSegments(
      coveredSegments(roads),
      await incidents(),
      new Date(),
      null,
      await config(),
    );
    res.json({
      type: "FeatureCollection",
      actualizadoEn: new Date().toISOString(),
      datosActualizadosEn: roads.actualizadoEn,
      atribucion: roads.atribucion,
      features: scored.map((s) => ({
        type: "Feature",
        id: s.id,
        properties: {
          id: s.id,
          nombre: s.nombre,
          puntos: s.points,
          nivelRiesgo: s.level,
          pendiente: s.pending,
        },
        geometry: { type: "LineString", coordinates: s.coordinates },
      })),
    });
  }),
);
router.get(
  "/places",
  asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await places.search(text(req.query.q, "Búsqueda", 160, 3)));
  }),
);
router.post(
  "/plan",
  auth,
  asyncRoute(async (req, res) => {
    const origen = coordinates(
        req.body.origen?.latitud,
        req.body.origen?.longitud,
      ),
      destino = coordinates(
        req.body.destino?.latitud,
        req.body.destino?.longitud,
      );
    res.json(
      await traffic.plan({ ...req.body, origen, destino }, await incidents(), {
        rules: await config(),
      }),
    );
  }),
);
router.get(
  "/traffic/status",
  asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await traffic.status());
  }),
);
router.get(
  "/traffic/incidents",
  asyncRoute(async (req, res) => {
    let bounds = null;
    if (req.query.bbox !== undefined) {
      bounds = String(req.query.bbox).split(",").map(Number);
      if (
        bounds.length !== 4 ||
        !bounds.every(Number.isFinite) ||
        bounds[0] >= bounds[2] ||
        bounds[1] >= bounds[3] ||
        Math.abs(bounds[0]) > 180 ||
        Math.abs(bounds[2]) > 180 ||
        Math.abs(bounds[1]) > 90 ||
        Math.abs(bounds[3]) > 90
      )
        throw new HttpError(400, "El área de consulta no es válida.");
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(await traffic.incidents(await incidents(), bounds));
  }),
);
router.get(
  "/traffic/tiles/flow/:z/:x/:y.png",
  asyncRoute(async (req, res) => {
    try {
      const tile = await traffic.tile(
        Number(req.params.z),
        Number(req.params.x),
        Number(req.params.y),
      );
      res.setHeader("Cache-Control", "public, max-age=120");
      res.setHeader("X-Traffic-Updated-At", tile.actualizadoEn);
      res.type("png").send(tile.data);
    } catch (error) {
      if (error.name === "TrafficUnavailable")
        throw new HttpError(503, error.message, error.code);
      throw error;
    }
  }),
);
function savedInput(body) {
  const modo = body.modo;
  if (!MODES.has(modo)) throw new HttpError(400, "Transporte inválido.");
  const origen = coordinates(body.origen?.latitud, body.origen?.longitud),
    destino = coordinates(body.destino?.latitud, body.destino?.longitud);
  const ruta = body.ruta;
  if (
    !ruta ||
    ruta.geometria?.type !== "LineString" ||
    !Array.isArray(ruta.geometria.coordinates) ||
    ruta.geometria.coordinates.length < 2 ||
    ruta.geometria.coordinates.length > 20000 ||
    ruta.geometria.coordinates.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90,
    ) ||
    !Number.isFinite(ruta.distancia) ||
    ruta.distancia < 0 ||
    !Number.isFinite(ruta.duracion) ||
    ruta.duracion < 0
  )
    throw new HttpError(400, "Ruta guardada inválida.");
  return {
    modo,
    origen,
    destino,
    datos: { ...ruta, guardadoEn: new Date().toISOString() },
  };
}
router.get(
  "/favorites",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await prisma.routeFavorite.findMany({
        where: { usuarioId: req.user.id },
        orderBy: { creadoEn: "desc" },
      }),
    ),
  ),
);
router.post(
  "/favorites",
  auth,
  asyncRoute(async (req, res) => {
    const input = savedInput(req.body),
      nombre = text(req.body.nombre, "Nombre", 100);
    const tags =
      req.user.premium && Array.isArray(req.body.tags)
        ? req.body.tags.map((t) => text(t, "Etiqueta", 30)).slice(0, 10)
        : [];
    const result = await transaction(async (db) => {
      // Lock the owning user so concurrent requests cannot exceed the plan's limit.
      await db.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user.id} FOR UPDATE`;
      const count = await db.routeFavorite.count({
          where: { usuarioId: req.user.id },
        }),
        limit = req.user.premium ? 20 : 3;
      if (count >= limit)
        throw new HttpError(409, `Tu plan permite ${limit} rutas favoritas.`);
      return db.routeFavorite.create({
        data: { ...input, nombre, tags, usuarioId: req.user.id },
      });
    });
    res.status(201).json(result);
  }),
);
router.delete(
  "/favorites/:id",
  auth,
  asyncRoute(async (req, res) => {
    const result = await prisma.routeFavorite.deleteMany({
      where: { id: id(req.params.id), usuarioId: req.user.id },
    });
    if (!result.count) throw new HttpError(404, "Ruta no encontrada.");
    res.json({ ok: true });
  }),
);
router.get(
  "/history",
  auth,
  asyncRoute(async (req, res) => {
    const where = { usuarioId: req.user.id };
    if (req.user.premium && MODES.has(req.query.modo))
      where.modo = req.query.modo;
    if (req.user.premium && (req.query.desde || req.query.hasta)) {
      where.creadoEn = {};
      for (const [key, value] of [
        ["gte", req.query.desde],
        ["lte", req.query.hasta],
      ])
        if (value) {
          const date = new Date(String(value));
          if (!Number.isFinite(date.getTime()))
            throw new HttpError(400, "Fecha de filtro inválida.");
          where.creadoEn[key] = date;
        }
    }
    res.json(
      await prisma.routeHistory.findMany({
        where,
        orderBy: { creadoEn: "desc" },
        take: req.user.premium ? 100 : 10,
      }),
    );
  }),
);
router.post(
  "/history",
  auth,
  asyncRoute(async (req, res) =>
    res.status(201).json(
      await prisma.routeHistory.create({
        data: { ...savedInput(req.body), usuarioId: req.user.id },
      }),
    ),
  ),
);
router.get(
  "/stats",
  auth,
  asyncRoute(async (req, res) => {
    if (!req.user.premium)
      throw new HttpError(
        403,
        "Las estadísticas de recorridos son una función Premium.",
      );
    const rows = await prisma.routeHistory.findMany({
      where: { usuarioId: req.user.id },
      select: { datos: true, modo: true },
    });
    const porModo = { walking: 0, cycling: 0, driving: 0 };
    let metros = 0,
      segundos = 0;
    for (const row of rows) {
      porModo[row.modo] = (porModo[row.modo] || 0) + 1;
      metros += Number(row.datos.distancia) || 0;
      segundos += Number(row.datos.duracion) || 0;
    }
    res.json({ recorridos: rows.length, metros, segundos, porModo });
  }),
);
module.exports = router;
