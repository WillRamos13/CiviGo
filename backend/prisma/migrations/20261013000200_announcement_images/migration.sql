-- Existing text announcements remain intact; images use the authorized upload store.
ALTER TABLE "MapAnnouncement" ADD COLUMN "imagenId" TEXT;
ALTER TABLE "MapAnnouncement" ADD COLUMN "imagenAlt" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "MapAnnouncement_imagenId_key" ON "MapAnnouncement"("imagenId");
ALTER TABLE "MapAnnouncement" ADD CONSTRAINT "MapAnnouncement_imagenId_fkey"
  FOREIGN KEY ("imagenId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
