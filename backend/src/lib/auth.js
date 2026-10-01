const crypto = require("node:crypto");
const prisma = require("./db");
const { HttpError, asyncRoute } = require("./http");
const COOKIE = "civigo_session";
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");
function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((p) => p.trim().split("="))
      .filter((p) => p.length === 2),
  );
}
async function loadUser(req) {
  if (req.authLoaded) return req.user || null;
  req.authLoaded = true;
  const token = cookies(req)[COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { usuario: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  req.sessionId = session.id;
  req.user = session.usuario;
  return req.user;
}
const optionalAuth = asyncRoute(async (req, res, next) => {
  req.user = await loadUser(req);
  next();
});
const auth = asyncRoute(async (req, res, next) => {
  req.user = await loadUser(req);
  if (!req.user) throw new HttpError(401, "Inicia sesión para continuar.");
  if (
    req.user.bloqueado &&
    !/^\/api\/(users\/(me|logout)|reports(\/mine|\/\d+\/appeal)?)$/.test(
      req.originalUrl.split("?")[0],
    )
  )
    throw new HttpError(
      403,
      "Tu cuenta está bloqueada; puedes consultar tus reportes y solicitar revisión.",
      "ACCOUNT_BLOCKED",
    );
  next();
});
function requirePhone(req, res, next) {
  if (req.user?.bloqueado)
    return next(
      new HttpError(
        403,
        "Tu cuenta está bloqueada. Puedes solicitar revisión de tus reportes.",
      ),
    );
  if (!req.user?.telefonoVerificado)
    return next(
      new HttpError(
        403,
        "Verifica tu teléfono para participar.",
        "PHONE_REQUIRED",
      ),
    );
  next();
}
function hasPermission(user, permission) {
  return (
    !user?.bloqueado &&
    (user?.rol === "ADMIN" ||
      (user?.rol === "AGENTE" && user.permisos.includes(permission)))
  );
}
const requirePermission = (permission) => (req, res, next) =>
  hasPermission(req.user, permission)
    ? next()
    : next(new HttpError(403, "No tienes permiso para esta acción."));
function canReview(user, incident, permission = "revisar") {
  return (
    hasPermission(user, permission) &&
    (user.rol === "ADMIN" ||
      user.tipoAgente === "COLABORADOR" ||
      (!!user.distrito && incident.distrito === user.distrito))
  );
}
async function createSession(user, res) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await prisma.session.create({
    data: { id: hashToken(token), usuarioId: user.id, expiresAt },
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.COOKIE_SAME_SITE === "none" ? "none" : "lax",
    expires: expiresAt,
    path: "/",
  });
}
const demoEnabled = () =>
  process.env.DEMO_VERIFICATION === "true" &&
  process.env.NODE_ENV !== "production";
module.exports = {
  auth,
  optionalAuth,
  requirePhone,
  requirePermission,
  hasPermission,
  canReview,
  createSession,
  COOKIE,
  hashToken,
  demoEnabled,
  loadUser,
};
