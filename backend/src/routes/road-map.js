const express = require("express");
const crypto = require("node:crypto");
const { asyncRoute } = require("../lib/http");
module.exports = function createRoadMapRouter({
  getRoads,
  coveredSegments,
  incidents,
  config,
  scoreSegments,
}) {
  const router = express.Router();
  let cachedRoads,
    geometry,
    version,
    risk,
    expires = 0,
    pending;
  function base() {
    const roads = getRoads();
    if (roads !== cachedRoads) {
      cachedRoads = roads;
      geometry = {
        type: "FeatureCollection",
        features: coveredSegments(roads).map((s) => ({
          type: "Feature",
          id: s.id,
          properties: {
            id: s.id,
            nombre: s.nombre,
            puntos: 0,
            nivelRiesgo: 0,
            pendiente: false,
          },
          geometry: { type: "LineString", coordinates: s.coordinates },
        })),
      };
      version = crypto
        .createHash("sha256")
        .update(JSON.stringify(geometry))
        .digest("hex")
        .slice(0, 24);
      geometry.version = version;
      expires = 0;
    }
    return roads;
  }
  router.get(
    "/geometry",
    asyncRoute(async (req, res) => {
      base();
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("ETag", '"' + version + '"');
      if (req.headers["if-none-match"] === '"' + version + '"')
        return res.status(304).end();
      res.json(geometry);
    }),
  );
  router.get(
    "/risk",
    asyncRoute(async (req, res) => {
      const roads = base();
      if (!risk || Date.now() >= expires) {
        if (!pending)
          pending = (async () => {
            const [items, rules] = await Promise.all([incidents(), config()]);
            const values = scoreSegments(
              coveredSegments(roads),
              items,
              new Date(),
              null,
              rules,
            )
              .filter((s) => s.points !== 0 || s.pending)
              .map((s) => [s.id, s.points, s.level, s.pending]);
            risk = {
              version,
              revision: crypto
                .createHash("sha256")
                .update(JSON.stringify(values))
                .digest("hex")
                .slice(0, 24),
              values,
              actualizadoEn: new Date().toISOString(),
            };
            expires = Date.now() + 15000;
          })().finally(() => {
            pending = null;
          });
        await pending;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json(risk);
    }),
  );
  return router;
};
