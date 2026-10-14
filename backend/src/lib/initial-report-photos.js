"use strict";

const { randomUUID } = require("node:crypto");
const path = require("node:path");

const REFERENCE_PREFIX = "Foto de referencia";
const MIME_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
});
const MAX_REFERENCE_BYTES = 15 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function fail(message) {
  throw Object.assign(new Error(message), { code: "INITIAL_PHOTO_PLAN" });
}

function plainText(value, maximum, label) {
  if (typeof value !== "string") fail(`${label} inválido.`);
  const clean = value
    .replace(/[·\r\n\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) fail(`${label} obligatorio.`);
  return clean.slice(0, maximum).trim();
}

function commonsSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("La referencia debe enlazar a su ficha pública en Wikimedia Commons.");
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    fail("La ficha de referencia contiene una ruta inválida.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "commons.wikimedia.org" ||
    url.username ||
    url.password ||
    !pathname.startsWith("/wiki/File:") ||
    pathname.length <= "/wiki/File:".length ||
    url.href.length > 600 ||
    /[·\r\n\u0000-\u001f]/.test(value)
  )
    fail("La referencia debe enlazar a su ficha pública en Wikimedia Commons.");
  url.hash = "";
  return url.href;
}

function licenseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Falta el enlace de la licencia libre.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    ![
      "creativecommons.org",
      "www.creativecommons.org",
      "commons.wikimedia.org",
      "en.wikipedia.org",
    ].includes(url.hostname) ||
    url.href.length > 1000
  )
    fail(
      "El enlace de licencia debe ser público, HTTPS y de una fuente reconocida.",
    );
  return url.href;
}

function normalizePhotoManifest(manifest) {
  let values;
  if (Array.isArray(manifest)) values = manifest;
  else if (manifest && typeof manifest === "object")
    values = Object.entries(manifest).map(([slug, value]) => ({
      ...value,
      slug,
    }));
  else
    fail(
      "El manifiesto de fotografías debe ser una lista o un objeto por tipo.",
    );
  const result = new Map();
  for (const item of values) {
    if (
      !item ||
      typeof item !== "object" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug || "") ||
      result.has(item.slug)
    )
      fail("Los tipos del manifiesto deben ser válidos y únicos.");
    if (
      typeof item.file !== "string" ||
      !path.isAbsolute(item.file) ||
      /[\u0000\r\n]/.test(item.file)
    )
      fail("Cada referencia debe tener un archivo local absoluto.");
    if (
      !Object.hasOwn(MIME_EXTENSIONS, item.mimeType) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 1 ||
      item.size > MAX_REFERENCE_BYTES ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      fail(
        "La referencia necesita una imagen admitida, tamaño válido y huella SHA-256.",
      );
    const license = plainText(item.license, 40, "Licencia");
    if (
      !/^(?:CC BY(?:-SA)? (?:[1234]\.0|2\.5)|CC0(?: 1\.0)?|Public domain|Public Domain|PD)$/i.test(
        license,
      )
    )
      fail(
        "Sólo se permiten fotografías con licencia libre o dominio público.",
      );
    result.set(item.slug, {
      slug: item.slug,
      file: path.resolve(item.file),
      mimeType: item.mimeType,
      size: item.size,
      sha256: item.sha256,
      sourceUrl: commonsSourceUrl(item.sourceUrl),
      author: plainText(item.author, 150, "Autor"),
      license,
      licenseUrl: licenseUrl(item.licenseUrl),
      caption: plainText(item.caption, 100, "Descripción de la referencia"),
    });
  }
  if (!result.size) fail("El manifiesto no contiene fotografías.");
  return result;
}

function referencePhotoName(photo) {
  return [
    REFERENCE_PREFIX,
    photo.caption,
    photo.author,
    photo.license,
    photo.sourceUrl,
  ].join(" · ");
}

function planInitialPhotos({
  reports,
  manifest,
  userIds,
  reviewerId,
  targetPath,
  assignId = randomUUID,
  now = new Date(),
  expectedCount = 500,
} = {}) {
  if (
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 1 ||
    expectedCount > 2000 ||
    !Array.isArray(reports) ||
    reports.length !== expectedCount ||
    !Array.isArray(userIds) ||
    userIds.length !== 5 ||
    new Set(userIds).size !== 5 ||
    userIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    !userIds.includes(reviewerId) ||
    typeof targetPath !== "function" ||
    typeof assignId !== "function" ||
    !Number.isFinite(+now)
  )
    fail(
      "La planificación necesita el lote inicial completo y sus cinco cuentas verificadas.",
    );
  const photos = normalizePhotoManifest(manifest);
  const seenReports = new Set(),
    seenIncidents = new Set(),
    seenIds = new Set(),
    seenPaths = new Set();
  const uploads = [],
    reviews = [],
    types = new Map();
  for (const report of [...reports].sort((left, right) => left.id - right.id)) {
    const type = report.tipoCatalogo;
    const incident = report.incidente;
    if (
      !Number.isSafeInteger(report.id) ||
      report.id < 1 ||
      seenReports.has(report.id) ||
      !userIds.includes(report.usuarioId) ||
      !Number.isSafeInteger(report.incidenteId) ||
      report.incidenteId < 1 ||
      seenIncidents.has(report.incidenteId) ||
      !type ||
      type.id !== report.tipoId ||
      type.nombre !== report.tipo ||
      !incident ||
      incident.id !== report.incidenteId ||
      incident.tipoId !== report.tipoId ||
      incident.fuente !== "CARGA_INICIAL" ||
      report.estado !== "VALIDADO" ||
      incident.estado !== "VALIDADO" ||
      incident.publicado !== true ||
      !Array.isArray(report.adjuntos) ||
      report.adjuntos.length !== 0 ||
      (report.usuario && report.usuario.correoVerificado !== true)
    )
      fail(
        "Las referencias sólo pueden adjuntarse una vez a los pares iniciales del catálogo.",
      );
    const photo = photos.get(type.slug);
    if (!photo)
      fail(
        `Falta la referencia libre para el tipo ${type.slug || "sin identificar"}.`,
      );
    const id = assignId();
    if (typeof id !== "string" || !UUID.test(id) || seenIds.has(id))
      fail("Cada foto debe tener un identificador único válido.");
    const storedPath = targetPath({
      id,
      userId: report.usuarioId,
      filePath: photo.file,
      mimeType: photo.mimeType,
    });
    if (
      typeof storedPath !== "string" ||
      !storedPath ||
      /[\u0000\r\n]/.test(storedPath) ||
      seenPaths.has(storedPath)
    )
      fail(
        "Cada reporte debe guardar su propia copia, sin compartir objetos de almacenamiento.",
      );
    if (storedPath.startsWith("supabase://")) {
      const expected = new RegExp(
        "^supabase://[a-zA-Z0-9_-]+/uploads/" +
          report.usuarioId +
          "/" +
          id +
          "$",
      );
      if (!expected.test(storedPath))
        fail(
          "El objeto remoto no corresponde al autor y al identificador de la foto.",
        );
    } else if (!path.isAbsolute(storedPath) || path.basename(storedPath) !== id)
      fail(
        "La copia local debe tener su propia ruta absoluta por identificador.",
      );
    const reference = {
      synthetic: true,
      origin: "FOTOGRAFIA_REFERENCIA",
      notIncidentEvidence: true,
      caption: photo.caption,
      author: photo.author,
      license: photo.license,
      licenseUrl: photo.licenseUrl,
      sourceUrl: photo.sourceUrl,
      sha256: photo.sha256,
      attachmentId: id,
    };
    uploads.push({
      sourceFile: photo.file,
      attachment: {
        id,
        usuarioId: report.usuarioId,
        reporteId: report.id,
        nombre: referencePhotoName(photo),
        mimeType: photo.mimeType,
        size: photo.size,
        path: storedPath,
        estado: "LISTO",
        privado: false,
        tipo: "PUBLICO",
      },
      reference,
    });
    reviews.push({
      usuarioId: reviewerId,
      incidenteId: report.incidenteId,
      accion: "FOTOGRAFIA_REFERENCIA",
      motivo:
        "Se incorpora una fotografía ilustrativa con licencia libre. No es una prueba del incidente ni una imagen capturada en esta ubicación.",
      datos: reference,
      creadoEn: now,
    });
    seenReports.add(report.id);
    seenIncidents.add(report.incidenteId);
    seenIds.add(id);
    seenPaths.add(storedPath);
    types.set(type.slug, (types.get(type.slug) || 0) + 1);
  }
  return {
    uploads,
    reviews,
    summary: {
      synthetic: true,
      illustrativePhotos: expectedCount,
      actualIncidentEvidence: 0,
      distinctStorageObjects: expectedCount,
      originalReferenceFiles: types.size,
      countsByType: Object.fromEntries(types),
      attributionVisibleInFilename: true,
      sharedStoragePaths: false,
    },
  };
}

module.exports = {
  REFERENCE_PREFIX,
  MIME_EXTENSIONS,
  MAX_REFERENCE_BYTES,
  plainText,
  commonsSourceUrl,
  normalizePhotoManifest,
  referencePhotoName,
  planInitialPhotos,
};
