class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
function id(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new HttpError(400, "Identificador inválido.");
  return number;
}
function text(value, name, max = 2000, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new HttpError(400, name + " inválido.");
  return value.trim();
}
function coordinates(latitud, longitud) {
  if (
    typeof latitud !== "number" ||
    typeof longitud !== "number" ||
    !Number.isFinite(latitud) ||
    !Number.isFinite(longitud) ||
    Math.abs(latitud) > 90 ||
    Math.abs(longitud) > 180
  )
    throw new HttpError(400, "Coordenadas inválidas.");
  return { latitud, longitud };
}
function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitud - a.latitud) * rad,
    dLon = (b.longitud - a.longitud) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitud * rad) *
      Math.cos(b.latitud * rad) *
      Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
const slug = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
function inCoverage(p) {
  return require("./roads").inProvince(p);
}
const isStaff = (u) => u?.rol === "ADMIN" || u?.rol === "AGENTE";
function districtScope(user) {
  if (user.rol === "ADMIN" || user.tipoAgente === "COLABORADOR") return {};
  if (user.rol === "AGENTE" && user.distrito)
    return { distrito: user.distrito };
  return { id: -1 };
}
module.exports = {
  HttpError,
  asyncRoute,
  id,
  text,
  coordinates,
  distance,
  slug,
  inCoverage,
  isStaff,
  districtScope,
};
