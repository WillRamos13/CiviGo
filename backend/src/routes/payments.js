"use strict";
const express = require("express"),
  prisma = require("../lib/db");
const { auth, requireEmail } = require("../lib/auth");
const { asyncRoute, HttpError } = require("../lib/http");
const { transaction } = require("../lib/workflows");
const {
  createPaymentService,
  verifyPaymentWebhook,
} = require("../lib/payments");
const service = createPaymentService({ db: prisma, transaction });
const router = express.Router();
router.get(
  "/catalog",
  asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(service.catalog());
  }),
);
router.get(
  "/manage",
  auth,
  asyncRoute(async (req, res) => {
    if (req.user.rol !== "ADMIN")
      throw new HttpError(403, "Se requiere acceso de administrador.");
    const rows = await prisma.appConfig.findMany({
      where: { clave: { startsWith: "payments:order:" } },
      orderBy: { actualizadoEn: "desc" },
      take: 200,
    });
    res.json(
      rows.map(({ valor }) => ({
        referencia: valor.referencia,
        usuarioId: valor.usuarioId,
        centimos: valor.centimos,
        moneda: valor.moneda,
        estado: valor.estado,
        creadoEn: valor.creadoEn,
        modo: valor.modo,
      })),
    );
  }),
);
router.post(
  "/checkout",
  auth,
  requireEmail,
  asyncRoute(async (req, res) =>
    res.json(
      await service.checkout(req.user, req.headers["x-idempotency-key"]),
    ),
  ),
);
router.get(
  "/orders/:reference",
  auth,
  asyncRoute(async (req, res) =>
    res.json(await service.ownedOrder(req.params.reference, req.user.id)),
  ),
);
router.post(
  "/orders/:reference/sync",
  auth,
  requireEmail,
  asyncRoute(async (req, res) => {
    await service.ownedOrder(req.params.reference, req.user.id);
    const result = await service.reconcile(
      String(req.body.paymentId || ""),
      req.user.id,
      req.params.reference,
    );
    if (result.referencia !== req.params.reference)
      throw new HttpError(400, "El pago pertenece a otra compra.");
    res.json(result);
  }),
);
router.post(
  "/webhook",
  asyncRoute(async (req, res) => {
    if (req.body?.type !== "payment" && req.query.type !== "payment")
      return res.sendStatus(204);
    const queryId = req.query["data.id"],
      bodyId = req.body.data?.id;
    if (
      queryId !== undefined &&
      bodyId !== undefined &&
      String(queryId) !== String(bodyId)
    )
      throw new HttpError(400, "Identificador inconsistente.");
    const paymentId = String(queryId ?? bodyId ?? "");
    if (
      !verifyPaymentWebhook(
        req.headers,
        paymentId,
        process.env.MERCADOPAGO_WEBHOOK_SECRET,
      )
    )
      throw new HttpError(401, "Firma de notificación inválida.");
    await service.reconcile(paymentId);
    res.json({ recibido: true });
  }),
);
module.exports = router;
