"use strict";

const { isIP } = require("node:net");
const { readableImage } = require("./ai");
const storage = require("./storage");
const { imageWebUsageLimits } = require("./image-web-usage");

const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ATTACHMENTS = 3;
const TIMEOUT_MS = 12000;
const ATTACHMENT_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const FAILURE_REASONS = new Set([
  "TIMEOUT",
  "NETWORK",
  "HTTP_ERROR",
  "INVALID_RESPONSE",
  "QUOTA_REACHED",
  "QUOTA_ERROR",
]);

function apiKey(env) {
  const value =
    typeof env.GOOGLE_VISION_API_KEY === "string"
      ? env.GOOGLE_VISION_API_KEY.trim()
      : "";
  // Rechaza controles y valores que no pueden usarse como una clave en headers.
  return /^[A-Za-z0-9_-]{10,256}$/.test(value) ? value : "";
}

function imageWebStatus(env = process.env) {
  const limits = imageWebUsageLimits(env);
  return {
    proveedor: "google-vision",
    habilitado: env.IMAGE_WEB_CHECK_ENABLED === "true",
    configurado: !!apiKey(env),
    limites: { diario: limits.daily, mensual: limits.monthly },
  };
}

function failure(reason, status) {
  try {
    // No imprime respuestas, claves, archivos privados ni enlaces encontrados.
    console.warn(
      "[CiviGo búsqueda de imágenes] " +
        JSON.stringify({
          proveedor: "google-vision",
          motivo: FAILURE_REASONS.has(reason) ? reason : "INVALID_RESPONSE",
          ...(Number.isInteger(status) && status >= 100 && status <= 599
            ? { estado: status }
            : {}),
        }),
    );
  } catch {
    /* Un fallo de logs no impide enviar el aporte a revisión humana. */
  }
}

function unverified(row, motivo) {
  return { adjuntoId: row.id, resultado: "NO_COMPROBADA", motivo };
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function publicUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host.includes(".") ||
    /(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(host) ||
    host.endsWith(".home.arpa")
  )
    return null;
  // Los enlaces son referencias externas para revisión, nunca destinos de fetch.
  // Descarta direcciones privadas y todas las literales IPv6 por prudencia.
  if (host.startsWith("[")) return null;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19].includes(b)) ||
      a >= 224
    )
      return null;
  }
  url.hash = "";
  return url.toString();
}

function parseDetection(value, row) {
  if (
    !record(value) ||
    value.error ||
    !Array.isArray(value.responses) ||
    value.responses.length !== 1 ||
    !record(value.responses[0]) ||
    value.responses[0].error ||
    !record(value.responses[0].webDetection)
  )
    throw new Error("Invalid vision response");
  const detection = value.responses[0].webDetection;
  const matches = [];
  const pages = [];
  const seen = new Set();
  let found = false;

  function collect(container, name, tipo) {
    if (container[name] === undefined) return false;
    if (!Array.isArray(container[name]))
      throw new Error("Invalid vision matches");
    let hasMatches = false;
    for (const item of container[name]) {
      if (!record(item) || typeof item.url !== "string" || !item.url)
        throw new Error("Invalid vision match");
      hasMatches = true;
      const url = publicUrl(item.url);
      if (url && matches.length < 5 && !seen.has(url)) {
        seen.add(url);
        matches.push({ tipo, url });
      }
    }
    return hasMatches;
  }

  found = collect(detection, "fullMatchingImages", "COMPLETA") || found;
  found = collect(detection, "partialMatchingImages", "PARCIAL") || found;
  if (detection.pagesWithMatchingImages !== undefined) {
    if (!Array.isArray(detection.pagesWithMatchingImages))
      throw new Error("Invalid vision pages");
    for (const page of detection.pagesWithMatchingImages) {
      if (!record(page)) throw new Error("Invalid vision page");
      const full = collect(page, "fullMatchingImages", "COMPLETA");
      const partial = collect(page, "partialMatchingImages", "PARCIAL");
      if (!full && !partial) continue;
      found = true;
      const url = publicUrl(page.url);
      if (url && pages.length < 5 && !pages.includes(url)) pages.push(url);
    }
  }
  // Etiquetas y visuallySimilarImages no prueban reutilización de una foto.
  return {
    adjuntoId: row.id,
    resultado: found ? "COINCIDENCIA_WEB" : "SIN_COINCIDENCIAS",
    motivo: found
      ? "La imagen coincide total o parcialmente con contenido publicado en Internet. El origen requiere revisión humana; esto no declara falso el reporte."
      : "No se encontraron coincidencias en la búsqueda web. Este resultado no demuestra autoría, fecha ni ubicación.",
    ...(matches.length ? { coincidencias: matches } : {}),
    ...(pages.length ? { paginas: pages } : {}),
  };
}

function withinDeadline(work, signal) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(new Error("Image web timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const running = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return work();
  });
  return Promise.race([running, aborted]).finally(() =>
    signal.removeEventListener("abort", onAbort),
  );
}

async function responseJson(response, signal) {
  if (
    Number(response.headers?.get("content-length")) > MAX_RESPONSE_BYTES ||
    !response.body?.getReader
  )
    throw new Error("Invalid vision body");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await withinDeadline(() => reader.read(), signal);
      if (done) {
        completed = true;
        break;
      }
      if (!(value instanceof Uint8Array))
        throw new Error("Invalid vision body");
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Vision body too large");
      chunks.push(Buffer.from(value));
    }
    const json = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, bytes),
    );
    return JSON.parse(json);
  } finally {
    if (!completed) reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      /* Una lectura abortada puede seguir pendiente hasta su cancelación. */
    }
  }
}

function createImageWebCheck({
  env = process.env,
  fetchImpl = (...args) => global.fetch(...args),
  readAttachment = (row) => storage.createStorage({ env }).read(row),
  reserve = () =>
    require("./image-web-usage").reserveImageWebRequest(
      require("./db"),
      new Date(),
      imageWebUsageLimits(env),
    ),
  // El argumento permite pruebas rápidas; en operación nunca supera 12 s.
  timeoutMs = TIMEOUT_MS,
} = {}) {
  async function checkReportImages(rows) {
    const state = imageWebStatus(env);
    const key = apiKey(env);
    if (!state.habilitado)
      return { habilitado: false, requiereRevision: false, evidencias: [] };
    if (
      !Array.isArray(rows) ||
      rows.length > MAX_ATTACHMENTS ||
      rows.some(
        (row) =>
          !record(row) ||
          typeof row.id !== "string" ||
          !ATTACHMENT_ID.test(row.id) ||
          !["PUBLICO", "EVIDENCIA"].includes(row.tipo) ||
          typeof row.mimeType !== "string" ||
          (row.estado !== undefined && row.estado !== "LISTO"),
      ) ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    )
      return { habilitado: true, requiereRevision: true, evidencias: [] };
    const photos = rows.filter((row) => row.mimeType.startsWith("image/"));
    if (!photos.length)
      return { habilitado: true, requiereRevision: false, evidencias: [] };
    if (!state.configurado)
      return {
        habilitado: true,
        requiereRevision: true,
        evidencias: photos.map((row) =>
          unverified(
            row,
            "La búsqueda web no está disponible. El origen de la imagen requiere revisión humana.",
          ),
        ),
      };

    const controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimeout(
      () => controller.abort(),
      Number.isInteger(timeoutMs)
        ? Math.max(1, Math.min(TIMEOUT_MS, timeoutMs))
        : TIMEOUT_MS,
    );
    const evidencias = [];
    try {
      for (const row of photos) {
        let response;
        try {
          if (!IMAGE_TYPES.has(row.mimeType)) {
            evidencias.push(
              unverified(
                row,
                "El formato de la imagen no admite búsqueda web y requiere revisión humana.",
              ),
            );
            continue;
          }
          const buffer = await withinDeadline(
            () => readAttachment(row),
            signal,
          );
          if (!Buffer.isBuffer(buffer) || buffer.length > MAX_IMAGE_BYTES) {
            evidencias.push(
              unverified(
                row,
                "La imagen supera el límite de búsqueda web o no pudo leerse. El origen requiere revisión humana.",
              ),
            );
            continue;
          }
          if (!readableImage(buffer, row.mimeType)) {
            evidencias.push(
              unverified(
                row,
                "La imagen no es legible para la búsqueda web y requiere revisión humana.",
              ),
            );
            continue;
          }
          let allowed;
          try {
            allowed = await withinDeadline(() => reserve(), signal);
          } catch {
            failure(signal.aborted ? "TIMEOUT" : "QUOTA_ERROR");
          }
          if (allowed !== true) {
            if (allowed === false) failure("QUOTA_REACHED");
            evidencias.push(
              unverified(
                row,
                "La búsqueda web no pudo completarse. El origen de la imagen requiere revisión humana.",
              ),
            );
            continue;
          }
          response = await withinDeadline(
            () =>
              fetchImpl(VISION_URL, {
                method: "POST",
                redirect: "error",
                headers: {
                  "Content-Type": "application/json",
                  "x-goog-api-key": key,
                },
                signal,
                body: JSON.stringify({
                  requests: [
                    {
                      image: { content: buffer.toString("base64") },
                      features: [{ type: "WEB_DETECTION", maxResults: 10 }],
                    },
                  ],
                }),
              }),
            signal,
          );
          if (!response?.ok || response.redirected) {
            response?.body?.cancel().catch(() => {});
            failure("HTTP_ERROR", response?.status);
            evidencias.push(
              unverified(
                row,
                "La búsqueda web no está disponible. El origen de la imagen requiere revisión humana.",
              ),
            );
            continue;
          }
          const result = await responseJson(response, signal);
          evidencias.push(parseDetection(result, row));
        } catch {
          response?.body?.cancel().catch(() => {});
          failure(
            signal.aborted
              ? "TIMEOUT"
              : response
                ? "INVALID_RESPONSE"
                : "NETWORK",
          );
          evidencias.push(
            unverified(
              row,
              "No se pudo comprobar el origen de la imagen mediante la búsqueda web. Requiere revisión humana.",
            ),
          );
        }
      }
    } finally {
      clearTimeout(timeout);
    }
    return {
      habilitado: true,
      requiereRevision: evidencias.some(
        (item) => item.resultado !== "SIN_COINCIDENCIAS",
      ),
      evidencias,
    };
  }
  return { checkReportImages };
}

module.exports = { imageWebStatus, createImageWebCheck };
