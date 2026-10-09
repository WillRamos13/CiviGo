const express = require("express");
const prisma = require("../lib/db");
const { auth, optionalAuth, requireEmail, canReview } = require("../lib/auth");
const {
  asyncRoute,
  HttpError,
  id,
  text,
  coordinates,
  distance,
} = require("../lib/http");
const { config } = require("../lib/catalog");
const { incident, publicUser } = require("../lib/projections");
const {
  canPublishIncident,
  verifiedVoteInclude,
} = require("../lib/publication");
const {
  parseNearbyIncidentQuery,
  publicIncidentWhere,
  isVisiblePublicIncident,
  findNearbyRecentIncidents,
} = require("../lib/recent-incidents");
const {
  transaction,
  rewardValidated,
  chatOpen,
  alertAgents,
} = require("../lib/workflows");
const router = express.Router();
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const include = {
  tipoCatalogo: { include: { categoria: true } },
  reportes: {
    include: { usuario: true, adjuntos: true },
    orderBy: { fechaCreacion: "asc" },
  },
  votos: verifiedVoteInclude(),
  _count: { select: { reportes: true } },
};
router.get(
  "/",
  optionalAuth,
  asyncRoute(async (req, res) => {
    const now = new Date();
    const nearby = parseNearbyIncidentQuery(req.query);
    if (nearby) {
      const rows = await findNearbyRecentIncidents(
        prisma,
        nearby,
        include,
        now,
      );
      return res.json(rows.map((row) => incident(row)));
    }
    const where = publicIncidentWhere(now);
    if (req.query.tipo) where.tipoCatalogo = { slug: String(req.query.tipo) };
    const [active, historical] = await Promise.all([
      prisma.incident.findMany({
        where: {
          ...where,
          estado: { in: ["ACTIVO", "VALIDADO", "PENDIENTE"] },
        },
        include,
        orderBy: { fechaCreacion: "desc" },
        take: 500,
      }),
      prisma.incident.findMany({
        where: { ...where, historico: true, estado: "RESUELTO" },
        include,
        orderBy: { fechaCreacion: "desc" },
        take: 500,
      }),
    ]);
    const incidents = [...active, ...historical].sort(
      (a, b) => b.fechaCreacion - a.fechaCreacion,
    );
    res.json(
      incidents
        .filter((i) => isVisiblePublicIncident(i, now))
        .map((i) => incident(i)),
    );
  }),
);
router.get(
  "/:id",
  optionalAuth,
  asyncRoute(async (req, res) => {
    const row = await prisma.incident.findUnique({
      where: { id: id(req.params.id) },
      include,
    });
    if (!row) throw new HttpError(404, "Incidente no encontrado.");
    const owner =
      req.user && row.reportes.some((r) => r.usuarioId === req.user.id);
    const visible = row.publicado && (await canPublishIncident(prisma, row.id));
    if (!visible && !owner && !canReview(req.user, row))
      throw new HttpError(404, "Incidente no disponible.");
    res.json(incident(row));
  }),
);
for (const action of ["confirmar", "resolver"]) {
  router.post(
    "/:id/" + action,
    auth,
    requireEmail,
    asyncRoute(async (req, res) => {
      const p = coordinates(req.body.latitud, req.body.longitud);
      const rules = await config();
      const value = await transaction(async (db) => {
        let row = await db.incident.findUnique({
          where: { id: id(req.params.id) },
          include: {
            reportes: { orderBy: [{ fechaCreacion: "asc" }, { id: "asc" }] },
          },
        });
        if (!row || !row.publicado || !(await canPublishIncident(db, row.id)))
          throw new HttpError(404, "Incidente no encontrado.");
        if (!["ACTIVO", "VALIDADO", "PENDIENTE"].includes(row.estado))
          throw new HttpError(409, "El incidente ya no está activo.");
        if (row.individual)
          throw new HttpError(
            400,
            "Este delito se valida mediante pruebas privadas; no recibe votos comunitarios.",
          );
        const staff = canReview(
          req.user,
          row,
          action === "confirmar" ? "revisar" : "resolver",
        );
        if (!staff && distance(p, row) > rules.confirmacionMetros)
          throw new HttpError(
            403,
            "Debes estar dentro de " +
              rules.confirmacionMetros +
              " metros del incidente.",
          );
        if (
          action === "confirmar" &&
          row.reportes[0]?.usuarioId === req.user.id
        )
          throw new HttpError(
            409,
            "El autor inicial no puede confirmar su propio reporte.",
          );
        const tipo = action === "confirmar" ? "CONFIRMAR" : "RESOLVER";
        if (
          await db.vote.findUnique({
            where: {
              usuarioId_incidenteId_tipo: {
                usuarioId: req.user.id,
                incidenteId: row.id,
                tipo,
              },
            },
          })
        )
          throw new HttpError(
            409,
            "Ya registraste esta acción en el incidente.",
          );
        await db.vote.create({
          data: { usuarioId: req.user.id, incidenteId: row.id, tipo, ...p },
        });
        const count = await db.vote.count({
          where: {
            incidenteId: row.id,
            tipo,
            usuario: { correoVerificado: true },
          },
        });
        if (action === "confirmar") {
          if (staff) {
            row = await db.incident.update({
              where: { id: row.id },
              data: { validacion: 1, estado: "VALIDADO", evaluacion: "AGENTE" },
            });
          } else if (row.evaluacion !== "AGENTE") {
            const validacion = Math.min(
              1,
              0.5 + (0.5 * count) / rules.confirmaciones,
            );
            row = await db.incident.update({
              where: { id: row.id },
              data: {
                validacion,
                estado: validacion === 1 ? "VALIDADO" : "ACTIVO",
              },
            });
          }
          if (row.validacion >= 1) await rewardValidated(db, row.id);
        } else if (staff || count >= rules.resoluciones)
          row = await db.incident.update({
            where: { id: row.id },
            data: {
              estado: "RESUELTO",
              publicado: row.historico && row.validacion >= 1,
              motivoRetiro:
                "Resuelto por " + (staff ? "agente" : "cinco vecinos"),
            },
          });
        return db.incident.findUnique({ where: { id: row.id }, include });
      });
      res.json(incident(value));
    }),
  );
}
router.post(
  "/:id/reabrir",
  auth,
  requireEmail,
  asyncRoute(async (req, res) => {
    const row = await prisma.incident.findUnique({
      where: { id: id(req.params.id) },
    });
    if (!row) throw new HttpError(404, "Incidente no encontrado.");
    const motivo = text(
      req.body.motivo || "Solicitud de reapertura del incidente",
      "Motivo",
      2000,
    );
    if (!canReview(req.user, row, "reabrir")) {
      const p = coordinates(req.body.latitud, req.body.longitud);
      if (distance(row, p) > 50)
        throw new HttpError(
          403,
          "Acércate al incidente para solicitar reapertura.",
        );
      await alertAgents(prisma, row, "Solicitud de reapertura", motivo);
      res
        .status(202)
        .json({ mensaje: "Un agente revisará la solicitud de reapertura." });
      return;
    }
    const { reviewIncident } = require("../lib/workflows");
    const updated = await transaction((db) =>
      reviewIncident(db, row, req.user, { accion: "REABRIR", motivo }),
    );
    res.json(incident(updated));
  }),
);
router.post(
  "/:id/flags",
  auth,
  requireEmail,
  asyncRoute(async (req, res) => {
    const incidenteId = id(req.params.id);
    const row = await prisma.incident.findUnique({
      where: { id: incidenteId },
    });
    if (!row || !row.publicado || !(await canPublishIncident(prisma, row.id)))
      throw new HttpError(404, "Incidente no encontrado.");
    const tipo = req.body.tipo;
    if (!["FALSO", "NO_ENCONTRADO", "REAPERTURA"].includes(tipo))
      throw new HttpError(400, "Motivo de aviso inválido.");
    const motivo = text(req.body.motivo, "Detalle", 2000, 5);
    const flag = await prisma.flag.create({
      data: { usuarioId: req.user.id, incidenteId, tipo, motivo },
    });
    await alertAgents(prisma, row, "Incidente señalado para revisión", motivo);
    res.status(201).json(flag);
  }),
);
router.get(
  "/:id/chat",
  auth,
  asyncRoute(async (req, res) => {
    const row = await prisma.incident.findUnique({
      where: { id: id(req.params.id) },
      include: { reportes: true },
    });
    const visible =
      row?.publicado && (await canPublishIncident(prisma, row.id));
    if (
      !row ||
      (!visible &&
        !canReview(req.user, row) &&
        !row.reportes.some((r) => r.usuarioId === req.user.id))
    )
      throw new HttpError(404, "Incidente no disponible.");
    const messages = await prisma.chatMessage.findMany({
      where: { incidenteId: row.id },
      include: { usuario: true },
      orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
      take: 200,
    });
    res.json(
      messages.reverse().map((m) => ({
        id: m.id,
        mensaje: m.mensaje,
        creadoEn: m.creadoEn,
        usuario: publicUser(m.usuario),
      })),
    );
  }),
);
router.post(
  "/:id/chat",
  auth,
  requireEmail,
  asyncRoute(async (req, res) => {
    const m = await transaction(async (db) => {
      const row = await db.incident.findUnique({
        where: { id: id(req.params.id) },
        include: { reportes: true },
      });
      const visible = row?.publicado && (await canPublishIncident(db, row.id));
      if (
        !row ||
        (!visible &&
          !canReview(req.user, row) &&
          !row.reportes.some((r) => r.usuarioId === req.user.id))
      )
        throw new HttpError(404, "Incidente no disponible.");
      if (!chatOpen(row))
        throw new HttpError(409, "El chat de este incidente está cerrado.");
      const mensaje = text(req.body.mensaje, "Mensaje", 1000);
      const recent = await db.chatMessage.findMany({
        where: {
          usuarioId: req.user.id,
          creadoEn: { gte: new Date(Date.now() - 60000) },
        },
        select: { mensaje: true },
      });
      if (recent.length >= 8 || recent.some((m) => m.mensaje === mensaje))
        throw new HttpError(
          429,
          "Espera antes de enviar más mensajes o repetir contenido.",
        );
      return db.chatMessage.create({
        data: { usuarioId: req.user.id, incidenteId: row.id, mensaje },
      });
    });
    res.status(201).json({ ...m, usuario: publicUser(req.user) });
  }),
);
module.exports = router;
module.exports.include = include;
