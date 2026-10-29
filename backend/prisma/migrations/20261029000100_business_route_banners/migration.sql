ALTER TABLE "MapAnnouncement" DROP CONSTRAINT "MapAnnouncement_ubicacion_check";
ALTER TABLE "MapAnnouncement" ADD CONSTRAINT "MapAnnouncement_ubicacion_check"
  CHECK ("ubicacion" IN ('CABECERA', 'REPORTAR', 'RUTA'));
ALTER TABLE "MapAnnouncement" ADD CONSTRAINT "MapAnnouncement_ruta_check"
  CHECK ("ubicacion" <> 'RUTA' OR ("tipo" = 'NEGOCIO' AND "negocioId" IS NOT NULL));

CREATE UNIQUE INDEX "MapAnnouncement_negocio_ruta_unique" ON "MapAnnouncement" ("negocioId") WHERE "ubicacion" = 'RUTA';
