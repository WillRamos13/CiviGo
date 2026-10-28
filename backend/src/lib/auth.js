const crypto = require("node:crypto");
const prisma = require("./db");
const { HttpError, asyncRoute } = require("./http");
const { effectivePermissions } = require("./agent-permissions");
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
  req.user = await require("./payments").withPaidPremium(session.usuario, prisma);
  return req.user;
}
const optionalAuth = asyncRoute(async (req, res, next) => {
  req.user = await loadUser(req);
  next();
});
const auth = asyncRoute(async (req, res, next) => {
  req.user = await loadUser(req);
  if (!req.user) throw new HttpError(401, "Inicia sesión para continuar.");
  const path = req.originalUrl.split("?")[0].replace(/\/$/, "");
  const blockedAccess =
    (["GET", "HEAD"].includes(req.method) &&
      /^\/api\/(users\/me|reports(\/mine)?)$/.test(path)) ||
    (req.method === "POST" &&
      /^\/api\/(users\/logout|reports\/\d+\/appeal)$/.test(path));
  if (req.user.bloqueado && !blockedAccess)
    throw new HttpError(
      403,
      "Tu cuenta está bloqueada; puedes consultar tus reportes y solicitar revisión.",
      "ACCOUNT_BLOCKED",
    );
  next();
});
function requireEmail(req, res, next) {
  if (req.user?.bloqueado)
    return next(
      new HttpError(
        403,
        "Tu cuenta está bloqueada. Puedes solicitar revisión de tus reportes.",
      ),
    );
  if (!req.user?.correoVerificado)
    return next(
      new HttpError(
        403,
        "Verifica tu correo con Google para participar.",
        "EMAIL_REQUIRED",
      ),
    );
  next();
}
// Participation can outlive authentication while another request revokes the
// account. Read these fields in the transaction that commits the contribution.
async function currentParticipant(db, usuarioId) {
  const user = await db.user.findUnique({
    where: { id: usuarioId },
    select: { id: true, bloqueado: true, correoVerificado: true },
  });
  if (!user || user.bloqueado)
    throw new HttpError(
      403,
      "Tu cuenta ya no puede participar.",
      "ACCOUNT_BLOCKED",
    );
  if (!user.correoVerificado)
    throw new HttpError(
      403,
      "Verifica tu correo con Google para participar.",
      "EMAIL_REQUIRED",
    );
  return user;
}
function hasPermission(user, permission) {
  return (
    !user?.bloqueado &&
    (user?.rol === "ADMIN" ||
      (user?.rol === "AGENTE" &&
        effectivePermissions(user.permisos).includes(
          permission === "revisar" ? "consultar" : permission,
        )))
  );
}
const requirePermission = (permission) => (req, res, next) =>
  hasPermission(req.user, permission)
    ? next()
    : next(new HttpError(403, "No tienes permiso para esta acción."));
function canReview(user, incident, permission = "consultar") {
  return (
    hasPermission(user, permission) &&
    (user.rol === "ADMIN" ||
      user.tipoAgente === "COLABORADOR" ||
      (!!user.distrito && incident.distrito === user.distrito))
  );
}
async function createSession(user, res, { passwordHash } = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  const data = { id: hashToken(token), usuarioId: user.id, expiresAt };
  let current = user;
  if (passwordHash !== undefined) {
    // Password resets also update User and delete Session rows transactionally.
    // Recheck the credential in the same serializable transaction as the new
    // session: a login verified just before a reset cannot resurrect access.
    current = await require("./upload-quota").serializable(
      prisma,
      async (db) => {
        const stored = await db.user.findUnique({ where: { id: user.id } });
        if (
          !stored ||
          stored.password !== passwordHash ||
          stored.correo !== user.correo
        )
          throw new HttpError(401, "Correo o contraseña incorrectos.");
        await db.session.create({ data });
        return stored;
      },
    );
  } else await prisma.session.create({ data });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.COOKIE_SAME_SITE === "none" ? "none" : "lax",
    expires: expiresAt,
    path: "/",
  });
  return require("./payments").withPaidPremium(current, prisma);
}
module.exports = {
  auth,
  optionalAuth,
  requireEmail,
  currentParticipant,
  requirePermission,
  hasPermission,
  canReview,
  createSession,
  COOKIE,
  hashToken,
  loadUser,
};
