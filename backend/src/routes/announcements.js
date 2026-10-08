const express = require("express");
const prisma = require("../lib/db");
const { auth, optionalAuth } = require("../lib/auth");
const { asyncRoute, HttpError, id } = require("../lib/http");
const {
  announcementData,
  publicAnnouncement,
  trafficModerationData,
} = require("../lib/announcements");
const router = express.Router();
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const administrator = [
  auth,
  (req, res, next) =>
    req.user.rol === "ADMIN"
      ? next()
      : next(new HttpError(403, "Solo administradores.")),
];

async function audit(db, user, accion, entidad, entidadId, datos) {
  await db.auditLog.create({
    data: {
      usuarioId: user.id,
      accion,
      entidad,
      entidadId: String(entidadId),
      datos,
    },
  });
}
async function businessExists(db, data) {
  if (
    data.negocioId &&
    !(await db.business.findUnique({ where: { id: data.negocioId } }))
  )
    throw new HttpError(400, "El negocio no existe.");
}

router.get(
  "/",
  optionalAuth,
  asyncRoute(async (req, res) => {
    const now = new Date();
    const hideAds = req.user?.premium && req.user?.ocultarAnuncios;
    const rows = await prisma.mapAnnouncement.findMany({
      where: {
        activo: true,
        AND: [
          { OR: [{ inicio: null }, { inicio: { lte: now } }] },
          { OR: [{ fin: null }, { fin: { gt: now } }] },
          hideAds
            ? { tipo: "NOVEDAD" }
            : {
                OR: [
                  { tipo: "NOVEDAD" },
                  { tipo: "NEGOCIO", negocio: { is: { activo: true } } },
                ],
              },
        ],
      },
      include: { negocio: true },
      orderBy: [{ orden: "asc" }, { id: "asc" }],
      take: 100,
    });
    res.json(rows.map(publicAnnouncement));
  }),
);

router.get(
  "/manage",
  ...administrator,
  asyncRoute(async (req, res) => {
    res.json(
      await prisma.mapAnnouncement.findMany({
        include: { negocio: true },
        orderBy: [{ orden: "asc" }, { id: "asc" }],
        take: 500,
      }),
    );
  }),
);
router.post(
  "/manage",
  ...administrator,
  asyncRoute(async (req, res) => {
    const data = announcementData(req.body);
    const row = await prisma.$transaction(async (db) => {
      await businessExists(db, data);
      const created = await db.mapAnnouncement.create({
        data,
        include: { negocio: true },
      });
      await audit(db, req.user, "CREAR", "ANUNCIO_MAPA", created.id, {
        tipo: data.tipo,
        titulo: data.titulo,
        activo: data.activo,
        orden: data.orden,
        inicio: data.inicio?.toISOString() ?? null,
        fin: data.fin?.toISOString() ?? null,
      });
      return created;
    });
    res.status(201).json(row);
  }),
);
router.patch(
  "/manage/:id",
  ...administrator,
  asyncRoute(async (req, res) => {
    const row = await prisma.$transaction(async (db) => {
      const previous = await db.mapAnnouncement.findUnique({
        where: { id: id(req.params.id) },
      });
      if (!previous) throw new HttpError(404, "Anuncio no encontrado.");
      const data = announcementData(req.body, previous);
      await businessExists(db, data);
      const updated = await db.mapAnnouncement.update({
        where: { id: previous.id },
        data,
        include: { negocio: true },
      });
      await audit(db, req.user, "ACTUALIZAR", "ANUNCIO_MAPA", updated.id, {
        tipo: data.tipo,
        titulo: data.titulo,
        activo: data.activo,
        orden: data.orden,
        inicio: data.inicio?.toISOString() ?? null,
        fin: data.fin?.toISOString() ?? null,
      });
      return updated;
    });
    res.json(row);
  }),
);
router.delete(
  "/manage/:id",
  ...administrator,
  asyncRoute(async (req, res) => {
    await prisma.$transaction(async (db) => {
      const previous = await db.mapAnnouncement.findUnique({
        where: { id: id(req.params.id) },
      });
      if (!previous) throw new HttpError(404, "Anuncio no encontrado.");
      await db.mapAnnouncement.delete({ where: { id: previous.id } });
      await audit(db, req.user, "ELIMINAR", "ANUNCIO_MAPA", previous.id, {
        titulo: previous.titulo,
        tipo: previous.tipo,
      });
    });
    res.json({ eliminado: true });
  }),
);

router.get(
  "/traffic-moderation",
  ...administrator,
  asyncRoute(async (req, res) => {
    res.json(
      await prisma.externalTrafficModeration.findMany({
        where: { proveedor: "TOMTOM" },
        orderBy: { actualizadoEn: "desc" },
        take: 500,
      }),
    );
  }),
);
router.post(
  "/traffic-moderation",
  ...administrator,
  asyncRoute(async (req, res) => {
    const data = trafficModerationData(req.body);
    const row = await prisma.$transaction(async (db) => {
      const saved = await db.externalTrafficModeration.upsert({
        where: {
          proveedor_externoId: {
            proveedor: data.proveedor,
            externoId: data.externoId,
          },
        },
        create: { ...data, usuarioId: req.user.id },
        update: { ...data, usuarioId: req.user.id },
      });
      await audit(
        db,
        req.user,
        data.oculto ? "OCULTAR" : "RESTAURAR",
        "AVISO_TOMTOM",
        data.externoId,
        { motivo: data.motivo, proveedor: "TOMTOM", oculto: data.oculto },
      );
      return saved;
    });
    res.json(row);
  }),
);
module.exports = router;
