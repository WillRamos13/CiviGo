ALTER TABLE "MapAnnouncement" ADD COLUMN "ubicacion" TEXT NOT NULL DEFAULT 'CABECERA';
ALTER TABLE "MapAnnouncement" ADD CONSTRAINT "MapAnnouncement_ubicacion_check" CHECK ("ubicacion" IN ('CABECERA', 'REPORTAR'));
CREATE INDEX "MapAnnouncement_ubicacion_activo_orden_idx" ON "MapAnnouncement"("ubicacion", "activo", "orden");
