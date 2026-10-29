"use strict";
const router = require("express").Router(),
  prisma = require("../lib/db");
const { optionalAuth } = require("../lib/auth");
const { HttpError, asyncRoute } = require("../lib/http");
router.post(
  "/telemetry",
  optionalAuth,
  asyncRoute(async (req, res) => {
    if (JSON.stringify(req.body || {}).length > 3000)
      throw new HttpError(400, "Métrica demasiado grande.");
    require("../lib/telemetry").telemetry().client(req.body, req.user);
    res.setHeader("Cache-Control", "no-store");
    res.status(204).end();
  }),
);
router.get("/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, baseDeDatos: true });
  } catch {
    res.status(503).json({
      ok: false,
      baseDeDatos: false,
      error: "La base de datos no está disponible.",
    });
  }
});
module.exports = router;
