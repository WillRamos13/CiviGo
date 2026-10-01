"use strict";
const router = require("express").Router(),
  prisma = require("../lib/db");
router.get("/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, baseDeDatos: true });
  } catch {
    res
      .status(503)
      .json({
        ok: false,
        baseDeDatos: false,
        error: "La base de datos no está disponible.",
      });
  }
});
module.exports = router;
