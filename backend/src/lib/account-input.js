const { HttpError, text } = require("./http");

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
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized.length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)
  )
    throw new HttpError(400, "Correo inválido.");
  return normalized;
}

function birthDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new HttpError(400, "Fecha de nacimiento inválida.");
  const date = new Date(value + "T00:00:00Z");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const limit = new Date(today + "T00:00:00Z");
  limit.setUTCFullYear(limit.getUTCFullYear() - 12);
  if (
    Number.isNaN(+date) ||
    date.toISOString().slice(0, 10) !== value ||
    date > limit ||
    date.getUTCFullYear() < 1900
  )
    throw new HttpError(
      400,
      "La edad mínima es 12 años; comprueba la fecha de nacimiento.",
    );
  return date;
}

function nicknameValue(value) {
  const nickname = text(value, "Nickname", 30, 3);
  if (!/^[\p{L}\p{N}_ .-]+$/u.test(nickname))
    throw new HttpError(400, "Nickname inválido.");
  return nickname;
}

module.exports = { phone, email, birthDate, nicknameValue };
