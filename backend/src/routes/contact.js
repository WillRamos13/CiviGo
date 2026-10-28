"use strict";
const express = require("express"),
  { randomUUID } = require("node:crypto"),
  db = require("../lib/db");
const { auth, requireEmail } = require("../lib/auth"),
  { asyncRoute, text, HttpError } = require("../lib/http");
const router = express.Router();
router.post(
  "/contact",
  auth,
  requireEmail,
  asyncRoute(async (req, res) => {
    const asunto = text(req.body.asunto, "Asunto", 100, 3),
      mensaje = text(req.body.mensaje, "Mensaje", 3000, 10);
    const recent = await db.appConfig.count({
      where: {
        clave: { startsWith: `contact:${req.user.id}:` },
        actualizadoEn: { gte: new Date(Date.now() - 3600000) },
      },
    });
    if (recent >= 5)
      throw new HttpError(
        429,
        "Ya enviaste varias consultas. Inténtalo más tarde.",
      );
    const id = randomUUID();
    await db.appConfig.create({
      data: {
        clave: `contact:${req.user.id}:${id}`,
        valor: {
          id,
          usuarioId: req.user.id,
          nickname: req.user.nombreUsuario,
          correo: req.user.correo,
          asunto,
          mensaje,
          estado: "PENDIENTE",
          creadoEn: new Date().toISOString(),
        },
      },
    });
    res
      .status(201)
      .json({
        id,
        mensaje: "Tu consulta quedó registrada para el equipo de CiviGo.",
      });
  }),
);
router.use("/admin/contact", auth, (req, res, next) =>
  req.user.rol === "ADMIN"
    ? next()
    : next(new HttpError(403, "Se requiere acceso de administrador.")),
);
router.get(
  "/admin/contact",
  asyncRoute(async (req, res) =>
    res.json(
      (
        await db.appConfig.findMany({
          where: { clave: { startsWith: "contact:" } },
          orderBy: { actualizadoEn: "desc" },
          take: 200,
        })
      ).map((row) => ({ ...row.valor, clave: row.clave })),
    ),
  ),
);
router.patch(
  "/admin/contact",
  asyncRoute(async (req, res) => {
    const clave = text(req.body.clave, "Consulta", 200, 10);
    if (!/^contact:\d+:[a-f0-9-]{36}$/.test(clave))
      throw new HttpError(400, "Consulta inválida.");
    const row = await db.appConfig.findUnique({ where: { clave } });
    if (!row) throw new HttpError(404, "Consulta no encontrada.");
    await db.appConfig.update({
      where: { clave },
      data: {
        valor: {
          ...row.valor,
          estado: "ATENDIDO",
          atendidoPor: req.user.id,
          atendidoEn: new Date().toISOString(),
        },
      },
    });
    res.json({ atendido: true });
  }),
);
module.exports = router;
