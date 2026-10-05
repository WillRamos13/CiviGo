const { HttpError } = require("./http");
const { firebaseEmailConfig } = require("./firebase-email");

const timeoutMs = 15000;
const phonePattern = /^\+[1-9]\d{7,14}$/;
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const verificationStatuses = new Set([
  "pending",
  "approved",
  "canceled",
  "max_attempts_reached",
  "deleted",
  "failed",
  "expired",
]);

function twilioConfig() {
  const account = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const service = (process.env.TWILIO_VERIFY_SERVICE_SID || "").trim();
  return {
    account,
    token,
    service,
    configured:
      /^AC[0-9a-f]{32}$/i.test(account) &&
      !!token &&
      /^VA[0-9a-f]{32}$/i.test(service),
  };
}
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
  const provider = (
    process.env.PHONE_VERIFICATION_PROVIDER ||
    (twilioConfig().configured ? "twilio" : "whatsapp-manual")
  )
    .trim()
    .toLowerCase();
  const manual = provider === "whatsapp-manual";
  return {
    telefono: {
      proveedor: manual
        ? "whatsapp-manual"
        : provider === "twilio"
          ? "twilio-verify"
          : "sin-configurar",
      configurado: manual
        ? manualPhoneConfig().configured
        : provider === "twilio" && twilioConfig().configured,
      canales: manual
        ? ["whatsapp"]
        : provider === "twilio"
          ? ["sms", "whatsapp"]
          : [],
      demo:
        process.env.DEMO_VERIFICATION === "true" &&
        process.env.NODE_ENV !== "production",
    },
    correo: { proveedor: "resend", configurado: emailConfig().configured },
    correoGoogle: {
      proveedor: "firebase-google",
      configurado: firebaseEmailConfig().configured,
    },
  };
}
function manualPhoneConfig() {
  const telefono = (process.env.WHATSAPP_VERIFICATION_NUMBER || "").trim();
  return { telefono, configured: phonePattern.test(telefono) };
}
function validatePhone(telefono) {
  if (typeof telefono !== "string" || !phonePattern.test(telefono))
    throw new HttpError(
      400,
      "Teléfono inválido. Utiliza el formato internacional.",
      "PHONE_INVALID",
    );
}
function validatePhoneChannel(canal) {
  if (!["sms", "whatsapp"].includes(canal))
    throw new HttpError(
      400,
      "Canal inválido. Elige SMS o WhatsApp.",
      "PHONE_CHANNEL_INVALID",
    );
  return canal;
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
function twilioError(status, data, checking) {
  const code = Number(data?.code);
  if (checking && status === 404)
    return new HttpError(
      400,
      "Código vencido o ya utilizado. Solicita uno nuevo.",
      "PHONE_CODE_EXPIRED",
    );
  if (status === 429 || [20429, 60202, 60203, 60207].includes(code))
    return new HttpError(
      429,
      "Demasiados intentos de verificación. Espera antes de intentarlo otra vez.",
      "PHONE_RATE_LIMITED",
    );
  if (code === 60200)
    return new HttpError(
      400,
      "No pudo verificarse ese teléfono o código. Comprueba los datos.",
      "PHONE_INVALID",
    );
  if ([68008, 60204].includes(code))
    return unavailable(
      "PHONE_CHANNEL_UNAVAILABLE",
      "Ese canal de verificación todavía no está habilitado. Prueba otro canal.",
    );
  if (status === 401 || status === 403)
    return unavailable(
      "PHONE_PROVIDER_CONFIG",
      "La verificación telefónica requiere revisar la configuración del proveedor.",
    );
  return unavailable("PHONE_PROVIDER_UNAVAILABLE");
}
async function twilioRequest(path, values, checking = false) {
  const { account, token, service, configured } = twilioConfig();
  if (!configured)
    throw unavailable(
      "PHONE_PROVIDER_MISSING",
      "Verificación telefónica no configurada. Hace falta un proveedor SMS o WhatsApp.",
    );
  return providerFetch(
    "https://verify.twilio.com/v2/Services/" + service + "/" + path,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(account + ":" + token).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(values).toString(),
    },
    (status, data) => twilioError(status, data, checking),
    "PHONE_PROVIDER",
  );
}
async function requestPhone(telefono, canal = "sms") {
  validatePhone(telefono);
  validatePhoneChannel(canal);
  const result = await twilioRequest("Verifications", {
    To: telefono,
    Channel: canal,
    Locale: "es",
  });
  if (result.status !== "pending")
    throw unavailable(
      "PHONE_PROVIDER_INVALID_RESPONSE",
      "El proveedor no confirmó la solicitud del código. Inténtalo después.",
    );
  return { status: "pending" };
}
async function checkPhone(telefono, codigo) {
  validatePhone(telefono);
  if (typeof codigo !== "string" || !/^\d{4,10}$/.test(codigo))
    throw new HttpError(
      400,
      "Código inválido. Introduce solo los dígitos recibidos.",
      "PHONE_CODE_INVALID",
    );
  const result = await twilioRequest(
    "VerificationCheck",
    { To: telefono, Code: codigo },
    true,
  );
  if (!verificationStatuses.has(result.status))
    throw unavailable("PHONE_PROVIDER_INVALID_RESPONSE");
  if (result.status === "max_attempts_reached")
    throw twilioError(429, {}, true);
  if (["expired", "deleted", "canceled"].includes(result.status))
    throw twilioError(404, {}, true);
  return result.status === "approved";
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
  manualPhoneConfig,
  validatePhoneChannel,
  requestPhone,
  checkPhone,
  sendEmail,
};
