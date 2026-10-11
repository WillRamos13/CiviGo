ALTER TABLE "Attachment" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'LISTO';
CREATE INDEX "Attachment_usuarioId_creadoEn_idx" ON "Attachment"("usuarioId", "creadoEn");
CREATE INDEX "Attachment_estado_reporteId_creadoEn_idx" ON "Attachment"("estado", "reporteId", "creadoEn");
CREATE TABLE "UsageCounter" ("clave" TEXT PRIMARY KEY, "cantidad" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "UsageCounter_expiresAt_idx" ON "UsageCounter"("expiresAt");
CREATE INDEX "Recovery_adjuntoId_idx" ON "Recovery"("adjuntoId");
