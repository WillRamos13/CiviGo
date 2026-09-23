-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "incidenteId" INTEGER,
ALTER COLUMN "estado" SET DEFAULT 'Reportado';

-- CreateTable
CREATE TABLE "Incident" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "latitud" DOUBLE PRECISION NOT NULL,
    "longitud" DOUBLE PRECISION NOT NULL,
    "nivelRiesgo" INTEGER NOT NULL DEFAULT 1,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "totalReportes" INTEGER NOT NULL DEFAULT 1,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_incidenteId_fkey" FOREIGN KEY ("incidenteId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
