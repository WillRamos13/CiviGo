"use strict";
const { randomInt } = require("node:crypto");
const { hashPassword, verifyPassword } = require("./password");
const { HttpError } = require("./http");
const { serializable } = require("./upload-quota");
const TYPE = "CORREO_CODIGO",
  PENDING = "CORREO_CODIGO_ENVIO",
  TTL = 10 * 60000;
function createEmailCodeService({
  db,
  sendEmail,
  now = Date.now,
  generate = () => String(randomInt(100000, 1000000)),
  refreshEffects = (tx, id) =>
    require("./workflows").refreshVerificationEffects(tx, id),
  env = process.env,
}) {
  const fail = (status, message, code) => ({ status, message, code });
  function current(user) {
    if (!user || user.bloqueado)
      throw new HttpError(403, "Tu cuenta no puede verificar el correo.");
    if (!/^[^\s@]+@gmail\.com$/i.test(user.correo))
      throw new HttpError(
        400,
        "Usa el Gmail registrado en tu cuenta.",
        "EMAIL_GMAIL_REQUIRED",
      );
  }
  async function request(userId) {
    const clock = now(),
      code = generate();
    if (!/^\d{6}$/.test(code))
      throw new Error("Código de verificación inválido.");
    const challenge = await serializable(db, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      current(user);
      if (user.correoVerificado) return null;
      const recent = await tx.verification.findMany({
        where: {
          usuarioId: userId,
          tipo: { in: [TYPE, PENDING] },
          creadoEn: { gte: new Date(clock - 3600000) },
        },
        orderBy: { creadoEn: "desc" },
        take: 5,
      });
      if (recent[0] && clock - recent[0].creadoEn.getTime() < 60000)
        throw new HttpError(
          429,
          "Espera un minuto antes de solicitar otro código.",
          "EMAIL_CODE_COOLDOWN",
        );
      if (recent.length >= 5)
        throw new HttpError(
          429,
          "Alcanzaste cinco solicitudes por hora. Inténtalo más tarde.",
          "EMAIL_CODE_RATE_LIMITED",
        );
      const limit = Number(env.EMAIL_CODE_DAILY_LIMIT || 100),
        clave = `email-code:daily:${new Date(clock).toISOString().slice(0, 10)}`;
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new HttpError(
          503,
          "El envío de códigos está pausado.",
          "EMAIL_CODE_UNAVAILABLE",
        );
      await tx.usageCounter.upsert({
        where: { clave },
        create: {
          clave,
          cantidad: 0,
          expiresAt: new Date(clock + 2 * 86400000),
        },
        update: {},
      });
      if (
        !(
          await tx.usageCounter.updateMany({
            where: { clave, cantidad: { lt: limit } },
            data: { cantidad: { increment: 1 } },
          })
        ).count
      )
        throw new HttpError(
          429,
          "Se alcanzó la cuota de códigos del día. Inténtalo más tarde.",
          "EMAIL_CODE_RATE_LIMITED",
        );
      return tx.verification.create({
        data: {
          usuarioId: userId,
          tipo: PENDING,
          destino: user.correo,
          codigoHash: await hashPassword(code),
          expiresAt: new Date(clock + TTL),
          creadoEn: new Date(clock),
        },
      });
    });
    if (!challenge) return { alreadyVerified: true };
    try {
      const sent = await sendEmail(
        challenge.destino,
        "Tu código para verificar CiviGo",
        `<h2>Verifica tu Gmail en CiviGo</h2><p>Introduce este código en la aplicación o en la página donde lo solicitaste:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p><p>Vence en 10 minutos y funciona una sola vez. No compartas este código. Si no lo solicitaste, ignora este mensaje.</p>`,
        {
          idempotencyKey: `email-verification/${challenge.id}`,
          throwOnError: true,
        },
      );
      if (!sent)
        throw new HttpError(
          503,
          "No se pudo enviar el código. Inténtalo más tarde.",
          "EMAIL_CODE_UNAVAILABLE",
        );
      await serializable(db, async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        current(user);
        if (user.correo !== challenge.destino)
          throw new HttpError(
            409,
            "El correo cambió. Solicita otro código.",
            "EMAIL_CODE_ACCOUNT_CHANGED",
          );
        const newer = await tx.verification.findFirst({
          where: {
            usuarioId: userId,
            tipo: TYPE,
            usado: false,
            id: { gt: challenge.id },
          },
        });
        if (newer)
          throw new HttpError(
            409,
            "Hay una solicitud más reciente. Usa su código.",
            "EMAIL_CODE_SUPERSEDED",
          );
        await tx.verification.updateMany({
          where: { usuarioId: userId, tipo: TYPE, usado: false },
          data: { usado: true },
        });
        await tx.verification.update({
          where: { id: challenge.id },
          data: { tipo: TYPE, usado: user.correoVerificado },
        });
      });
    } catch (error) {
      await db.verification.updateMany({
        where: { id: challenge.id, tipo: PENDING },
        data: { usado: true },
      });
      throw error;
    }
    return {
      challengeId: String(challenge.id),
      expiresAt: challenge.expiresAt.toISOString(),
      resendAfterSeconds: 60,
      mensaje:
        "Te enviamos un código al Gmail de tu cuenta. Revisa también Spam.",
    };
  }
  async function confirm(userId, challengeId, code) {
    if (
      typeof challengeId !== "string" ||
      !/^[1-9]\d{0,9}$/.test(challengeId) ||
      Number(challengeId) > 2147483647 ||
      typeof code !== "string" ||
      !/^\d{6}$/.test(code)
    )
      throw new HttpError(
        400,
        "Introduce el código de seis dígitos.",
        "EMAIL_CODE_INVALID",
      );
    const result = await serializable(db, async (tx) => {
      const v = await tx.verification.findFirst({
          where: { id: Number(challengeId), usuarioId: userId, tipo: TYPE },
        }),
        clock = now();
      if (!v || v.usado || v.expiresAt.getTime() <= clock || v.intentos >= 5)
        return fail(
          400,
          "El código venció, ya fue utilizado o agotó sus intentos. Solicita otro.",
          "EMAIL_CODE_EXPIRED",
        );
      const updated = await tx.verification.updateMany({
        where: {
          id: v.id,
          usado: false,
          intentos: { lt: 5 },
          expiresAt: { gt: new Date(clock) },
        },
        data: { intentos: { increment: 1 } },
      });
      if (!updated.count)
        return fail(400, "Solicita un código nuevo.", "EMAIL_CODE_EXPIRED");
      if (!(await verifyPassword(code, v.codigoHash)))
        return fail(
          400,
          v.intentos + 1 >= 5
            ? "Se agotaron los intentos. Solicita otro código."
            : "Código incorrecto. Revisa los seis dígitos del correo.",
          "EMAIL_CODE_INVALID",
        );
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.bloqueado || user.correo !== v.destino) {
        await tx.verification.update({
          where: { id: v.id },
          data: { usado: true },
        });
        return fail(
          409,
          "La cuenta o el correo cambió. Solicita otra verificación.",
          "EMAIL_CODE_ACCOUNT_CHANGED",
        );
      }
      await tx.user.update({
        where: { id: userId },
        data: { correoVerificado: true },
      });
      await tx.verification.update({
        where: { id: v.id },
        data: { usado: true },
      });
      await refreshEffects(tx, userId);
      return { ok: true };
    });
    // Incorrect attempts must commit before returning an error to the client.
    if (!result.ok)
      throw new HttpError(result.status, result.message, result.code);
    return result;
  }
  return { request, confirm };
}
module.exports = { createEmailCodeService };
