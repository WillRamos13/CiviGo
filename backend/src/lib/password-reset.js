const crypto = require("node:crypto");
const { HttpError } = require("./http");
const { hashPassword, verifyPassword } = require("./password");
const { hashToken } = require("./auth");
const { serializable } = require("./upload-quota");
const TYPE = "PASSWORD_RESET";
function resetOrigin(env = process.env) {
  const raw =
    env.PUBLIC_APP_URL ||
    env.FRONTEND_URL?.split(",")[0] ||
    "https://civigo.online";
  const url = new URL(raw.trim());
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new HttpError(
      503,
      "La dirección de recuperación no está configurada correctamente.",
    );
  return url.origin;
}
async function requestReset(db, correo, sendEmail, env = process.env) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const challenge = await serializable(db, async (tx) => {
    const user = await tx.user.findUnique({ where: { correo } });
    if (!user) return null;
    const recent = await tx.verification.findMany({
      where: {
        usuarioId: user.id,
        tipo: TYPE,
        creadoEn: { gte: new Date(+now - 3600000) },
      },
      orderBy: { creadoEn: "desc" },
      take: 5,
    });
    if (recent.length >= 5 || (recent[0] && +now - recent[0].creadoEn < 60000))
      return null;
    await tx.verification.updateMany({
      where: { usuarioId: user.id, tipo: TYPE, usado: false },
      data: { usado: true },
    });
    return tx.verification.create({
      data: {
        usuarioId: user.id,
        tipo: TYPE,
        destino: correo,
        codigoHash: hashToken(token),
        expiresAt: new Date(+now + 15 * 60000),
      },
    });
  });
  if (!challenge) return;
  const link = resetOrigin(env) + "/recuperar#token=" + token;
  const sent = await sendEmail(
    correo,
    "Restablece tu contraseña de CiviGo",
    `<p>Solicitaste cambiar tu contraseña de CiviGo.</p><p><a href="${link}">Crear una nueva contraseña</a></p><p>El enlace vence en 15 minutos y funciona una sola vez. Si no lo solicitaste, puedes ignorarlo.</p>`,
    { idempotencyKey: "password-reset/" + challenge.id },
  );
  if (!sent)
    await db.verification.update({
      where: { id: challenge.id },
      data: { usado: true },
    });
}
async function finishReset(db, token, password) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(
      400,
      "El enlace de recuperación es inválido o ha vencido.",
    );
  const encoded = await hashPassword(password);
  await serializable(db, async (tx) => {
    const v = await tx.verification.findFirst({
      where: {
        tipo: TYPE,
        codigoHash: hashToken(token),
        usado: false,
        expiresAt: { gt: new Date() },
      },
    });
    if (!v)
      throw new HttpError(
        400,
        "El enlace de recuperación es inválido o ha vencido.",
      );
    const changed = await tx.user.updateMany({
      where: { id: v.usuarioId, correo: v.destino },
      data: { password: encoded },
    });
    if (!changed.count)
      throw new HttpError(
        400,
        "La cuenta cambió. Solicita otro enlace de recuperación.",
      );
    await tx.verification.updateMany({
      where: { usuarioId: v.usuarioId, tipo: TYPE, usado: false },
      data: { usado: true },
    });
    await tx.session.deleteMany({ where: { usuarioId: v.usuarioId } });
  });
}
async function changePassword(db, userId, current, next) {
  const encoded = await hashPassword(next);
  await serializable(db, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !(await verifyPassword(current, user.password)))
      throw new HttpError(400, "La contraseña actual no es correcta.");
    await tx.user.update({
      where: { id: userId },
      data: { password: encoded },
    });
    await tx.verification.updateMany({
      where: { usuarioId: userId, tipo: TYPE, usado: false },
      data: { usado: true },
    });
    await tx.session.deleteMany({ where: { usuarioId: userId } });
  });
}
module.exports = { requestReset, finishReset, changePassword, resetOrigin };
