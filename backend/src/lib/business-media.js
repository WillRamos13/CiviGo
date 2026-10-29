const {
  announcementImageId,
  validateAnnouncementImage,
  IMAGE_SELECT,
  publicAnnouncement,
  announcementIsVisible,
} = require("./announcements");
const { HttpError } = require("./http");
const mediaInclude = {
  anunciosMapa: {
    where: { ubicacion: "RUTA" },
    include: { imagen: { select: IMAGE_SELECT } },
    orderBy: { id: "desc" },
    take: 1,
  },
};
function presentBusiness(row, { admin = false } = {}) {
  const { anunciosMapa, ...business } = row,
    ad = anunciosMapa?.[0];
  const visible = ad && announcementIsVisible({ ...ad, negocio: row });
  return {
    ...business,
    banner: visible ? publicAnnouncement({ ...ad, negocio: row }).imagen : null,
    ...(admin
      ? {
          imagenId: ad?.imagenId || null,
          imagenAlt: ad?.imagenAlt || "",
          bannerId: ad?.id || null,
        }
      : {}),
  };
}
async function saveBusinessBanner(tx, business, input, userId) {
  if (input.imagenId === undefined) return;
  const previous = await tx.mapAnnouncement.findFirst({
    where: { negocioId: business.id, ubicacion: "RUTA" },
  });
  const imagenId = announcementImageId(input.imagenId);
  if (!imagenId) {
    if (previous)
      await tx.mapAnnouncement.delete({ where: { id: previous.id } });
    return;
  }
  await validateAnnouncementImage(tx, { imagenId }, userId, previous || {});
  const alt = String(input.imagenAlt || business.nombre).trim();
  if (alt.length > 250 || /[<>]/.test(alt))
    throw new HttpError(400, "Descripción del banner inválida.");
  const data = {
    tipo: "NEGOCIO",
    ubicacion: "RUTA",
    titulo: business.nombre,
    mensaje: business.descripcion,
    negocioId: business.id,
    imagenId,
    imagenAlt: alt,
    activo: true,
    orden: 0,
  };
  if (previous)
    await tx.mapAnnouncement.update({ where: { id: previous.id }, data });
  else await tx.mapAnnouncement.create({ data });
}
module.exports = { mediaInclude, presentBusiness, saveBusinessBanner };
