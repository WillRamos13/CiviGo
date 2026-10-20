"use strict";
const router = require("express").Router(),
  prisma = require("../lib/db");
const { auth } = require("../lib/auth"),
  { asyncRoute, HttpError } = require("../lib/http");
const { prepareImport } = require("../lib/history-import");
const { commitHistorical } = require("../lib/history-commit");
router.use(auth, (req, res, next) =>
  req.user.rol === "ADMIN"
    ? next()
    : next(
        new HttpError(403, "Solo administradores pueden importar históricos."),
      ),
);
router.post(
  "/import/preview",
  asyncRoute(async (req, res) =>
    res.json(prepareImport(req.body, await prisma.incidentType.findMany())),
  ),
);
router.post(
  "/import/commit",
  asyncRoute(async (req, res) => {
    const prepared = prepareImport(
      req.body,
      await prisma.incidentType.findMany(),
    );
    const result = await commitHistorical(prisma, {
      prepared,
      fuente: req.body.fuente.trim(),
      usuarioId: req.user.id,
    });
    res
      .status(201)
      .json({
        importados: result.importados,
        duplicados: result.duplicados,
        errores: result.errores,
      });
  }),
);
module.exports = router;
