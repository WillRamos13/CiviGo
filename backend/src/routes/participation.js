"use strict";
const router = require("express").Router(),
  prisma = require("../lib/db");
const { randomUUID } = require("node:crypto");
const { auth } = require("../lib/auth");
const { asyncRoute, HttpError, text, id } = require("../lib/http");
const { transaction } = require("../lib/workflows");
const { currentMonth, monthRange } = require("../lib/ranking");
const { badges } = require("../lib/achievements");
router.get(
  "/participation",
  auth,
  asyncRoute(async (req, res) => {
    const range = monthRange(currentMonth());
    const [validados, total, points, events] = await Promise.all([
      prisma.report.count({
        where: { usuarioId: req.user.id, estado: "VALIDADO" },
      }),
      prisma.report.count({ where: { usuarioId: req.user.id } }),
      prisma.pointEvent.aggregate({
        where: { usuarioId: req.user.id, creadoEn: range },
        _sum: { puntos: true },
      }),
      prisma.pointEvent.findMany({
        where: { usuarioId: req.user.id, creadoEn: range },
        orderBy: { creadoEn: "desc" },
        take: 50,
        select: { tipo: true, puntos: true, creadoEn: true },
      }),
    ]);
    res.json({
      reportesValidados: validados,
      totalReportes: total,
      puntosMensuales: points._sum.puntos || 0,
      mes: currentMonth(),
      insignias: badges(validados),
      movimientos: events,
    });
  }),
);
router.post(
  "/admin/users/:id/adjustments",
  auth,
  asyncRoute(async (req, res) => {
    if (req.user.rol !== "ADMIN")
      throw new HttpError(
        403,
        "Solo administradores pueden ajustar puntos o monedas.",
      );
    const uid = id(req.params.id),
      motivo = text(req.body.motivo, "Motivo", 1000, 10),
      puntos = req.body.puntos ?? 0,
      monedas = req.body.monedas ?? 0;
    if (
      [puntos, monedas].some(
        (v) =>
          typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 100000,
      ) ||
      (!puntos && !monedas)
    )
      throw new HttpError(
        400,
        "Indica un ajuste válido de puntos o monedas, distinto de cero.",
      );
    const result = await transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "User" WHERE id = ${uid} FOR UPDATE`;
      const user = await db.user.findUnique({ where: { id: uid } });
      if (!user) throw new HttpError(404, "Usuario no encontrado.");
      const saldo = Number((user.monedas + monedas).toFixed(6));
      if (saldo < 0)
        throw new HttpError(
          409,
          "El ajuste no puede dejar un saldo de monedas negativo.",
        );
      if (puntos)
        await db.pointEvent.create({
          data: {
            usuarioId: uid,
            clave: "ajuste:" + randomUUID(),
            tipo: "AJUSTE_ADMIN",
            puntos,
          },
        });
      await db.user.update({ where: { id: uid }, data: { monedas: saldo } });
      await db.auditLog.create({
        data: {
          usuarioId: req.user.id,
          accion: "AJUSTAR_PARTICIPACION",
          entidad: "User",
          entidadId: String(uid),
          datos: {
            puntos,
            monedas,
            motivo,
            saldoAnterior: user.monedas,
            saldoActual: saldo,
          },
        },
      });
      return { puntos, monedas, saldo };
    });
    res.json(result);
  }),
);
module.exports = router;
