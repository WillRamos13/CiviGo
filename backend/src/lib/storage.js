const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { HttpError } = require("./http");

const UPLOAD_DIR = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, "../../uploads"),
);
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const REMOTE_PATH =
  /^supabase:\/\/([a-zA-Z0-9_-]+)\/(uploads\/[1-9]\d*\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;

function storageStatus(env = process.env) {
  const provider = env.STORAGE_PROVIDER || "local";
  const tipo = ["local", "supabase"].includes(provider)
    ? provider
    : "desconocido";
  const faltan = [];
  if (tipo === "supabase") {
    if (!env.SUPABASE_URL) faltan.push("SUPABASE_URL");
    if (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY)
      faltan.push("SUPABASE_SECRET_KEY");
  }
  let valido = ["local", "supabase"].includes(tipo) && faltan.length === 0;
  if (tipo === "supabase" && valido) {
    try {
      remoteConfig(env);
    } catch {
      valido = false;
    }
  }
  return {
    tipo,
    configurado: valido,
    requiereVolumenPersistente: tipo === "local",
    ...(tipo === "supabase" ? { requiereBucketPrivado: true, faltan } : {}),
  };
}

function remoteConfig(env) {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  let privateKey = typeof key === "string" && /^sb_secret_\S+$/.test(key);
  if (!privateKey && typeof key === "string" && !/\s/.test(key)) {
    try {
      const parts = key.split(".");
      privateKey =
        parts.length === 3 &&
        JSON.parse(Buffer.from(parts[1], "base64url").toString()).role ===
          "service_role";
    } catch {
      /* An anon key or malformed JWT is not a backend credential. */
    }
  }
  let url;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    throw new HttpError(
      503,
      "Configura SUPABASE_URL para guardar archivos.",
      "STORAGE_CONFIG",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    !privateKey
  )
    throw new HttpError(
      503,
      "La configuración privada de almacenamiento no es válida.",
      "STORAGE_CONFIG",
    );
  const bucket = env.SUPABASE_STORAGE_BUCKET || "civigo-attachments";
  if (!/^[a-zA-Z0-9_-]+$/.test(bucket))
    throw new HttpError(
      503,
      "SUPABASE_STORAGE_BUCKET no es válido.",
      "STORAGE_CONFIG",
    );
  const headers = { apikey: key };
  // New secret keys identify the backend through apikey; they are not JWTs.
  if (!key.startsWith("sb_secret_")) headers.Authorization = "Bearer " + key;
  return { base: url.origin + "/storage/v1", bucket, headers };
}

function localPath(value, directory) {
  if (typeof value !== "string" || value.startsWith("supabase://"))
    throw new HttpError(404, "Archivo no disponible.");
  const resolved = path.resolve(value);
  const relative = path.relative(directory, resolved);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw new HttpError(404, "Archivo no disponible.");
  return resolved;
}

function remotePath(value) {
  const parts = typeof value === "string" && REMOTE_PATH.exec(value);
  if (!parts) throw new HttpError(404, "Archivo no disponible.");
  return { bucket: parts[1], key: parts[2] };
}

function createStorage({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
  directory = UPLOAD_DIR,
} = {}) {
  async function request(config, suffix, options = {}) {
    let response;
    try {
      response = await fetchImpl(config.base + suffix, {
        ...options,
        headers: { ...config.headers, ...options.headers },
        signal: AbortSignal.timeout(15000),
        // A provider redirect must never forward backend credentials elsewhere.
        redirect: "error",
      });
    } catch {
      throw new HttpError(
        503,
        "El almacenamiento no está disponible. Inténtalo nuevamente.",
        "STORAGE_UNAVAILABLE",
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 404 && suffix.startsWith("/object/"))
        throw new HttpError(404, "Archivo no disponible.");
      if (response.status === 416)
        throw new HttpError(416, "Rango de archivo inválido.");
      throw new HttpError(
        response.status === 429 ? 429 : 503,
        "El almacenamiento no pudo completar la solicitud.",
        "STORAGE_UNAVAILABLE",
      );
    }
    return response;
  }

  async function privateBucket(config, bucket) {
    const response = await request(
      config,
      "/bucket/" + encodeURIComponent(bucket),
      { method: "GET" },
    );
    let data;
    try {
      data = await response.json();
    } catch {
      /* Fail closed on malformed metadata. */
    }
    if (data?.public !== false)
      throw new HttpError(
        503,
        "El bucket de archivos debe existir y ser privado.",
        "STORAGE_PRIVATE_BUCKET_REQUIRED",
      );
  }

  async function save({ id, userId, filePath, mimeType }) {
    const provider = env.STORAGE_PROVIDER || "local";
    const source = localPath(filePath, directory);
    if (provider === "local") return source;
    if (provider !== "supabase")
      throw new HttpError(
        503,
        "STORAGE_PROVIDER debe ser local o supabase.",
        "STORAGE_CONFIG",
      );
    const config = remoteConfig(env);
    const key = "uploads/" + userId + "/" + id;
    const storedPath = "supabase://" + config.bucket + "/" + key;
    remotePath(storedPath);
    await privateBucket(config, config.bucket);
    const buffer = await fs.promises.readFile(source);
    if (buffer.length > MAX_FILE_SIZE)
      throw new HttpError(413, "El archivo supera 15 MB.");
    const response = await request(
      config,
      "/object/" + config.bucket + "/" + key,
      {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "max-age=0",
          "x-upsert": "false",
        },
        body: buffer,
      },
    );
    await response.body?.cancel().catch(() => {});
    return storedPath;
  }

  async function remove(value) {
    if (!value.startsWith("supabase://")) {
      await fs.promises.unlink(localPath(value, directory)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      return;
    }
    const { bucket, key } = remotePath(value);
    const config = remoteConfig(env);
    // Delete only the generated exact object, never folders or buckets.
    const response = await request(config, "/object/" + bucket, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [key] }),
    });
    await response.body?.cancel().catch(() => {});
  }

  async function send(row, req, res) {
    if (!row.path.startsWith("supabase://")) {
      const resolved = localPath(row.path, directory);
      let actual;
      try {
        actual = await fs.promises.realpath(resolved);
      } catch {
        throw new HttpError(404, "Archivo no disponible.");
      }
      // Do not follow a local symlink out of the managed upload directory.
      const actualRoot = await fs.promises.realpath(directory);
      localPath(actual, actualRoot);
      await new Promise((resolve, reject) =>
        res.sendFile(actual, { dotfiles: "allow" }, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      return;
    }
    const { bucket, key } = remotePath(row.path);
    const config = remoteConfig(env);
    const range = req.headers.range;
    if (range && !/^bytes=(\d+-\d*|-\d+)$/.test(range))
      throw new HttpError(416, "Rango de archivo inválido.");
    await privateBucket(config, bucket);
    const response = await request(
      config,
      "/object/authenticated/" + bucket + "/" + key,
      {
        method: "GET",
        headers: range ? { Range: range } : {},
      },
    );
    if (!response.body)
      throw new HttpError(503, "Archivo no disponible.", "STORAGE_UNAVAILABLE");
    res.status(response.status);
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    // Backend permissions are evaluated on every request, including video ranges.
    await pipeline(Readable.fromWeb(response.body), res);
  }

  return { save, remove, send, status: () => storageStatus(env) };
}

module.exports = { createStorage, storageStatus, UPLOAD_DIR, MAX_FILE_SIZE };
