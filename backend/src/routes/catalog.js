const express = require("express");
const prisma = require("../lib/db");
const { optionalAuth } = require("../lib/auth");
const { asyncRoute } = require("../lib/http");
const { config, DISTRICTS } = require("../lib/catalog");
const { services } = require("../lib/providers");
const router = express.Router();
router.get(
  "/",
  optionalAuth,
  asyncRoute(async (req, res) =>
    res.json({
      categorias: await prisma.category.findMany({
        include: {
          tipos: {
            where: req.user?.rol === "ADMIN" ? {} : { activo: true },
            orderBy: { id: "asc" },
          },
        },
        orderBy: { orden: "asc" },
      }),
      config: await config(),
      servicios: services(),
      distritos: DISTRICTS,
    }),
  ),
);
module.exports = router;
