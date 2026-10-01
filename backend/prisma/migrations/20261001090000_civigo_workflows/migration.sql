-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "gpsLatitud" DOUBLE PRECISION,
ADD COLUMN     "gpsLongitud" DOUBLE PRECISION,
ADD COLUMN     "recordatorioEnviado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipoId" INTEGER,
ALTER COLUMN "nivelRiesgo" DROP NOT NULL,
ALTER COLUMN "nivelRiesgo" DROP DEFAULT,
ALTER COLUMN "estado" SET DEFAULT 'PENDIENTE';

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "descripcion" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "distrito" TEXT,
ADD COLUMN     "emergencia" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "evaluacion" TEXT NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "fechaActualizacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "fechaEvento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "fuente" TEXT NOT NULL DEFAULT 'CIUDADANO',
ADD COLUMN     "historico" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "individual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "motivoRetiro" TEXT,
ADD COLUMN     "persistente" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipoId" INTEGER,
ADD COLUMN     "validacion" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ALTER COLUMN "nivelRiesgo" DROP NOT NULL,
ALTER COLUMN "nivelRiesgo" DROP DEFAULT,
ALTER COLUMN "estado" SET DEFAULT 'PENDIENTE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "apellidos" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bloqueado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "correoVerificado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "distrito" TEXT,
ADD COLUMN     "faltas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     IF NOT EXISTS "fechaNacimiento" TIMESTAMP(3),
ADD COLUMN     "monedas" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "nombres" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ocultarAnuncios" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "permisos" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "premium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telefonoVerificado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipoAgente" TEXT,
ALTER COLUMN "reputacion" DROP NOT NULL,
ALTER COLUMN "reputacion" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentType" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "categoriaId" INTEGER NOT NULL,
    "emergencia" BOOLEAN NOT NULL DEFAULT false,
    "historico" BOOLEAN NOT NULL DEFAULT false,
    "fotoObligatoria" BOOLEAN NOT NULL DEFAULT true,
    "individual" BOOLEAN NOT NULL DEFAULT false,
    "ubicacionRemota" BOOLEAN NOT NULL DEFAULT false,
    "persistente" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "IncidentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "reporteId" INTEGER,
    "nombre" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "privado" BOOLEAN NOT NULL DEFAULT false,
    "tipo" TEXT NOT NULL DEFAULT 'PUBLICO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "incidenteId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "latitud" DOUBLE PRECISION NOT NULL,
    "longitud" DOUBLE PRECISION NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "incidenteId" INTEGER NOT NULL,
    "mensaje" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'INFO',
    "incidenteId" INTEGER,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "incidenteId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "incidenteId" INTEGER NOT NULL,
    "accion" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "reporteId" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "respuesta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recovery" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "telefonoNuevo" TEXT NOT NULL,
    "adjuntoId" TEXT,
    "motivo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointEvent" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "clave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "puntos" DOUBLE PRECISION NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSettlement" (
    "id" TEXT NOT NULL,
    "datos" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "costoMonedas" DOUBLE PRECISION NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "demo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "recompensaId" INTEGER NOT NULL,
    "costoMonedas" DOUBLE PRECISION NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'SOLICITADO_DEMO',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "horario" TEXT NOT NULL DEFAULT '',
    "sitioWeb" TEXT,
    "telefono" TEXT,
    "latitud" DOUBLE PRECISION NOT NULL,
    "longitud" DOUBLE PRECISION NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "demo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdImpression" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "negocioId" INTEGER NOT NULL,
    "recorridoId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdImpression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteFavorite" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "origen" JSONB NOT NULL,
    "destino" JSONB NOT NULL,
    "datos" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteHistory" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "modo" TEXT NOT NULL,
    "origen" JSONB NOT NULL,
    "destino" JSONB NOT NULL,
    "datos" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE INDEX "Session_usuarioId_idx" ON "Session"("usuarioId");

-- CreateIndex
CREATE INDEX "Verification_usuarioId_tipo_idx" ON "Verification"("usuarioId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentType_slug_key" ON "IncidentType"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_usuarioId_incidenteId_tipo_key" ON "Vote"("usuarioId", "incidenteId", "tipo");

-- CreateIndex
CREATE INDEX "ChatMessage_incidenteId_creadoEn_idx" ON "ChatMessage"("incidenteId", "creadoEn");

-- CreateIndex
CREATE INDEX "Notification_usuarioId_creadoEn_idx" ON "Notification"("usuarioId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "Flag_usuarioId_incidenteId_tipo_key" ON "Flag"("usuarioId", "incidenteId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "PointEvent_clave_key" ON "PointEvent"("clave");

-- CreateIndex
CREATE INDEX "PointEvent_usuarioId_creadoEn_idx" ON "PointEvent"("usuarioId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "AdImpression_usuarioId_negocioId_recorridoId_key" ON "AdImpression"("usuarioId", "negocioId", "recorridoId");

-- CreateIndex
CREATE INDEX "Report_usuarioId_fechaCreacion_idx" ON "Report"("usuarioId", "fechaCreacion");

-- CreateIndex
CREATE INDEX "Incident_publicado_estado_fechaCreacion_idx" ON "Incident"("publicado", "estado", "fechaCreacion");

-- CreateIndex
CREATE INDEX "Incident_tipoId_fechaCreacion_idx" ON "Incident"("tipoId", "fechaCreacion");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentType" ADD CONSTRAINT "IncidentType_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_tipoId_fkey" FOREIGN KEY ("tipoId") REFERENCES "IncidentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_tipoId_fkey" FOREIGN KEY ("tipoId") REFERENCES "IncidentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_reporteId_fkey" FOREIGN KEY ("reporteId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_incidenteId_fkey" FOREIGN KEY ("incidenteId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_incidenteId_fkey" FOREIGN KEY ("incidenteId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_incidenteId_fkey" FOREIGN KEY ("incidenteId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_incidenteId_fkey" FOREIGN KEY ("incidenteId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_reporteId_fkey" FOREIGN KEY ("reporteId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recovery" ADD CONSTRAINT "Recovery_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointEvent" ADD CONSTRAINT "PointEvent_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_recompensaId_fkey" FOREIGN KEY ("recompensaId") REFERENCES "Reward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdImpression" ADD CONSTRAINT "AdImpression_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteFavorite" ADD CONSTRAINT "RouteFavorite_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteHistory" ADD CONSTRAINT "RouteHistory_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
