const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { createStorage, UPLOAD_DIR } = require("./storage");
const campaigns = [
  {
    titulo: "Participa, suma puntos y descubre recompensas",
    mensaje:
      "Tus aportes validados suman puntos. Participa en el ranking y canjea tus monedas.",
    ubicacion: "CABECERA",
    archivo: "rewards-header.webp",
    enlace: "/registro",
  },
  {
    titulo: "Tu aporte cuenta en Ica",
    mensaje:
      "Reporta lo que pasa cerca de ti. Revisa tu participación y descubre el catálogo de recompensas.",
    ubicacion: "REPORTAR",
    archivo: "rewards-portrait.webp",
    enlace: "/recompensas",
  },
];
async function seedCampaigns(db, storage = createStorage()) {
  if (
    (await db.appConfig.findUnique({ where: { clave: "campaigns:v1" } }))?.valor
      ?.preparado
  )
    return 0;
  const owner = await db.user.findFirst({
    where: { rol: "ADMIN", bloqueado: false },
    select: { id: true },
  });
  if (!owner) return 0;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  let count = 0;
  for (const item of campaigns) {
    if (
      await db.mapAnnouncement.findFirst({
        where: { titulo: item.titulo, ubicacion: item.ubicacion },
      })
    )
      continue;
    const id = randomUUID(),
      file = path.join(UPLOAD_DIR, id),
      source = path.join(__dirname, "../../assets/banners", item.archivo);
    await fs.copyFile(source, file);
    let stored;
    try {
      stored = await storage.save({
        id,
        userId: owner.id,
        filePath: file,
        mimeType: "image/webp",
      });
      const size = (await fs.stat(file)).size;
      await db.$transaction(async (tx) => {
        await tx.attachment.create({
          data: {
            id,
            usuarioId: owner.id,
            nombre: item.archivo,
            mimeType: "image/webp",
            size,
            path: stored,
            privado: false,
            tipo: "ANUNCIO",
          },
        });
        await tx.mapAnnouncement.create({
          data: {
            titulo: item.titulo,
            mensaje: item.mensaje,
            ubicacion: item.ubicacion,
            enlace: item.enlace,
            tipo: "NOVEDAD",
            activo: true,
            orden: 10,
            imagenId: id,
            imagenAlt: item.titulo,
          },
        });
      });
      count++;
    } catch (error) {
      if (stored) await storage.remove(stored).catch(() => {});
      throw error;
    } finally {
      if (stored?.startsWith("supabase://"))
        await fs.unlink(file).catch(() => {});
    }
  }
  await db.appConfig.upsert({
    where: { clave: "campaigns:v1" },
    create: { clave: "campaigns:v1", valor: { preparado: true } },
    update: { valor: { preparado: true } },
  });
  return count;
}
module.exports = { campaigns, seedCampaigns };
