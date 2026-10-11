ALTER TABLE "Report" ADD COLUMN "sancionAplicada" BOOLEAN NOT NULL DEFAULT false;

-- Las decisiones antiguas sancionaban una vez por autor e incidente.
-- Conserva ese hecho sin volver a incrementar faltas al migrar.
UPDATE "Report" SET "sancionAplicada" = true
WHERE id IN (
  SELECT MIN(id) FROM "Report" WHERE estado = 'FALSO'
  GROUP BY "usuarioId", COALESCE("incidenteId", -id)
);
