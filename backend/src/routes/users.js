const express = require("express");
const crypto = require("node:crypto");
const prisma = require("../lib/db");
const { asyncRoute, HttpError, text } = require("../lib/http");
const { auth, createSession, COOKIE, hashToken } = require("../lib/auth");
const { ownUser } = require("../lib/projections");
const { hashPassword, verifyPassword } = require("../lib/password");
const providers = require("../lib/providers");
const { firebaseEmailConfig } = require("../lib/firebase-email");
const { transaction } = require("../lib/workflows");
const {
  phone,
  email,
  birthDate,
  nicknameValue,
} = require("../lib/account-input");
const router = express.Router();
router.post(
  "/register",
  asyncRoute(async (req, res) => {
    const b = req.body;
    const nickname = nicknameValue(b.nickname || b.nombreUsuario);
    const password = text(b.password, "Contraseña", 128, 10);
    const correo = email(b.correo);
    if (!correo.endsWith("@gmail.com"))
      throw new HttpError(
        400,
        "Regístrate con tu dirección de Gmail para verificarla con Google.",
        "EMAIL_GMAIL_REQUIRED",
      );
    const usuario = await prisma.user.create({
      data: {
        nombreUsuario: nickname,
        nombres: text(b.nombres || b.nombre, "Nombres", 100),
        apellidos: text(b.apellidos, "Apellidos", 100),
        fechaNacimiento: birthDate(b.fechaNacimiento),
        correo,
        telefono: phone(b.telefono),
        password: await hashPassword(password),
        reputacion: null,
        rol: "USUARIO",
      },
    });
    await createSession(usuario, res);
    res.status(201).json({ usuario: ownUser(usuario) });
  }),
);
router.post(
  "/login",
  asyncRoute(async (req, res) => {
    const correo = email(req.body.correo);
    const password = text(req.body.password, "Contraseña", 128);
    const usuario = await prisma.user.findUnique({ where: { correo } });
    if (!usuario || !(await verifyPassword(password, usuario.password)))
      throw new HttpError(401, "Correo o contraseña incorrectos.");
    await createSession(usuario, res);
    if (usuario.bloqueado)
      return res.status(403).json({
        error:
          "Tu cuenta está bloqueada. Puedes solicitar revisión desde Mis reportes.",
        code: "ACCOUNT_BLOCKED",
        usuario: ownUser(usuario),
      });
    res.json({ usuario: ownUser(usuario) });
  }),
);
router.get(
  "/me",
  auth,
  asyncRoute(async (req, res) => res.json({ usuario: ownUser(req.user) })),
);
router.post(
  "/logout",
  auth,
  asyncRoute(async (req, res) => {
    await prisma.session.deleteMany({ where: { id: req.sessionId } });
    res.clearCookie(COOKIE, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.COOKIE_SAME_SITE === "none" ? "none" : "lax",
    });
    res.json({ mensaje: "Sesión cerrada." });
  }),
);
router.patch(
  "/me",
  auth,
  asyncRoute(async (req, res) => {
    const data = {};
    if (req.body.ocultarAnuncios !== undefined) {
      if (typeof req.body.ocultarAnuncios !== "boolean")
        throw new HttpError(400, "Preferencia inválida.");
      if (req.body.ocultarAnuncios && !req.user.premium)
        throw new HttpError(403, "Ocultar anuncios requiere Premium.");
      data.ocultarAnuncios = req.body.ocultarAnuncios;
    }
    if (req.body.nickname || req.body.nombreUsuario) {
      if (!req.user.correoVerificado)
        throw new HttpError(
          403,
          "Verifica tu correo antes de cambiar el nickname.",
        );
      data.nombreUsuario = nicknameValue(
        req.body.nickname || req.body.nombreUsuario,
      );
    }
    res.json({
      usuario: ownUser(
        await prisma.user.update({ where: { id: req.user.id }, data }),
      ),
    });
  }),
);
async function createVerification(user, tipo, destino) {
  const codigo = crypto.randomBytes(32).toString("hex");
  const verification = await transaction(async (db) => {
    const recent = await db.verification.findFirst({
      where: {
        usuarioId: user.id,
        tipo,
        creadoEn: { gte: new Date(Date.now() - 60000) },
      },
    });
    if (recent)
      throw new HttpError(
        429,
        "Espera un minuto antes de solicitar otra verificación con Google.",
      );
    const hourly = await db.verification.count({
      where: {
        usuarioId: user.id,
        tipo,
        creadoEn: { gte: new Date(Date.now() - 3600000) },
      },
    });
    if (hourly >= 5)
      throw new HttpError(
        429,
        "Se alcanzó el límite de cinco solicitudes de verificación por hora. Inténtalo después.",
        "VERIFICATION_RATE_LIMITED",
      );
    await db.verification.updateMany({
      where: { usuarioId: user.id, tipo, usado: false },
      data: { usado: true },
    });
    return db.verification.create({
      data: {
        usuarioId: user.id,
        tipo,
        destino,
        codigoHash: hashToken(codigo),
        expiresAt: new Date(Date.now() + 10 * 60000),
      },
    });
  });
  return { verification };
}
async function pendingVerification(user, tipo, destino, verificationId) {
  const v = await prisma.verification.findFirst({
    where: {
      usuarioId: user.id,
      tipo,
      usado: false,
      ...(verificationId === undefined ? {} : { id: verificationId }),
    },
    orderBy: { creadoEn: "desc" },
  });
  if (!v || v.expiresAt < new Date() || v.intentos >= 5)
    throw new HttpError(
      400,
      "La solicitud de verificación venció o agotó sus intentos.",
      "VERIFICATION_EXPIRED",
    );
  if (v.destino !== destino)
    throw new HttpError(
      409,
      "El correo cambió. Prepara otra verificación con Google.",
    );
  const result = await prisma.verification.updateMany({
    where: {
      id: v.id,
      usado: false,
      expiresAt: { gte: new Date() },
      intentos: { lt: 5 },
    },
    data: { intentos: { increment: 1 } },
  });
  if (!result.count)
    throw new HttpError(
      400,
      "La solicitud de verificación venció o agotó sus intentos.",
      "VERIFICATION_EXPIRED",
    );
  return v;
}
async function finishVerification(
  user,
  verification,
  field,
  verifiedField,
  proofHash,
) {
  await transaction(async (db) => {
    if (
      proofHash &&
      (await db.verification.findFirst({
        where: {
          tipo: "CORREO_GOOGLE",
          usado: true,
          codigoHash: proofHash,
        },
      }))
    )
      throw new HttpError(
        409,
        "Esta verificación ya fue utilizada. Verifica de nuevo con Google.",
        "EMAIL_GOOGLE_REPLAY",
      );
    const consumed = await db.verification.updateMany({
      where: {
        id: verification.id,
        usuarioId: user.id,
        tipo: verification.tipo,
        destino: verification.destino,
        usado: false,
        expiresAt: { gte: new Date() },
      },
      data: { usado: true, ...(proofHash ? { codigoHash: proofHash } : {}) },
    });
    if (!consumed.count)
      throw new HttpError(
        409,
        "Esta solicitud venció o ya fue utilizada. Prepara otra verificación con Google.",
        "VERIFICATION_EXPIRED",
      );
    const changed = await db.user.updateMany({
      where: { id: user.id, [field]: verification.destino, bloqueado: false },
      data: { [verifiedField]: true },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "La cuenta cambió durante la verificación. Prepara otra verificación con Google.",
      );
  });
}
function requireGmailVerification(user) {
  if (!String(user.correo).trim().toLowerCase().endsWith("@gmail.com"))
    throw new HttpError(
      400,
      "Esta cuenta debe usar Gmail para verificar el correo. Solicita al administrador revisar tu dirección; no se cambiará automáticamente.",
      "EMAIL_GMAIL_REQUIRED",
    );
}
router.post(
  "/email/google/request",
  auth,
  asyncRoute(async (req, res) => {
    if (req.user.correoVerificado)
      return res.json({
        usuario: ownUser(req.user),
        mensaje: "Tu correo ya está verificado.",
      });
    requireGmailVerification(req.user);
    const config = firebaseEmailConfig();
    if (!config.configured)
      throw new HttpError(
        503,
        "La verificación de correo con Google no está configurada.",
        "EMAIL_GOOGLE_CONFIG",
      );
    const { verification } = await createVerification(
      req.user,
      "CORREO_GOOGLE",
      req.user.correo,
    );
    res.json({
      challengeId: String(verification.id),
      projectId: config.projectId,
      expiresAt: verification.expiresAt.toISOString(),
    });
  }),
);
router.get(
  "/email/google/config",
  auth,
  asyncRoute(async (req, res) => {
    const config = firebaseEmailConfig();
    res.json({ configurado: config.configured, projectId: config.projectId });
  }),
);
router.post(
  "/email/google/verify",
  auth,
  asyncRoute(async (req, res) => {
    if (req.user.correoVerificado)
      return res.json({ usuario: ownUser(req.user) });
    requireGmailVerification(req.user);
    const challenge = req.body.challengeId;
    if (
      typeof challenge !== "string" ||
      !/^[1-9]\d{0,9}$/.test(challenge) ||
      Number(challenge) > 2147483647
    )
      throw new HttpError(
        400,
        "Solicitud de verificación inválida.",
        "EMAIL_CHALLENGE_INVALID",
      );
    const idToken = text(req.body.idToken, "Comprobación del correo", 8192, 20);
    const verification = await pendingVerification(
      req.user,
      "CORREO_GOOGLE",
      req.user.correo,
      Number(challenge),
    );
    const { proofHash } = await providers.verifyFirebaseEmail(
      idToken,
      verification.destino,
      verification.creadoEn,
    );
    await finishVerification(
      req.user,
      verification,
      "correo",
      "correoVerificado",
      proofHash,
    );
    const usuario = await prisma.user.findUnique({
      where: { id: req.user.id },
    });
    res.json({ usuario: ownUser(usuario) });
  }),
);
router.post(
  "/recovery",
  auth,
  asyncRoute(async (req, res) => {
    const telefonoNuevo = phone(req.body.telefonoNuevo);
    const motivo = text(req.body.motivo, "Motivo", 2000, 10);
    let adjuntoId = null;
    if (req.body.adjuntoId) {
      const a = await prisma.attachment.findFirst({
        where: {
          id: String(req.body.adjuntoId),
          usuarioId: req.user.id,
          tipo: "IDENTIDAD",
          privado: true,
        },
      });
      if (!a)
        throw new HttpError(
          400,
          "Adjunta un documento privado de identidad propio.",
        );
      adjuntoId = a.id;
    }
    if (!req.user.correoVerificado && !adjuntoId)
      throw new HttpError(
        400,
        "Se necesita correo verificado o documentación privada.",
      );
    const recovery = await prisma.recovery.create({
      data: { usuarioId: req.user.id, telefonoNuevo, motivo, adjuntoId },
    });
    res.status(201).json(recovery);
  }),
);
module.exports = router;
module.exports.phone = phone;
module.exports.birthDate = birthDate;
