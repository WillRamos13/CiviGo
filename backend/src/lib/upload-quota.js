const { HttpError } = require("./http");
const MiB = 1024 * 1024;
function uploadLimits(env = process.env) {
  const value = (name, fallback, maximum) => {
    const parsed = Number(env[name]);
    return Number.isSafeInteger(parsed) && parsed > 0
      ? Math.min(parsed, maximum)
      : fallback;
  };
  return {
    bytes: value("UPLOAD_USER_LIMIT_MB", 500, 10000) * MiB,
    daily: value("UPLOAD_DAILY_LIMIT", 60, 1000),
    pending: value("UPLOAD_PENDING_LIMIT", 9, 30),
    identity: 2,
  };
}
async function serializable(db, work) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: "Serializable",
        maxWait: 10000,
        timeout: 30000,
      });
    } catch (error) {
      if (error.code !== "P2034" || attempt >= 3) throw error;
    }
  }
}
async function reserveUpload(
  db,
  data,
  now = new Date(),
  limits = uploadLimits(),
) {
  return serializable(db, async (tx) => {
    const day = now.toISOString().slice(0, 10);
    const counter = await tx.usageCounter.upsert({
      where: { clave: `uploads:${data.usuarioId}:${day}` },
      create: {
        clave: `uploads:${data.usuarioId}:${day}`,
        cantidad: 1,
        expiresAt: new Date(+now + 2 * 86400000),
      },
      update: { cantidad: { increment: 1 } },
    });
    const [usage, pending, identities] = await Promise.all([
      tx.attachment.aggregate({
        where: { usuarioId: data.usuarioId },
        _sum: { size: true },
      }),
      tx.attachment.count({
        where: {
          usuarioId: data.usuarioId,
          reporteId: null,
          estado: { not: "BORRANDO" },
          tipo: { not: "IDENTIDAD" },
          anuncio: { is: null },
        },
      }),
      tx.$queryRaw`SELECT COUNT(*)::int AS count FROM "Attachment" a
        WHERE a."usuarioId" = ${data.usuarioId} AND a.tipo = 'IDENTIDAD' AND a.estado <> 'BORRANDO'
        AND NOT EXISTS (SELECT 1 FROM "Recovery" r WHERE r."adjuntoId" = a.id)`,
    ]);
    if (
      (usage._sum.size || 0) + data.size > limits.bytes ||
      counter.cantidad > limits.daily ||
      (data.tipo === "IDENTIDAD"
        ? identities[0].count >= limits.identity
        : pending >= limits.pending)
    )
      throw new HttpError(
        429,
        "Alcanzaste el límite de archivos. Completa tus reportes pendientes o elimina los adjuntos que no utilizarás.",
        "UPLOAD_QUOTA",
      );
    return tx.attachment.create({ data: { ...data, estado: "RESERVADO" } });
  });
}
// Claim in SQL before removing bytes. Report/recovery association uses a
// serializable transaction too, so a concurrent association cannot be deleted.
async function claimOrphan(db, id, before, userId) {
  return serializable(db, async (tx) => {
    const row = await tx.attachment.findUnique({ where: { id }, include: { anuncio: { select: { id: true } } } });
    if (
      !row ||
      row.reporteId ||
      row.anuncio ||
      (userId !== undefined && row.usuarioId !== userId) ||
      (before && row.creadoEn >= before)
    )
      return null;
    if (await tx.recovery.findFirst({ where: { adjuntoId: id } })) return null;
    await tx.attachment.update({ where: { id }, data: { estado: "BORRANDO" } });
    return row;
  });
}
async function removeClaimed(db, storage, row) {
  if (!row.path.startsWith("pending:")) await storage.remove(row.path);
  await db.attachment.deleteMany({
    where: { id: row.id, estado: "BORRANDO", reporteId: null },
  });
}
async function cleanupUploads(db, storage, now = new Date()) {
  const before = new Date(+now - 86400000);
  // Exclude associated recovery evidence in SQL, so old retained documents
  // cannot occupy every batch and indefinitely starve abandoned drafts.
  const candidates = await db.$queryRaw`SELECT a.* FROM "Attachment" a
    WHERE a."reporteId" IS NULL AND (a."creadoEn" < ${before} OR a.estado = 'BORRANDO')
    AND NOT EXISTS (SELECT 1 FROM "Recovery" r WHERE r."adjuntoId" = a.id)
    AND NOT EXISTS (SELECT 1 FROM "MapAnnouncement" m WHERE m."imagenId" = a.id)
    ORDER BY a."creadoEn" ASC LIMIT 100`;
  let removed = 0;
  for (const candidate of candidates) {
    try {
      const row = await claimOrphan(
        db,
        candidate.id,
        candidate.estado === "BORRANDO" ? null : before,
      );
      if (row) {
        await removeClaimed(db, storage, row);
        removed++;
      }
    } catch {
      console.warn(
        "[Archivos] Limpieza pendiente; se reintentará sin borrar evidencias asociadas.",
      );
    }
  }
  return removed;
}
module.exports = {
  uploadLimits,
  reserveUpload,
  claimOrphan,
  removeClaimed,
  cleanupUploads,
  serializable,
};
