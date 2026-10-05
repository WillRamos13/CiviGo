const { HttpError } = require("./http");
const { firebaseEmailConfig } = require("./firebase-email");

const timeoutMs = 15000;
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
function emailConfig() {
  const key = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.EMAIL_FROM || "").trim();
  const address = from.match(/^[^<>\r\n]*<([^<>]+)>$/)?.[1] || from;
  return {
    key,
    from,
    configured: !!key && emailPattern.test(address) && !/[\r\n]/.test(from),
  };
}
function contactServices() {
  return {
    correo: { proveedor: "resend", configurado: emailConfig().configured },
    correoGoogle: {
      proveedor: "firebase-google",
      configurado: firebaseEmailConfig().configured,
    },
  };
}
function unavailable(
  code,
  message = "El proveedor no pudo completar la solicitud. Inténtalo después.",
) {
  return new HttpError(503, message, code);
}

// No reintenta POST automáticamente: un timeout puede ocurrir después del envío.
// Las llamadas de correo pueden conservar una clave idempotente al reintentarse.
async function providerFetch(url, options, onError, code) {
  let response, data;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw unavailable(code + "_UNAVAILABLE");
  }
  try {
    data = await response.json();
  } catch {
    if (response.ok) throw unavailable(code + "_INVALID_RESPONSE");
  }
  if (!response.ok) throw onError(response.status, data);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw unavailable(code + "_INVALID_RESPONSE");
  return data;
}
function resendError(status) {
  if (status === 429)
    return new HttpError(
      429,
      "El proveedor de correo alcanzó su límite. Inténtalo después.",
      "EMAIL_RATE_LIMITED",
    );
  if ([401, 403, 422].includes(status))
    return unavailable(
      "EMAIL_PROVIDER_CONFIG",
      "El correo requiere revisar la configuración del proveedor.",
    );
  return unavailable(
    "EMAIL_PROVIDER_UNAVAILABLE",
    "No pudo enviarse el correo. Inténtalo después.",
  );
}
async function sendEmail(to, subject, html, options = {}) {
  try {
    const { key, from, configured } = emailConfig();
    if (!configured)
      throw unavailable(
        "EMAIL_PROVIDER_MISSING",
        "El proveedor de correo no está configurado.",
      );
    if (
      typeof to !== "string" ||
      to.length > 254 ||
      !emailPattern.test(to) ||
      typeof subject !== "string" ||
      !subject.trim() ||
      subject.length > 998 ||
      /[\r\n]/.test(subject) ||
      typeof html !== "string" ||
      !html.trim() ||
      Buffer.byteLength(html) > 256 * 1024
    )
      throw new HttpError(
        400,
        "Correo, asunto o contenido inválido.",
        "EMAIL_INVALID",
      );
    const idempotencyKey = options.idempotencyKey;
    if (
      idempotencyKey !== undefined &&
      (typeof idempotencyKey !== "string" ||
        !/^[\x21-\x7e]{1,256}$/.test(idempotencyKey))
    )
      throw new HttpError(
        400,
        "Identificador de correo inválido.",
        "EMAIL_INVALID",
      );
    const result = await providerFetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify({ from, to: [to], subject, html }),
      },
      resendError,
      "EMAIL_PROVIDER",
    );
    if (typeof result.id !== "string" || !result.id.trim())
      throw unavailable("EMAIL_PROVIDER_INVALID_RESPONSE");
    return true;
  } catch (error) {
    if (options.throwOnError) throw error;
    return false;
  }
}

module.exports = {
  contactServices,
  sendEmail,
};
