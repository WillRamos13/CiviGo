const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const multer = require("multer");
const prisma = require("../lib/db");
const { auth, optionalAuth, requireEmail, canReview } = require("../lib/auth");
const { asyncRoute, HttpError } = require("../lib/http");
const { attachment } = require("../lib/projections");
const { createStorage, UPLOAD_DIR, MAX_FILE_SIZE } = require("../lib/storage");
const allowed = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
]);
function signature(buffer, mime) {
  if (mime === "image/jpeg")
    return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (mime === "image/png")
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/gif")
    return /^GIF8[79]a/.test(buffer.subarray(0, 6).toString());
  if (mime === "image/webp")
    return (
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP"
    );
  if (mime === "video/mp4") return buffer.subarray(4, 8).toString() === "ftyp";
  if (mime === "video/quicktime")
    return (
      buffer.length >= 12 &&
      buffer.readUInt32BE(0) >= 12 &&
      buffer.subarray(4, 8).toString() === "ftyp" &&
      buffer.subarray(8, 12).toString() === "qt  "
    );
  if (mime === "video/webm")
    return buffer.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  if (mime === "application/pdf")
    return buffer.subarray(0, 5).toString() === "%PDF-";
  return false;
}
function createUploadRouter({
  db = prisma,
  storage = createStorage(),
  directory = UPLOAD_DIR,
  authenticate = auth,
  authenticateOptional = optionalAuth,
  verifyEmail = requireEmail,
} = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const router = express.Router();
  const upload = multer({
    storage: multer.diskStorage({
      destination: directory,
      filename: (req, file, cb) => cb(null, crypto.randomUUID()),
    }),
    limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 5, parts: 6 },
    fileFilter: (req, file, cb) =>
      allowed.has(file.mimetype)
        ? cb(null, true)
        : cb(
            new HttpError(
              400,
              "Solo fotos JPEG/PNG/WebP/GIF, videos MP4/MOV/WebM cortos y documentos PDF privados.",
            ),
          ),
  });
  router.post(
    "/",
    authenticate,
    upload.any(),
    asyncRoute(async (req, res) => {
      const file = req.files?.[0];
      if (!file)
        throw new HttpError(400, "Adjunta un archivo en el campo archivo.");
      let storedPath;
      let registered = false;
      try {
        const tipo = ["EVIDENCIA", "IDENTIDAD"].includes(req.body.tipo)
          ? req.body.tipo
          : "PUBLICO";
        // La identidad privada permite pedir recuperación. La autorización
        // posterior a multipart debe quedar dentro de la limpieza del archivo.
        if (tipo !== "IDENTIDAD" || !req.user || req.user.bloqueado)
          await new Promise((resolve, reject) =>
            verifyEmail(req, res, (error) =>
              error ? reject(error) : resolve(),
            ),
          );
        if (!["archivo", "file"].includes(file.fieldname))
          throw new HttpError(400, "Campo de archivo inválido.");
        const buffer = Buffer.alloc(32);
        const handle = await fs.promises.open(file.path, "r");
        try {
          await handle.read(buffer, 0, 32, 0);
        } finally {
          await handle.close();
        }
        if (!signature(buffer, file.mimetype))
          throw new HttpError(
            400,
            "El contenido no coincide con el tipo del archivo.",
          );
        if (file.mimetype.startsWith("video/"))
          require("../lib/media").videoDuration(
            await fs.promises.readFile(file.path),
            file.mimetype,
          );
        const privado = req.body.privado === "true" || tipo !== "PUBLICO";
        if (file.mimetype === "application/pdf" && !privado)
          throw new HttpError(400, "Los documentos PDF deben ser privados.");
        const fileId = path.basename(file.path);
        storedPath = await storage.save({
          id: fileId,
          userId: req.user.id,
          filePath: file.path,
          mimeType: file.mimetype,
        });
        const row = await db.attachment.create({
          data: {
            id: fileId,
            usuarioId: req.user.id,
            nombre: path.basename(file.originalname).slice(0, 150),
            mimeType: file.mimetype,
            size: file.size,
            path: storedPath,
            privado,
            tipo,
          },
        });
        registered = true;
        res.status(201).json(attachment(row));
      } catch (error) {
        if (storedPath && !registered)
          await storage.remove(storedPath).catch(() => {
            console.error("No se pudo limpiar un archivo sin registro.");
          });
        throw error;
      } finally {
        // Local files are durable; remote files use the disk only during validation.
        if (storedPath !== file.path)
          await fs.promises.unlink(file.path).catch(() => {});
      }
    }),
  );
  router.get(
    "/:id",
    authenticateOptional,
    asyncRoute(async (req, res) => {
      const row = await db.attachment.findUnique({
        where: { id: req.params.id },
        include: {
          reporte: {
            include: {
              incidente: true,
              usuario: { select: { correoVerificado: true } },
            },
          },
        },
      });
      if (!row) throw new HttpError(404, "Archivo no encontrado.");
      const owner = req.user?.id === row.usuarioId;
      const staff =
        req.user &&
        (row.tipo === "IDENTIDAD"
          ? req.user.rol === "ADMIN" && !req.user.bloqueado
          : row.reporte?.incidente &&
            canReview(req.user, row.reporte.incidente, "evidencia"));
      const privateFile = row.privado || row.tipo !== "PUBLICO";
      const publicAccess =
        !privateFile &&
        row.reporte?.incidente?.publicado &&
        row.reporte.usuario.correoVerificado;
      if (!owner && !staff && !publicAccess)
        throw new HttpError(403, "No puedes acceder a este archivo.");
      res.setHeader("Content-Type", row.mimeType);
      res.setHeader(
        "Cache-Control",
        publicAccess ? "public, max-age=300" : "private, no-store",
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        (row.mimeType === "application/pdf" ? "attachment" : "inline") +
          '; filename="' +
          row.nombre.replace(/[^a-zA-Z0-9._-]/g, "_") +
          '"',
      );
      await storage.send(row, req, res);
    }),
  );
  return router;
}
module.exports = createUploadRouter();
module.exports.createUploadRouter = createUploadRouter;
module.exports.signature = signature;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
