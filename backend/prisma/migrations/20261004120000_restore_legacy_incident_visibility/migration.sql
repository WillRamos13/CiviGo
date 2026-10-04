-- El prototipo mostraba los incidentes ACTIVO antes de tener `publicado`.
-- La migración de workflows añadió ese campo con DEFAULT false y las fechas
-- nuevas con CURRENT_TIMESTAMP, ocultando esos registros existentes.
-- Solo recuperamos registros reconocibles de aquel ALTER TABLE: anteriores
-- a la migración, con fechaEvento dentro de su ejecución y sin revisión.
-- No se aprueban reportes nuevos ni se altera su evaluación o confianza.
DO $$
BEGIN
IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
WITH workflow AS (
    SELECT
        CAST(started_at AT TIME ZONE 'UTC' AS TIMESTAMP(3)) AS inicio,
        CAST(finished_at AT TIME ZONE 'UTC' AS TIMESTAMP(3)) AS fin
    FROM "_prisma_migrations"
    WHERE migration_name = '20261001090000_civigo_workflows'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    ORDER BY finished_at DESC
    LIMIT 1
), restored AS (
    UPDATE "Incident" AS i
    SET "publicado" = true,
        "fechaPublicacion" = i."fechaCreacion",
        "fechaEvento" = i."fechaCreacion"
    FROM workflow AS w
    WHERE i."publicado" = false
      AND i."estado" = 'ACTIVO'
      AND i."evaluacion" = 'PENDIENTE'
      AND i."fuente" = 'CIUDADANO'
      AND i."fechaPublicacion" IS NULL
      AND i."motivoRetiro" IS NULL
      AND i."fechaCreacion" < w.inicio
      AND i."fechaEvento" BETWEEN w.inicio AND w.fin
      AND NOT EXISTS (
          SELECT 1 FROM "Review" AS r WHERE r."incidenteId" = i.id
      )
    RETURNING i.id
)
INSERT INTO "AuditLog" ("accion", "entidad", "entidadId", "datos", "creadoEn")
SELECT 'RESTAURAR_VISIBILIDAD_LEGACY', 'INCIDENTE', id::text,
       jsonb_build_object(
           'migracion', '20261004120000_restore_legacy_incident_visibility',
           'evaluacion', 'PENDIENTE'
       ), CURRENT_TIMESTAMP
FROM restored;
END IF;
END $$;
