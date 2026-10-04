const express = require("express");
const crypto = require("node:crypto");
const prisma = require("../lib/db");
const { asyncRoute, HttpError, text } = require("../lib/http");
const {
  auth,
  createSession,
  COOKIE,
  demoEnabled,
  hashToken,
} = require("../lib/auth");
const { ownUser } = require("../lib/projections");
const { hashPassword, verifyPassword } = require("../lib/password");
const providers = require("../lib/providers");
const { validatePhoneChannel } = require("../lib/contact-providers");
const { transaction } = require("../lib/workflows");
const router = express.Router();
function phone(value) {
  const normalized = String(value || "").replace(/[\s()-]/g, "");
  const number = /^9\d{8}$/.test(normalized) ? "+51" + normalized : normalized;
  if (!/^\+[1-9]\d{7,14}$/.test(number))
    throw new HttpError(
      400,
      "Teléfono inválido. Utiliza el formato internacional, por ejemplo +51912345678.",
    );
  return number;
}
function email(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v))
    throw new HttpError(400, "Correo inválido.");
  return v;
}
function birthDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new HttpError(400, "Fecha de nacimiento inválida.");
  const d = new Date(value + "T00:00:00Z");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const limit = new Date(today + "T00:00:00Z");
  limit.setUTCFullYear(limit.getUTCFullYear() - 12);
  if (
    Number.isNaN(+d) ||
    d.toISOString().slice(0, 10) !== value ||
    d > limit ||
    d.getUTCFullYear() < 1900
  )
    throw new HttpError(
      400,
      "La edad mínima es 12 años; comprueba la fecha de nacimiento.",
    );
  return d;
}
router.post(
  "/register",
  asyncRoute(async (req, res) => {
    const b = req.body;
    const nickname = nicknameValue(b.nickname || b.nombreUsuario);
    const password = text(b.password, "Contraseña", 128, 10);
    const usuario = await prisma.user.create({
      data: {
        nombreUsuario: nickname,
        nombres: text(b.nombres || b.nombre, "Nombres", 100),
        apellidos: text(b.apellidos, "Apellidos", 100),
        fechaNacimiento: birthDate(b.fechaNacimiento),
        correo: email(b.correo),
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
  const codigo = crypto.randomInt(100000, 1000000).toString();
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
        "Espera un minuto antes de solicitar otro código.",
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
        "Se alcanzó el límite de cinco códigos por hora. Inténtalo después.",
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
  return { codigo, verification };
}
async function pendingVerification(user, tipo, destino) {
  const v = await prisma.verification.findFirst({
    where: { usuarioId: user.id, tipo, usado: false },
    orderBy: { creadoEn: "desc" },
  });
  if (!v || v.expiresAt < new Date() || v.intentos >= 5)
    throw new HttpError(400, "Código vencido o demasiados intentos.");
  if (v.destino !== destino)
    throw new HttpError(409, "El destino cambió. Solicita un código nuevo.");
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
    throw new HttpError(400, "Código vencido o demasiados intentos.");
  return v;
}
async function checkLocalCode(user, tipo, codigo, destino) {
  const v = await pendingVerification(user, tipo, destino);
  if (v.codigoHash !== hashToken(codigo))
    throw new HttpError(400, "Código incorrecto.");
  return v;
}
async function finishVerification(user, verification, field, verifiedField) {
  await transaction(async (db) => {
    const consumed = await db.verification.updateMany({
      where: {
        id: verification.id,
        usado: false,
        expiresAt: { gte: new Date() },
      },
      data: { usado: true },
    });
    if (!consumed.count)
      throw new HttpError(
        409,
        "Este código venció o ya fue utilizado. Solicita uno nuevo.",
      );
    const changed = await db.user.updateMany({
      where: { id: user.id, [field]: verification.destino },
      data: { [verifiedField]: true },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "El destino cambió durante la verificación. Solicita un código nuevo.",
      );
  });
}
router.post(
  "/phone/request",
  auth,
  asyncRoute(async (req, res) => {
    const canal = validatePhoneChannel(req.body.canal || "sms");
    if (req.user.telefonoVerificado)
      return res.json({ mensaje: "Tu teléfono ya está verificado." });
    if (demoEnabled()) {
      const { codigo } = await createVerification(
        req.user,
        "TELEFONO",
        req.user.telefono,
      );
      return res.json({
        modo: "demo",
        codigoDemo: codigo,
        mensaje: "Código de demostración local; no se envió SMS.",
      });
    }
    if (!providers.services().telefono.configurado)
      throw new HttpError(
        503,
        "Verificación telefónica no configurada. Hace falta un proveedor SMS o WhatsApp.",
        "PHONE_PROVIDER_MISSING",
      );
    // La fila limita solicitudes; el código enviado y su validación siguen
    // siendo responsabilidad de Twilio Verify.
    await createVerification(req.user, "TELEFONO", req.user.telefono);
    await providers.requestPhone(req.user.telefono, canal);
    res.json({ modo: "proveedor", mensaje: "Código solicitado al proveedor." });
  }),
);
router.post(
  "/phone/verify",
  auth,
  asyncRoute(async (req, res) => {
    const codigo = text(req.body.codigo, "Código", 10, 4);
    if (!/^\d{4,10}$/.test(codigo))
      throw new HttpError(400, "Código inválido.");
    if (req.user.telefonoVerificado)
      return res.json({ usuario: ownUser(req.user) });
    let verification;
    if (demoEnabled()) {
      verification = await checkLocalCode(
        req.user,
        "TELEFONO",
        codigo,
        req.user.telefono,
      );
    } else {
      verification = await pendingVerification(
        req.user,
        "TELEFONO",
        req.user.telefono,
      );
      if (!(await providers.checkPhone(req.user.telefono, codigo)))
        throw new HttpError(400, "Código incorrecto.");
    }
    await finishVerification(
      req.user,
      verification,
      "telefono",
      "telefonoVerificado",
    );
    const usuario = await prisma.user.findUnique({
      where: { id: req.user.id },
    });
    res.json({ usuario: ownUser(usuario) });
  }),
);
router.post(
  "/email/request",
  auth,
  asyncRoute(async (req, res) => {
    if (req.user.correoVerificado)
      return res.json({ mensaje: "Tu correo ya está verificado." });
    if (!demoEnabled() && !providers.services().correo.configurado)
      throw new HttpError(
        503,
        "El proveedor de correo no está configurado.",
        "EMAIL_PROVIDER_MISSING",
      );
    const { codigo, verification } = await createVerification(
      req.user,
      "CORREO",
      req.user.correo,
    );
    if (demoEnabled())
      return res.json({
        modo: "demo",
        codigoDemo: codigo,
        mensaje: "Código local de demostración; no se envió correo.",
      });
    if (
      !(await providers.sendEmail(
        req.user.correo,
        "Verifica tu correo en CiviGo",
        "<p>Tu código es <strong>" +
          codigo +
          "</strong>. Vence en diez minutos.</p>",
        {
          idempotencyKey: "email-verification/" + verification.id,
          throwOnError: true,
        },
      ))
    )
      throw new HttpError(
        503,
        "No pudo enviarse el correo. Inténtalo después.",
      );
    res.json({ mensaje: "Revisa tu correo." });
  }),
);
router.post(
  "/email/verify",
  auth,
  asyncRoute(async (req, res) => {
    if (req.user.correoVerificado)
      return res.json({ usuario: ownUser(req.user) });
    const codigo = text(req.body.codigo, "Código", 6, 6);
    if (!/^\d{6}$/.test(codigo)) throw new HttpError(400, "Código inválido.");
    const verification = await checkLocalCode(
      req.user,
      "CORREO",
      codigo,
      req.user.correo,
    );
    await finishVerification(
      req.user,
      verification,
      "correo",
      "correoVerificado",
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

function nicknameValue(value) {
  const nickname = text(value, "Nickname", 30, 3);
  if (!/^[\p{L}\p{N}_ .-]+$/u.test(nickname))
    throw new HttpError(400, "Nickname inválido.");
  return nickname;
}
