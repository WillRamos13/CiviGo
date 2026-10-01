ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "fechaPublicacion" TIMESTAMP(3);

-- Conserva el inicio del plazo de publicaciones existentes; los reportes
-- pendientes aún no publicados comenzarán al publicarse por primera vez.
UPDATE "Incident"
SET "fechaPublicacion" = "fechaCreacion"
WHERE "publicado" = true AND "fechaPublicacion" IS NULL;
