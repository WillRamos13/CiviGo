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
const { config } = require('../lib/catalog');
const { reserveUpload, claimOrphan, removeClaimed } = require('../lib/upload-quota');
const { IMAGE_MIMES, MAX_ANNOUNCEMENT_IMAGE } = require('../lib/announcements');
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
  getConfig = () => config(db),
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
      let reservedId;
      let reservedPath;
      try {
        const tipo = ["EVIDENCIA", "IDENTIDAD", "ANUNCIO"].includes(req.body.tipo)
          ? req.body.tipo
          : "PUBLICO";
        if (tipo === 'ANUNCIO') {
          if (req.user.rol !== 'ADMIN' || req.user.bloqueado) throw new HttpError(403, 'Solo administradores pueden cargar imágenes publicitarias.');
          if (!IMAGE_MIMES.has(file.mimetype) || req.body.privado === 'true') throw new HttpError(400, 'La publicidad admite imágenes JPEG, PNG, WebP o GIF.');
          if (file.size > MAX_ANNOUNCEMENT_IMAGE) throw new HttpError(413, 'La imagen publicitaria debe pesar como máximo 5 MB.', 'FILE_TOO_LARGE');
        }
        // La identidad privada permite pedir recuperación. La autorización
        // posterior a multipart debe quedar dentro de la limpieza del archivo.
        if (tipo !== 'ANUNCIO' && (tipo !== "IDENTIDAD" || !req.user || req.user.bloqueado))
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
        if (file.mimetype.startsWith("video/")) {
          const rules = await getConfig();
          if (file.size > Math.min(MAX_FILE_SIZE, rules.maxVideoBytes))
            throw new HttpError(413, `El video supera el límite de ${Math.round(rules.maxVideoBytes / 1048576)} MB.`, 'FILE_TOO_LARGE');
          require("../lib/media").videoDuration(
            await fs.promises.readFile(file.path),
            file.mimetype,
          );
        }
        const privado = req.body.privado === "true" || !['PUBLICO', 'ANUNCIO'].includes(tipo);
        if (file.mimetype === "application/pdf" && !privado)
          throw new HttpError(400, "Los documentos PDF deben ser privados.");
        const fileId = path.basename(file.path);
        reservedPath = storage.targetPath({ id: fileId, userId: req.user.id, filePath: file.path });
        await reserveUpload(db, { id: fileId, usuarioId: req.user.id,
          nombre: path.basename(file.originalname).slice(0, 150), mimeType: file.mimetype,
          size: file.size, path: reservedPath, privado, tipo });
        reservedId = fileId;
        storedPath = await storage.save({
          id: fileId,
          userId: req.user.id,
          filePath: file.path,
          mimeType: file.mimetype,
        });
        const row = await db.attachment.update({
          where: { id: fileId, estado: 'RESERVADO' },
          data: {
            path: storedPath,
            estado: 'LISTO',
          },
        });
        registered = true;
        res.status(201).json(attachment(row));
      } catch (error) {
        if (reservedId && !registered) {
          try {
            // The exact object path is reserved before storage I/O. Even if
            // the process dies or upload response is lost, cleanup can find it.
            if (!['STORAGE_CONFIG', 'STORAGE_PRIVATE_BUCKET_REQUIRED'].includes(error.code)) await storage.remove(reservedPath);
            await db.attachment.deleteMany({ where: { id: reservedId, estado: 'RESERVADO' } });
          } catch {
            await db.attachment.updateMany({ where: { id: reservedId, estado: 'RESERVADO' }, data: { estado: 'BORRANDO' } }).catch(() => {});
            console.warn('[Archivos] Limpieza pendiente; se reintentará.');
          }
        }
        throw error;
      } finally {
        // Local files are durable; remote files use the disk only during validation.
        if (storedPath !== file.path)
          await fs.promises.unlink(file.path).catch(() => {});
      }
    }),
  );
  router.delete('/:id', authenticate, asyncRoute(async (req, res) => {
    const row = await claimOrphan(db, req.params.id, null, req.user.id);
    if (!row) throw new HttpError(409, 'Este archivo no existe o ya está asociado a una solicitud o reporte.');
    await removeClaimed(db, storage, row);
    res.json({ eliminado: true });
  }));
  router.get(
    "/:id",
    authenticateOptional,
    asyncRoute(async (req, res) => {
      const row = await db.attachment.findUnique({
        where: { id: req.params.id },
        include: {
          anuncio: { select: { id: true } },
          reporte: {
            include: {
              incidente: true,
              usuario: { select: { correoVerificado: true } },
            },
          },
        },
      });
      if (!row || row.estado !== 'LISTO') throw new HttpError(404, "Archivo no encontrado.");
      const owner = req.user?.id === row.usuarioId;
      const staff =
        req.user &&
        (row.tipo === "IDENTIDAD"
          ? req.user.rol === "ADMIN" && !req.user.bloqueado
          : (row.anuncio && req.user.rol === 'ADMIN' && !req.user.bloqueado) || (row.reporte?.incidente &&
            canReview(req.user, row.reporte.incidente, "evidencia")));
      const privateFile = row.privado || row.tipo !== "PUBLICO";
      const publicAccess =
        !privateFile &&
        row.reporte?.incidente?.publicado &&
        !['EN_REVISION', 'FALSO', 'RETIRADO'].includes(row.reporte.estado) &&
        row.reporte.usuario.correoVerificado;
      if (!owner && !staff && !publicAccess)
        throw new HttpError(403, "No puedes acceder a este archivo.");
      res.setHeader("Content-Type", row.mimeType);
      res.setHeader(
        "Cache-Control",
        "private, no-store",
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
