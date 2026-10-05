const crypto = require("node:crypto");
const { HttpError } = require("./http");

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxAuthAgeSeconds = 10 * 60;
let josePromise;
let remoteKeySetPromise;

const jose = () => (josePromise ||= import("jose"));
const invalid = () =>
  new HttpError(
    400,
    "La verificación con Google no es válida. Verifica nuevamente tu correo.",
    "EMAIL_GOOGLE_INVALID",
  );
const unavailable = () =>
  new HttpError(
    503,
    "No se pudo comprobar la verificación del correo. Inténtalo nuevamente.",
    "EMAIL_GOOGLE_UNAVAILABLE",
  );

function normalizedProjectId(value) {
  const projectId = typeof value === "string" ? value.trim() : "";
  return projectPattern.test(projectId) ? projectId : null;
}

function firebaseEmailConfig() {
  const projectId = normalizedProjectId(process.env.FIREBASE_PROJECT_ID);
  return { projectId, configured: Boolean(projectId) };
}

function normalizedEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && emailPattern.test(email) ? email : null;
}

async function remoteKeyResolver(header, token) {
  remoteKeySetPromise ||= jose().then(({ createRemoteJWKSet }) =>
    createRemoteJWKSet(new URL(JWKS_URL), {
      timeoutDuration: 10000,
      cacheMaxAge: 600000,
      cooldownDuration: 30000,
    }),
  );
  const keySet = await remoteKeySetPromise;
  return keySet(header, token);
}

// Explicit construction seam for local cryptographic tests. The production
// entry point below always binds Google's fixed public-key endpoint.
function createFirebaseEmailVerifier({
  projectId,
  keyResolver,
  now = Date.now,
}) {
  if (typeof keyResolver !== "function" || typeof now !== "function")
    throw new TypeError(
      "El verificador necesita una clave y un reloj válidos.",
    );
  const configuredProjectId = normalizedProjectId(projectId);

  return async function verify(idToken, correo, creadoEn) {
    if (!configuredProjectId)
      throw new HttpError(
        503,
        "La verificación de correo con Google no está configurada.",
        "EMAIL_GOOGLE_CONFIG",
      );
    const currentEmail = normalizedEmail(correo);
    if (
      typeof idToken !== "string" ||
      idToken.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken) ||
      !currentEmail ||
      !(
        creadoEn instanceof Date ||
        typeof creadoEn === "string" ||
        typeof creadoEn === "number"
      )
    )
      throw invalid();
    const createdTime = new Date(creadoEn).getTime();
    const currentDate = new Date(now());
    if (!Number.isFinite(createdTime) || createdTime <= 0) throw invalid();
    if (!Number.isFinite(currentDate.getTime())) throw unavailable();

    let api;
    try {
      api = await jose();
    } catch {
      throw unavailable();
    }
    let payload;
    try {
      const header = api.decodeProtectedHeader(idToken);
      if (
        header.alg !== "RS256" ||
        typeof header.kid !== "string" ||
        !header.kid.trim() ||
        header.kid.length > 128
      )
        throw invalid();
      ({ payload } = await api.jwtVerify(
        idToken,
        async (protectedHeader, token) => {
          try {
            return await keyResolver(protectedHeader, token);
          } catch (error) {
            if (
              error instanceof api.errors.JWKSNoMatchingKey ||
              error instanceof api.errors.JWKSMultipleMatchingKeys
            )
              throw invalid();
            throw unavailable();
          }
        },
        {
          algorithms: ["RS256"],
          audience: configuredProjectId,
          issuer: `https://securetoken.google.com/${configuredProjectId}`,
          requiredClaims: ["sub", "iat", "exp", "auth_time"],
          clockTolerance: 0,
          currentDate,
        },
      ));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw invalid();
    }

    // Key retrieval can take several seconds; freshness must still hold after
    // signature verification, rather than only when the request started.
    const verifiedTime = new Date(now()).getTime();
    if (!Number.isFinite(verifiedTime)) throw unavailable();
    const currentSeconds = Math.floor(verifiedTime / 1000);
    if (
      payload.aud !== configuredProjectId ||
      typeof payload.sub !== "string" ||
      !payload.sub.trim() ||
      payload.sub.length > 128 ||
      !Number.isSafeInteger(payload.iat) ||
      payload.iat <= 0 ||
      payload.iat > currentSeconds ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= currentSeconds ||
      payload.exp <= payload.iat ||
      !Number.isSafeInteger(payload.auth_time) ||
      payload.auth_time <= 0
    )
      throw invalid();
    if (
      payload.auth_time > currentSeconds ||
      payload.auth_time > payload.iat ||
      currentSeconds - payload.auth_time > maxAuthAgeSeconds ||
      payload.auth_time < Math.floor(createdTime / 1000)
    )
      throw new HttpError(
        400,
        "Verifica nuevamente tu correo con Google para confirmar esta solicitud.",
        "EMAIL_GOOGLE_RECENT_AUTH_REQUIRED",
      );
    if (
      payload.firebase?.sign_in_provider !== "google.com" ||
      payload.email_verified !== true ||
      !normalizedEmail(payload.email) ||
      normalizedEmail(payload.email) !== currentEmail
    )
      throw new HttpError(
        400,
        "La cuenta de Google no corresponde al correo verificado de esta solicitud.",
        "EMAIL_GOOGLE_EMAIL_MISMATCH",
      );

    // Refreshing an ID token preserves auth_time. Consume this event hash in
    // the application transaction, so a refreshed token cannot be used again.
    const proofHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([configuredProjectId, payload.sub, payload.auth_time]),
      )
      .digest("hex");
    return { proofHash };
  };
}

async function verifyFirebaseEmail(idToken, correo, creadoEn) {
  const { projectId } = firebaseEmailConfig();
  return createFirebaseEmailVerifier({
    projectId,
    keyResolver: remoteKeyResolver,
  })(idToken, correo, creadoEn);
}

module.exports = {
  firebaseEmailConfig,
  verifyFirebaseEmail,
  createFirebaseEmailVerifier,
};
