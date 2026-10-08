CREATE TABLE "MapAnnouncement" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'NOVEDAD',
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL DEFAULT '',
    "enlace" TEXT,
    "negocioId" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "inicio" TIMESTAMP(3),
    "fin" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MapAnnouncement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MapAnnouncement_tipo_check" CHECK ("tipo" IN ('NOVEDAD', 'NEGOCIO')),
    CONSTRAINT "MapAnnouncement_negocio_check" CHECK (("tipo" = 'NEGOCIO' AND "negocioId" IS NOT NULL AND "enlace" IS NULL) OR ("tipo" = 'NOVEDAD' AND "negocioId" IS NULL)),
    CONSTRAINT "MapAnnouncement_fechas_check" CHECK ("inicio" IS NULL OR "fin" IS NULL OR "fin" > "inicio")
);
CREATE INDEX "MapAnnouncement_activo_orden_idx" ON "MapAnnouncement"("activo", "orden");
ALTER TABLE "MapAnnouncement" ADD CONSTRAINT "MapAnnouncement_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ExternalTrafficModeration" (
    "id" SERIAL NOT NULL,
    "proveedor" TEXT NOT NULL DEFAULT 'TOMTOM',
    "externoId" TEXT NOT NULL,
    "oculto" BOOLEAN NOT NULL DEFAULT true,
    "motivo" TEXT NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalTrafficModeration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExternalTrafficModeration_proveedor_externoId_key" ON "ExternalTrafficModeration"("proveedor", "externoId");
CREATE INDEX "ExternalTrafficModeration_proveedor_oculto_idx" ON "ExternalTrafficModeration"("proveedor", "oculto");

CREATE TABLE "ExternalApiUsage" (
    "id" SERIAL NOT NULL,
    "proveedor" TEXT NOT NULL,
    "producto" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "usadas" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalApiUsage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExternalApiUsage_usadas_check" CHECK ("usadas" >= 0)
);
CREATE UNIQUE INDEX "ExternalApiUsage_proveedor_producto_mes_key" ON "ExternalApiUsage"("proveedor", "producto", "mes");
