const express = require("express");
const prisma = require("../lib/db");
const { hashToken } = require("../lib/auth");
const { asyncRoute, HttpError, id, text } = require("../lib/http");
const { transaction } = require("../lib/workflows");
const { services } = require("../lib/providers");
const router = express.Router();

// Mounted behind the existing session and ADMIN-only guard in admin.js.
router.use((req, res, next) => {
  if (services().telefono.proveedor !== "whatsapp-manual")
    return next(
      new HttpError(
        409,
        "La verificación manual por WhatsApp no está habilitada.",
        "PHONE_PROVIDER_CHANGED",
      ),
    );
  next();
});
router.get(
  "/",
  asyncRoute(async (req, res) => {
    const pending = await prisma.verification.findMany({
      where: {
        tipo: "TELEFONO_WHATSAPP",
        usado: false,
        intentos: { lt: 5 },
        expiresAt: { gt: new Date() },
        usuario: { telefonoVerificado: false, bloqueado: false },
      },
      orderBy: { creadoEn: "asc" },
      take: 200,
      select: {
        id: true,
        destino: true,
        creadoEn: true,
        expiresAt: true,
        usuario: { select: { id: true, nombreUsuario: true, telefono: true } },
      },
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(
      pending
        .filter((v) => v.destino === v.usuario.telefono)
        .map((v) => ({
          id: v.id,
          creadoEn: v.creadoEn,
          expiresAt: v.expiresAt,
          usuario: {
            id: v.usuario.id,
            nickname: v.usuario.nombreUsuario,
            telefono: v.usuario.telefono,
          },
        })),
    );
  }),
);
router.post(
  "/:id/approve",
  asyncRoute(async (req, res) => {
    const verificationId = id(req.params.id);
    const codigo = text(req.body.codigo, "Código recibido", 64)
      .replace(/[\s-]/g, "")
      .toUpperCase();
    if (!/^[A-F0-9]{24}$/.test(codigo))
      throw new HttpError(
        400,
        "Copia el código completo recibido por WhatsApp.",
        "PHONE_MANUAL_CODE_INVALID",
      );
    const value = text(
      req.body.telefonoRemitente,
      "Teléfono del remitente",
      30,
    ).replace(/[\s()-]/g, "");
    const telefono = /^9\d{8}$/.test(value) ? "+51" + value : value;
    if (!/^\+[1-9]\d{7,14}$/.test(telefono))
      throw new HttpError(
        400,
        "El remitente debe tener un número en formato internacional.",
        "PHONE_MANUAL_SENDER_INVALID",
      );
    const verification = await prisma.verification.findFirst({
      where: {
        id: verificationId,
        tipo: "TELEFONO_WHATSAPP",
        usado: false,
        expiresAt: { gt: new Date() },
        intentos: { lt: 5 },
      },
    });
    if (!verification)
      throw new HttpError(
        409,
        "La solicitud venció, fue utilizada o agotó sus intentos.",
        "VERIFICATION_EXPIRED",
      );
    const attempt = await prisma.verification.updateMany({
      where: {
        id: verification.id,
        usado: false,
        expiresAt: { gt: new Date() },
        intentos: { lt: 5 },
      },
      data: { intentos: { increment: 1 } },
    });
    if (!attempt.count)
      throw new HttpError(
        409,
        "La solicitud ya no está disponible.",
        "VERIFICATION_EXPIRED",
      );
    if (
      telefono !== verification.destino ||
      hashToken(codigo) !== verification.codigoHash
    )
      throw new HttpError(
        400,
        "El número del remitente o el código no coincide con esta solicitud.",
        "PHONE_MANUAL_MISMATCH",
      );
    await transaction(async (db) => {
      const administrator = await db.user.findUnique({
        where: { id: req.user.id },
        select: { rol: true, bloqueado: true },
      });
      if (
        !administrator ||
        administrator.rol !== "ADMIN" ||
        administrator.bloqueado
      )
        throw new HttpError(
          403,
          "Ya no tienes permiso para aprobar teléfonos.",
        );
      const consumed = await db.verification.updateMany({
        where: {
          id: verification.id,
          usuarioId: verification.usuarioId,
          tipo: "TELEFONO_WHATSAPP",
          destino: telefono,
          codigoHash: verification.codigoHash,
          usado: false,
          expiresAt: { gt: new Date() },
        },
        data: { usado: true },
      });
      if (!consumed.count)
        throw new HttpError(
          409,
          "La solicitud ya fue utilizada o venció.",
          "VERIFICATION_EXPIRED",
        );
      const approved = await db.user.updateMany({
        where: {
          id: verification.usuarioId,
          telefono,
          bloqueado: false,
          telefonoVerificado: false,
        },
        data: { telefonoVerificado: true },
      });
      if (!approved.count)
        throw new HttpError(
          409,
          "La cuenta cambió, fue bloqueada o ya tiene el teléfono verificado.",
          "PHONE_MANUAL_ACCOUNT_CHANGED",
        );
      await db.auditLog.create({
        data: {
          usuarioId: req.user.id,
          accion: "VERIFICAR_TELEFONO_WHATSAPP",
          entidad: "usuario",
          entidadId: String(verification.usuarioId),
          datos: { verificacionId: verification.id, metodo: "whatsapp-manual" },
        },
      });
    });
    res.json({
      mensaje: "Teléfono verificado tras la revisión del mensaje de WhatsApp.",
    });
  }),
);
module.exports = router;
