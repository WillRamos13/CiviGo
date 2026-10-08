const express = require("express");
const prisma = require("../lib/db");
const { auth, requireEmail } = require("../lib/auth");
const {
  asyncRoute,
  HttpError,
  text,
  id,
  coordinates,
  distance,
  inCoverage,
  slug,
} = require("../lib/http");
const { config, DISTRICTS } = require("../lib/catalog");
const { evaluateReport } = require("../lib/providers");
const { counter } = require("../lib/security");
const { report, incident } = require("../lib/projections");
const { verifiedVoteInclude } = require("../lib/publication");
const {
  transaction,
  alertAgents,
  rewardValidated,
  chatOpen,
} = require("../lib/workflows");
const router = express.Router();
const reportQuota = counter();
const includes = {
  adjuntos: true,
  usuario: true,
  incidente: {
    include: {
      tipoCatalogo: { include: { categoria: true } },
      votos: verifiedVoteInclude(),
    },
  },
};
router.get(
  "/mine",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      (
        await prisma.report.findMany({
          where: { usuarioId: req.user.id },
          include: includes,
          orderBy: { fechaCreacion: "desc" },
          take: 200,
        })
      ).map((r) => report(r, true)),
    ),
  ),
);
router.get(
  "/",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      (
        await prisma.report.findMany({
          where: { usuarioId: req.user.id },
          include: includes,
          orderBy: { fechaCreacion: "desc" },
          take: 200,
        })
      ).map((r) => report(r, true)),
    ),
  ),
);
router.post(
  "/",
  auth,
  requireEmail,
  asyncRoute(async (req, res) => {
    const b = req.body;
    const p = coordinates(b.latitud, b.longitud);
    if (!inCoverage(p))
      throw new HttpError(
        422,
        "No tenemos información disponible fuera de la cobertura de Ica.",
        "OUT_OF_COVERAGE",
      );
    let type = await prisma.incidentType.findFirst({
      where: {
        activo: true,
        OR: [{ slug: slug(b.tipo) }, { nombre: String(b.tipo || "") }],
      },
    });
    if (!type)
      throw new HttpError(400, "Selecciona un tipo de incidente válido.");
    const descripcion = text(b.descripcion ?? "", "Descripción", 2000, 0);
    const fechaEvento = b.fechaEvento ? new Date(b.fechaEvento) : new Date();
    if (
      Number.isNaN(+fechaEvento) ||
      fechaEvento > Date.now() + 60000 ||
      fechaEvento < Date.now() - 7 * 86400000
    )
      throw new HttpError(
        400,
        "La fecha debe estar dentro de la última semana.",
      );
    if (!type.ubicacionRemota && fechaEvento < Date.now() - 3 * 3600000)
      throw new HttpError(
        400,
        "Este tipo debe reportarse como una situación actual.",
      );
    const rules = await config();
    let gps = { latitud: null, longitud: null };
    if (!type.ubicacionRemota) {
      gps = coordinates(b.gpsLatitud, b.gpsLongitud);
      if (distance(gps, p) > 50)
        throw new HttpError(
          400,
          "Solo puedes corregir la ubicación GPS hasta 50 metros.",
        );
    } else if (b.gpsLatitud !== undefined && b.gpsLongitud !== undefined) {
      gps = coordinates(b.gpsLatitud, b.gpsLongitud);
    }
    const normalizeName = (v) =>
      String(v || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/^distrito de /, "");
    const detected = require("../lib/roads").districtFor(p);
    const canonical =
      DISTRICTS.find((d) => normalizeName(d) === normalizeName(detected)) ||
      null;
    const supplied = b.distrito || null;
    if (supplied && !DISTRICTS.includes(supplied))
      throw new HttpError(400, "Distrito inválido.");
    if (canonical && supplied && canonical !== supplied)
      throw new HttpError(
        400,
        "El distrito no coincide con la ubicación del reporte.",
      );
    const distrito = canonical || supplied;
    const ids = b.adjuntosIds || [];
    if (
      !Array.isArray(ids) ||
      ids.length > 3 ||
      new Set(ids).size !== ids.length ||
      ids.some((v) => typeof v !== "string")
    )
      throw new HttpError(400, "Adjunta como máximo tres archivos.");
    const attachments = await prisma.attachment.findMany({
      where: {
        id: { in: ids },
        usuarioId: req.user.id,
        reporteId: null,
        tipo: "PUBLICO",
      },
    });
    if (attachments.length !== ids.length)
      throw new HttpError(
        400,
        "Uno de los archivos no es válido o ya fue usado.",
      );
    if (
      type.fotoObligatoria &&
      !attachments.some((a) => a.mimeType.startsWith("image/"))
    )
      throw new HttpError(
        400,
        "Este incidente requiere al menos una fotografía.",
      );
    const recent = await prisma.report.count({
      where: {
        usuarioId: req.user.id,
        fechaCreacion: { gte: new Date(Date.now() - 60000) },
      },
    });
    if (recent >= 3)
      throw new HttpError(
        429,
        "Espera un momento antes de publicar otro reporte.",
      );
    // Reserva la cuota antes de esperar a la IA: las peticiones concurrentes
    // aún no figuran en el conteo de reportes persistidos.
    reportQuota("user:" + req.user.id, 3, res);
    const evaluation = await evaluateReport(
      { descripcion, fechaEvento, adjuntos: attachments },
      type,
    );
    // Una respuesta textual no acredita los archivos. La sospecha de falsedad,
    // las imágenes incompatibles/dudosas y los archivos sin analizar requieren
    // decisión humana antes de validar ese aporte o concederle puntos.
    const requiresReview =
      !evaluation ||
      !!evaluation?.posibleFalso ||
      !!evaluation?.requiereRevision;
    const reviewReason = !evaluation
      ? "IA_NO_DISPONIBLE"
      : evaluation.evidencias?.some(
            (item) => item.resultado === "NO_RELACIONADA",
          )
        ? "IMAGEN_NO_RELACIONADA"
        : evaluation.evidencias?.some(
              (item) => item.resultado === "NO_CONCLUYENTE",
            )
          ? "EVIDENCIA_NO_CONCLUYENTE"
          : "REVISION_SOLICITADA";
    const reviewMessage =
      reviewReason === "IMAGEN_NO_RELACIONADA"
        ? "Una imagen no corresponde al incidente descrito. Tu aporte queda en revisión humana; no se ha declarado falso. Puedes aportar pruebas adecuadas desde Mis reportes o solicitar revisión."
        : reviewReason === "EVIDENCIA_NO_CONCLUYENTE"
          ? "Una prueba no permite evaluar el incidente con suficiente claridad. Tu aporte queda en revisión humana. Puedes aportar pruebas adecuadas desde Mis reportes o solicitar revisión."
          : reviewReason === "IA_NO_DISPONIBLE"
            ? "No fue posible completar el análisis automático. Tu aporte queda en revisión humana y no ha sido aprobado por la IA."
            : "Tu aporte requiere revisión humana antes de validarse. Puedes consultar su estado y aportar pruebas desde Mis reportes; no se ha sancionado tu cuenta.";
    const acceptedEvaluation = requiresReview ? null : evaluation;
    if (acceptedEvaluation?.tipoPropuesto) {
      const proposal = evaluation.tipoPropuesto;
      const category = await prisma.category.findUnique({
        where: { slug: proposal.categoriaSlug },
      });
      const proposedSlug = slug(proposal.nombre);
      if (category && proposedSlug && proposedSlug !== "otro") {
        const existing = await prisma.incidentType.findUnique({
          where: { slug: proposedSlug },
        });
        if (!existing) {
          type = await prisma.incidentType.create({
            data: {
              nombre: proposal.nombre,
              slug: proposedSlug,
              categoriaId: category.id,
              fotoObligatoria: type.fotoObligatoria,
            },
          });
          await prisma.auditLog.create({
            data: {
              accion: "PROPONER_TIPO_IA",
              entidad: "TIPO",
              entidadId: String(type.id),
              datos: {
                nombre: proposal.nombre,
                categoria: proposal.categoriaSlug,
              },
            },
          });
        }
      }
    }
    const result = await transaction(async (db) => {
      // La evaluación puede tardar: no usemos la autorización anterior a la IA.
      const actor = await db.user.findUnique({ where: { id: req.user.id } });
      if (!actor || actor.bloqueado)
        throw new HttpError(
          403,
          "Tu cuenta no puede publicar reportes en este momento.",
          "ACCOUNT_BLOCKED",
        );
      if (!actor.correoVerificado)
        throw new HttpError(
          403,
          "Verifica tu correo con Google para participar.",
          "EMAIL_REQUIRED",
        );
      const cutoff = new Date(Date.now() - rules.agrupacionHoras * 3600000);
      let nearby = [];
      if (!type.individual)
        nearby = await db.incident.findMany({
          where: {
            tipoId: type.id,
            estado: { in: ["ACTIVO", "VALIDADO", "PENDIENTE"] },
            OR: [
              { fechaPublicacion: { gte: cutoff } },
              { fechaPublicacion: null, fechaCreacion: { gte: cutoff } },
            ],
          },
          orderBy: { fechaCreacion: "asc" },
        });
      let current = nearby.find(
        (i) => distance(p, i) <= rules.agrupacionMetros,
      );
      const newIncident = !current;
      if (
        current &&
        (await db.report.findFirst({
          where: { incidenteId: current.id, usuarioId: req.user.id },
        }))
      )
        throw new HttpError(
          409,
          "Ya aportaste un reporte a este incidente. Puedes añadir pruebas o participar en su chat.",
        );
      if (!current)
        current = await db.incident.create({
          data: {
            tipo: type.nombre,
            tipoId: type.id,
            descripcion,
            ...p,
            distrito,
            nivelRiesgo: acceptedEvaluation?.gravedad ?? null,
            estado:
              acceptedEvaluation || type.emergencia ? "ACTIVO" : "PENDIENTE",
            publicado: !!acceptedEvaluation || type.emergencia,
            fechaPublicacion:
              acceptedEvaluation || type.emergencia ? new Date() : null,
            evaluacion: acceptedEvaluation ? "IA" : "PENDIENTE",
            individual: type.individual,
            historico: type.historico,
            emergencia: type.emergencia,
            persistente: type.persistente,
            fechaEvento,
          },
        });
      else {
        const data = { totalReportes: { increment: 1 } };
        if (current.evaluacion !== "AGENTE" && acceptedEvaluation)
          data.nivelRiesgo = Math.max(
            current.nivelRiesgo || 0,
            acceptedEvaluation.gravedad,
          );
        if (acceptedEvaluation && !current.publicado) {
          data.publicado = true;
          data.fechaPublicacion = current.fechaPublicacion || new Date();
          data.estado = "ACTIVO";
          data.evaluacion = "IA";
        }
        current = await db.incident.update({ where: { id: current.id }, data });
      }
      let created = await db.report.create({
        data: {
          usuarioId: req.user.id,
          tipo: type.nombre,
          tipoId: type.id,
          descripcion,
          ...p,
          gpsLatitud: gps.latitud,
          gpsLongitud: gps.longitud,
          nivelRiesgo: acceptedEvaluation?.gravedad ?? null,
          incidenteId: current.id,
          fechaEvento,
          estado: requiresReview
            ? "EN_REVISION"
            : current.estado === "VALIDADO"
              ? "VALIDADO"
              : "PENDIENTE",
        },
      });
      for (const a of attachments) {
        const connected = await db.attachment.updateMany({
          where: { id: a.id, usuarioId: req.user.id, reporteId: null },
          data: {
            reporteId: created.id,
            ...(type.individual || requiresReview
              ? { privado: true, tipo: "EVIDENCIA" }
              : {}),
          },
        });
        if (!connected.count)
          throw new HttpError(409, "El archivo ya fue usado en otro reporte.");
      }
      await db.auditLog.create({
        data: {
          usuarioId: req.user.id,
          accion: "EVALUACION_IA_REPORTE",
          entidad: "Report",
          entidadId: String(created.id),
          datos: {
            evaluacionRecibida: !!evaluation,
            requiereRevision: requiresReview,
            motivoRevision: requiresReview ? reviewReason : null,
            gravedad: evaluation?.gravedad ?? null,
            motivo:
              evaluation?.motivo ??
              "Evaluación no disponible; revisión humana pendiente.",
            evidencias: evaluation?.evidencias ?? [],
          },
        },
      });
      if (requiresReview)
        await db.notification.create({
          data: {
            usuarioId: req.user.id,
            incidenteId: current.id,
            titulo: "Reporte #" + created.id + " en revisión",
            mensaje: reviewMessage,
            tipo: "REPORTE_EN_REVISION",
          },
        });
      if (!newIncident) {
        if (
          !requiresReview &&
          gps.latitud !== null &&
          distance(gps, current) <= rules.confirmacionMetros
        )
          await db.vote.upsert({
            where: {
              usuarioId_incidenteId_tipo: {
                usuarioId: req.user.id,
                incidenteId: current.id,
                tipo: "CONFIRMAR",
              },
            },
            update: {},
            create: {
              usuarioId: req.user.id,
              incidenteId: current.id,
              tipo: "CONFIRMAR",
              latitud: gps.latitud,
              longitud: gps.longitud,
            },
          });
        if (current.evaluacion !== "AGENTE") {
          const votes = await db.vote.count({
            where: {
              incidenteId: current.id,
              tipo: "CONFIRMAR",
              usuario: { correoVerificado: true },
            },
          });
          const validacion = Math.min(
            1,
            0.5 + (0.5 * votes) / rules.confirmaciones,
          );
          current = await db.incident.update({
            where: { id: current.id },
            data: {
              validacion,
              estado: current.publicado
                ? validacion === 1
                  ? "VALIDADO"
                  : "ACTIVO"
                : "PENDIENTE",
            },
          });
        }
        if (created.estado === "VALIDADO" && current.estado !== "VALIDADO")
          created = await db.report.update({
            where: { id: created.id },
            data: { estado: "PENDIENTE" },
          });
        if (current.validacion >= 1 && current.publicado)
          await rewardValidated(db, current.id);
      }
      if (!evaluation)
        await alertAgents(
          db,
          current,
          "Evaluación pendiente",
          type.emergencia
            ? "Emergencia publicada por evaluar. Revisa el incidente con urgencia."
            : "Reporte esperando evaluación de IA o personal autorizado.",
        );
      if (evaluation?.posibleFalso || (evaluation && requiresReview))
        await alertAgents(
          db,
          current,
          evaluation.posibleFalso
            ? "Posible reporte falso"
            : "Evidencia para revisar",
          evaluation.motivo ||
            "Los adjuntos no permiten aprobar el reporte automáticamente; no se ha sancionado al autor.",
        );
      if (newIncident && type.persistente) {
        const old = await db.incident.findMany({
          where: {
            id: { not: current.id },
            tipoId: type.id,
            estado: { in: ["ACTIVO", "VALIDADO"] },
          },
        });
        if (old.some((i) => distance(i, p) <= 50))
          await alertAgents(
            db,
            current,
            "Posible problema persistente duplicado",
            "Nuevo reporte fuera de la ventana de agrupación. Revisar presencialmente.",
          );
      }
      return { reporte: created, incidente: current };
    });
    res.status(201).json({
      reporte: report(
        await prisma.report.findUnique({
          where: { id: result.reporte.id },
          include: includes,
        }),
        true,
      ),
      incidente: incident(result.incidente),
      ...(requiresReview
        ? {
            revision: {
              requerida: true,
              motivo: reviewReason,
              mensaje: reviewMessage,
            },
          }
        : {}),
    });
  }),
);
router.post(
  "/:id/evidence",
  auth,
  requireEmail,
  asyncRoute(async (req, res) => {
    const r = await prisma.report.findFirst({
      where: { id: id(req.params.id), usuarioId: req.user.id },
      include: { incidente: true },
    });
    if (!r) throw new HttpError(404, "Reporte no encontrado.");
    if (r.incidente?.individual && !chatOpen(r.incidente))
      throw new HttpError(
        409,
        "El plazo de siete días finalizó. Solicita revisión.",
      );
    const ids = req.body.adjuntosIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 3)
      throw new HttpError(400, "Selecciona hasta tres pruebas privadas.");
    await transaction(async (db) => {
      const current = await db.incident.findUnique({
        where: { id: r.incidente.id },
      });
      if (current?.individual && !chatOpen(current))
        throw new HttpError(
          409,
          "El plazo de siete días finalizó. Solicita revisión.",
        );
      const count = await db.attachment.count({
        where: { reporteId: r.id },
      });
      if (count + ids.length > 3)
        throw new HttpError(400, "El máximo es tres pruebas por reporte.");
      const changed = await db.attachment.updateMany({
        where: {
          id: { in: ids },
          usuarioId: req.user.id,
          reporteId: null,
          privado: true,
          tipo: "EVIDENCIA",
        },
        data: { reporteId: r.id },
      });
      if (changed.count !== ids.length)
        throw new HttpError(400, "Pruebas inválidas.");
      // La validación anterior del incidente no verifica archivos añadidos
      // después. El personal revisará estas nuevas pruebas antes de premiarlas.
      await db.report.update({
        where: { id: r.id },
        data: { estado: "EN_REVISION" },
      });
      await alertAgents(
        db,
        r.incidente,
        "Pruebas para revisar",
        "El autor añadió pruebas privadas al reporte.",
      );
    });
    res.json(
      report(
        await prisma.report.findUnique({
          where: { id: r.id },
          include: includes,
        }),
        true,
      ),
    );
  }),
);
router.post(
  "/:id/appeal",
  auth,
  asyncRoute(async (req, res) => {
    const r = await prisma.report.findFirst({
      where: { id: id(req.params.id), usuarioId: req.user.id },
    });
    if (!r) throw new HttpError(404, "Reporte no encontrado.");
    if (
      await prisma.appeal.findFirst({
        where: { reporteId: r.id, estado: "PENDIENTE" },
      })
    )
      throw new HttpError(409, "Ya existe una revisión pendiente.");
    const row = await prisma.appeal.create({
      data: {
        reporteId: r.id,
        usuarioId: req.user.id,
        motivo: text(req.body.motivo, "Motivo", 2000, 10),
      },
    });
    res.status(201).json(row);
  }),
);
module.exports = router;
