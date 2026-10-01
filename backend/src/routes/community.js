const express = require("express");
const prisma = require("../lib/db");
const { auth, requirePhone } = require("../lib/auth");
const {
  asyncRoute,
  HttpError,
  id,
  text,
  coordinates,
  distance,
} = require("../lib/http");
const { transaction } = require("../lib/workflows");
const { ranking } = require("../lib/ranking");
const router = express.Router();
router.get(
  "/ranking",
  asyncRoute(async (req, res) => {
    const result = await ranking(req.query.mes);
    res.json({
      ...result,
      entries: result.entries.map(({ usuarioId, ...entry }) => entry),
    });
  }),
);
router.get(
  "/notifications",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await prisma.notification.findMany({
        where: { usuarioId: req.user.id },
        orderBy: { creadoEn: "desc" },
        take: 100,
      }),
    ),
  ),
);
router.put(
  "/notifications/:id/read",
  auth,
  asyncRoute(async (req, res) => {
    const changed = await prisma.notification.updateMany({
      where: { id: id(req.params.id), usuarioId: req.user.id },
      data: { leida: true },
    });
    if (!changed.count) throw new HttpError(404, "Notificación no encontrada.");
    res.json({ leida: true });
  }),
);
router.get(
  "/recompensas",
  auth,
  asyncRoute(async (req, res) => {
    const [recompensas, canjes, u] = await Promise.all([
      prisma.reward.findMany({
        where: { activo: true },
        orderBy: { costoMonedas: "asc" },
      }),
      prisma.redemption.findMany({
        where: { usuarioId: req.user.id },
        include: { recompensa: true },
        orderBy: { creadoEn: "desc" },
      }),
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { monedas: true },
      }),
    ]);
    res.json({ monedas: u.monedas, recompensas, canjes, demo: true });
  }),
);
router.post(
  "/recompensas/:id/canjear",
  auth,
  requirePhone,
  asyncRoute(async (req, res) => {
    const result = await transaction(async (db) => {
      const reward = await db.reward.findUnique({
        where: { id: id(req.params.id) },
      });
      if (!reward || !reward.activo || reward.stock <= 0)
        throw new HttpError(409, "Recompensa sin disponibilidad.");
      const user = await db.user.updateMany({
        where: { id: req.user.id, monedas: { gte: reward.costoMonedas } },
        data: { monedas: { decrement: reward.costoMonedas } },
      });
      if (!user.count)
        throw new HttpError(409, "No tienes suficientes monedas.");
      const stock = await db.reward.updateMany({
        where: { id: reward.id, stock: { gt: 0 } },
        data: { stock: { decrement: 1 } },
      });
      if (!stock.count) throw new HttpError(409, "No queda stock.");
      return db.redemption.create({
        data: {
          usuarioId: req.user.id,
          recompensaId: reward.id,
          costoMonedas: reward.costoMonedas,
          estado: "SOLICITADO_DEMO",
        },
        include: { recompensa: true },
      });
    });
    res.status(201).json(result);
  }),
);
router.get(
  "/businesses",
  asyncRoute(async (req, res) =>
    res.json(
      await prisma.business.findMany({
        where: { activo: true },
        orderBy: { nombre: "asc" },
      }),
    ),
  ),
);
router.post(
  "/businesses/:id/impressions",
  auth,
  asyncRoute(async (req, res) => {
    const b = await prisma.business.findUnique({
      where: { id: id(req.params.id) },
    });
    if (!b || !b.activo) throw new HttpError(404, "Negocio no disponible.");
    if (req.user.premium && req.user.ocultarAnuncios)
      throw new HttpError(409, "Las recomendaciones están desactivadas.");
    const p = coordinates(req.body.latitud, req.body.longitud);
    const rules = await require("../lib/catalog").config();
    if (distance(p, b) > rules.anuncioMetros)
      throw new HttpError(400, "La tarjeta solo se activa cerca del negocio.");
    const recorridoId = text(req.body.recorridoId, "Recorrido", 100);
    const row = await prisma.adImpression.upsert({
      where: {
        usuarioId_negocioId_recorridoId: {
          usuarioId: req.user.id,
          negocioId: b.id,
          recorridoId,
        },
      },
      update: {},
      create: { usuarioId: req.user.id, negocioId: b.id, recorridoId },
    });
    res.json({ id: row.id, registrada: true, demo: true });
  }),
);
router.post(
  "/chatbot",
  asyncRoute(async (req, res) => {
    const message = text(
      req.body.mensaje || req.body.message,
      "Mensaje",
      1000,
    ).toLowerCase();
    let respuesta =
      "Puedo explicar cómo reportar, validar incidentes, consultar rutas, reputación y Premium. ¿Sobre qué parte de CiviGo necesitas ayuda?";
    if (/report|incidente/.test(message))
      respuesta =
        "En Reportar, selecciona una categoría y un tipo, confirma la ubicación y adjunta hasta tres archivos. Necesitas teléfono verificado. Robo, hurto, intento de robo, amenazas y extorsión se validan con pruebas privadas y no se agrupan.";
    if (/confirm|valid/.test(message))
      respuesta =
        "Los incidentes comunitarios se validan con tres confirmaciones de personas distintas dentro de 50 metros o una revisión autorizada. La confianza sube de 50% a 100%; las confirmaciones no aumentan la gravedad.";
    if (/ruta|caminar|bicicleta|auto/.test(message))
      respuesta =
        "Crea una cuenta para comparar recorridos a pie, en bicicleta o automóvil. Las opciones disponibles consideran distancia y los incidentes registrados por tramo. Si aparece una alerta durante el recorrido, tú decides si cambias de ruta.";
    if (/punto|riesgo|segur/.test(message))
      respuesta =
        "Cada incidente aporta gravedad × validación × antigüedad aplicable. Se suma por tramo y sus conexiones reciben 15%. Cero puntos es nivel 0; hasta 5 nivel 1; más de 5 hasta 10 nivel 2; luego cada cinco hasta el nivel máximo 5.";
    if (/premium|moneda|premio|ranking/.test(message))
      respuesta =
        "El ranking utiliza los puntos del mes y puede entregar monedas acumulables. Premium es una demostración sin cobros, con favoritos adicionales y opción de ocultar publicidad. No mejora la credibilidad ni el cálculo de seguridad.";
    if (/ahora|actual|reciente/.test(message)) {
      const count = await prisma.incident.count({
        where: {
          publicado: true,
          estado: { in: ["ACTIVO", "VALIDADO", "PENDIENTE"] },
        },
      });
      respuesta =
        "Hay " +
        count +
        " incidentes publicados actualmente en la base. Consulta el mapa para ver los detalles y si están por evaluar.";
    }
    const recent = await prisma.incident.findMany({
      where: {
        publicado: true,
        estado: { in: ["ACTIVO", "VALIDADO", "PENDIENTE"] },
      },
      select: {
        id: true,
        tipo: true,
        nivelRiesgo: true,
        evaluacion: true,
        latitud: true,
        longitud: true,
      },
      take: 20,
      orderBy: { fechaCreacion: "desc" },
    });
    const ai = await require("../lib/providers").assist(
      req.body.mensaje || req.body.message,
      { guia: respuesta, incidentes: recent },
    );
    res.json({
      respuesta: ai || respuesta,
      modo: ai ? "ia" : "guia",
      ia: !!ai,
    });
  }),
);
module.exports = router;
