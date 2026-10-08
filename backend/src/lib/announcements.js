const { HttpError, id, text, coordinates } = require("./http");

function plainText(value, name, max, required = true) {
  if (!required && (value === undefined || value === null || value === ""))
    return "";
  const result = text(value, name, max);
  if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result))
    throw new HttpError(400, `${name}: usa texto sin HTML.`);
  return result;
}

function safeLink(value) {
  if (value === undefined || value === null || value === "") return null;
  const candidate = text(value, "Enlace", 500);
  if (
    /^\/(?:mapa|comunidad|recompensas|premium|reportar|mis-reportes|perfil|incidentes\/[1-9]\d*)$/.test(
      candidate,
    )
  )
    return candidate;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new HttpError(400, "Enlace inválido.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    /[\u0000-\u0020<>\\]/.test(candidate)
  )
    throw new HttpError(400, "Usa un enlace HTTPS sin credenciales.");
  return parsed.href;
}

function scheduledDate(value, name) {
  if (value === undefined || value === null || value === "") return null;
  // Require an unambiguous timezone; desktop converts Peru local input to ISO.
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    throw new HttpError(400, `${name}: fecha con zona horaria requerida.`);
  const date = new Date(value);
  if (
    !Number.isFinite(+date) ||
    date.getUTCFullYear() < 2020 ||
    date.getUTCFullYear() > 2100
  )
    throw new HttpError(400, `${name}: fecha inválida.`);
  const calendar = value.slice(0, 10);
  const day = new Date(`${calendar}T12:00:00Z`);
  if (day.toISOString().slice(0, 10) !== calendar)
    throw new HttpError(400, `${name}: fecha inválida.`);
  return date;
}

function announcementData(input, current = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "Anuncio inválido.");
  const merged = {
    tipo: "NOVEDAD",
    activo: true,
    orden: 0,
    ...current,
    ...input,
  };
  if (!["NOVEDAD", "NEGOCIO"].includes(merged.tipo))
    throw new HttpError(400, "Tipo de anuncio inválido.");
  if (typeof merged.activo !== "boolean")
    throw new HttpError(400, "Estado inválido.");
  if (
    !Number.isInteger(merged.orden) ||
    merged.orden < 0 ||
    merged.orden > 10000
  )
    throw new HttpError(400, "Orden inválido.");
  const inicio = scheduledDate(
    merged.inicio instanceof Date ? merged.inicio.toISOString() : merged.inicio,
    "Inicio",
  );
  const fin = scheduledDate(
    merged.fin instanceof Date ? merged.fin.toISOString() : merged.fin,
    "Fin",
  );
  if (inicio && fin && fin <= inicio)
    throw new HttpError(400, "El fin debe ser posterior al inicio.");
  return {
    tipo: merged.tipo,
    titulo: plainText(merged.titulo, "Título", 120),
    mensaje: plainText(merged.mensaje, "Mensaje", 500, false),
    negocioId: merged.tipo === "NEGOCIO" ? id(merged.negocioId) : null,
    enlace: merged.tipo === "NEGOCIO" ? null : safeLink(merged.enlace),
    activo: merged.activo,
    orden: merged.orden,
    inicio,
    fin,
  };
}

function publicAnnouncement(row) {
  const business = row.negocio;
  return {
    id: row.id,
    tipo: row.tipo,
    titulo: row.titulo,
    mensaje: row.mensaje,
    enlace: row.tipo === "NOVEDAD" ? safeLink(row.enlace) : null,
    negocioId: row.negocioId,
    orden: row.orden,
    inicio: row.inicio,
    fin: row.fin,
    negocio:
      row.tipo === "NEGOCIO" && business
        ? {
            id: business.id,
            nombre: business.nombre,
            descripcion: business.descripcion,
            direccion: business.direccion,
            horario: business.horario,
            sitioWeb: (() => {
              try {
                return safeLink(business.sitioWeb);
              } catch {
                return null;
              }
            })(),
            telefono: business.telefono,
            latitud: business.latitud,
            longitud: business.longitud,
          }
        : null,
  };
}

function trafficModerationData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "Aviso inválido.");
  const externoId = text(input.externoId, "Identificador externo", 200);
  if (/[\u0000-\u001f\u007f]/.test(externoId))
    throw new HttpError(400, "Identificador externo inválido.");
  if (typeof input.oculto !== "boolean")
    throw new HttpError(400, "Estado inválido.");
  const motivo = plainText(input.motivo, "Motivo", 1000);
  if (motivo.length < 10)
    throw new HttpError(400, "Explica el motivo con al menos 10 caracteres.");
  let datos;
  if (input.datos !== undefined && input.datos !== null) {
    if (typeof input.datos !== "object" || Array.isArray(input.datos))
      throw new HttpError(400, "Datos del aviso inválidos.");
    const snapshot = input.datos;
    datos = {};
    for (const key of ["titulo", "tipo", "descripcion"])
      if (snapshot[key] !== undefined)
        datos[key] = plainText(
          snapshot[key],
          key,
          key === "descripcion" ? 1000 : 200,
          false,
        );
    if (snapshot.latitud !== undefined || snapshot.longitud !== undefined)
      Object.assign(datos, coordinates(snapshot.latitud, snapshot.longitud));
    for (const key of ["inicio", "fin"])
      if (snapshot[key])
        datos[key] = scheduledDate(snapshot[key], key).toISOString();
  }
  return {
    proveedor: "TOMTOM",
    externoId,
    oculto: input.oculto,
    motivo,
    ...(datos ? { datos } : {}),
  };
}

module.exports = {
  announcementData,
  publicAnnouncement,
  trafficModerationData,
  safeLink,
  scheduledDate,
};
