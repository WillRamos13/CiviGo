const prisma = require("./db");
const { config } = require("./catalog");
const { HttpError } = require("./http");
const { canReview } = require("./auth");
const { permissionForReview } = require("./agent-permissions");
const { canPublishIncident } = require("./publication");
async function transaction(work) {
  for (let n = 0; n < 3; n++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: "Serializable",
        maxWait: 10000,
        timeout: 60000,
      });
    } catch (error) {
      if (error.code === "P2034" && n < 2) continue;
      throw error;
    }
  }
}
async function award(db, usuarioId, clave, tipo, puntos, original) {
  await db.pointEvent.upsert({
    where: { clave },
    update: {},
    create: {
      usuarioId,
      clave,
      tipo,
      puntos: original?.puntos ?? puntos,
      ...(original?.creadoEn ? { creadoEn: new Date(original.creadoEn) } : {}),
    },
  });
}
function credibility(validated, faltas) {
  if (faltas >= 4) return 0;
  if (validated < 3 && faltas === 0) return null;
  return [100, 70, 40, 20][Math.min(faltas, 3)];
}
async function refreshCredibility(db, usuarioId) {
  const [u, count] = await Promise.all([
    db.user.findUnique({ where: { id: usuarioId } }),
    db.report.count({ where: { usuarioId, estado: "VALIDADO" } }),
  ]);
  return db.user.update({
    where: { id: usuarioId },
    data: {
      reputacion: credibility(count, u.faltas),
      bloqueado: u.faltas >= 4 || u.bloqueado,
    },
  });
}
// Keep the original vote IDs for audited withdrawals and successful appeals.
// False and withdrawn contributions cannot support their own incident. A held
// report may still confirm presence explicitly; reporting never creates that vote.
function eligibleConfirmationWhere(incidenteId) {
  return {
    incidenteId,
    tipo: "CONFIRMAR",
    usuario: {
      correoVerificado: true,
      OR: [
        { reportes: { none: { incidenteId } } },
        {
          reportes: {
            some: {
              incidenteId,
              estado: { notIn: ["FALSO", "RETIRADO"] },
            },
          },
        },
      ],
    },
  };
}
async function rewardValidated(db, incidenteId) {
  const rules = await config(db);
  const reports = await db.report.findMany({
    where: {
      incidenteId,
      usuario: { correoVerificado: true },
      estado: { notIn: ["EN_REVISION", "FALSO", "RETIRADO"] },
    },
    orderBy: { fechaCreacion: "asc" },
    include: {
      adjuntos: {
        where: { tipo: { in: ["EVIDENCIA", "PUBLICO"] } },
        select: { id: true },
      },
    },
  });
  const votes = await db.vote.findMany({
    where: eligibleConfirmationWhere(incidenteId),
  });
  const keys = reports
    .flatMap((r) => ["reporte:" + r.id, "prueba:" + r.id])
    .concat(votes.map((v) => "confirmacion:" + v.id));
  const existing = new Set(
    (
      await db.pointEvent.findMany({
        where: { clave: { in: keys } },
        select: { clave: true },
      })
    ).map((p) => p.clave),
  );
  const seen = new Set();
  // Una apelación aceptada restaura la contribución en su mes original;
  // no convierte el mismo aporte en una segunda recompensa mensual.
  const previousWithdrawals = await db.auditLog.findMany({
    where: {
      accion: { in: ["ANULAR_PUNTOS_FALSO", "ANULAR_PUNTOS_APORTE_FALSO"] },
      entidad: "INCIDENTE",
      entidadId: String(incidenteId),
    },
    orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
  });
  const originals = new Map(
    previousWithdrawals
      .flatMap((row) => row.datos?.puntosAnulados || [])
      .map((point) => [point.clave, point]),
  );
  let pos = 0;
  for (const r of reports) {
    if (seen.has(r.usuarioId)) continue;
    seen.add(r.usuarioId);
    const factor = [1, 0.75, 0.5][pos++] || 0;
    if (r.estado !== "VALIDADO")
      await db.report.update({
        where: { id: r.id },
        data: { estado: "VALIDADO" },
      });
    if (!existing.has("reporte:" + r.id)) {
      await award(
        db,
        r.usuarioId,
        "reporte:" + r.id,
        "REPORTE_VALIDADO",
        rules.puntosReporte * factor,
        originals.get("reporte:" + r.id),
      );
    }
    // Una apelación puede restaurar el estado sin crear puntos nuevos.
    await refreshCredibility(db, r.usuarioId);
    if (r.adjuntos.length && !existing.has("prueba:" + r.id))
      await award(
        db,
        r.usuarioId,
        "prueba:" + r.id,
        "PRUEBA_VALIDADA",
        rules.puntosPrueba,
        originals.get("prueba:" + r.id),
      );
  }
  for (const v of votes)
    if (!existing.has("confirmacion:" + v.id))
      await award(
        db,
        v.usuarioId,
        "confirmacion:" + v.id,
        "CONFIRMACION_VALIDADA",
        rules.puntosConfirmacion,
        originals.get("confirmacion:" + v.id),
      );
}
async function alertAgents(db, incident, titulo, mensaje) {
  const agents = await db.user.findMany({
    where: {
      bloqueado: false,
      OR: [
        { rol: "ADMIN" },
        { rol: "AGENTE", tipoAgente: "COLABORADOR" },
        { rol: "AGENTE", distrito: incident.distrito || "__sin_distrito__" },
      ],
    },
    select: { id: true },
  });
  if (agents.length)
    await db.notification.createMany({
      data: agents.map((u) => ({
        usuarioId: u.id,
        titulo,
        mensaje,
        tipo: "REVISION",
        incidenteId: incident.id,
      })),
    });
}
async function notifyOwners(db, incident, titulo, mensaje) {
  const reports = await db.report.findMany({
    where: { incidenteId: incident.id },
    select: { usuarioId: true },
  });
  const ids = [...new Set(reports.map((r) => r.usuarioId))];
  if (ids.length)
    await db.notification.createMany({
      data: ids.map((usuarioId) => ({
        usuarioId,
        titulo,
        mensaje,
        incidenteId: incident.id,
      })),
    });
}
function chatOpen(incident, now = new Date()) {
  if (incident.individual) {
    if (["FALSO", "RETIRADO", "RESUELTO"].includes(incident.estado))
      return false;
    if (incident.publicado === false && incident.fechaPublicacion == null)
      return true;
    return (
      now - (incident.fechaPublicacion || incident.fechaCreacion) <
        7 * 86400000 &&
      !["FALSO", "RETIRADO", "RESUELTO"].includes(incident.estado)
    );
  }
  return ["ACTIVO", "VALIDADO", "PENDIENTE"].includes(incident.estado);
}
async function reviewIncident(db, incident, user, input) {
  incident = await db.incident.findUnique({ where: { id: incident.id } });
  if (!incident) throw new HttpError(404, "Incidente no encontrado.");
  const { accion, motivo, nivelRiesgo } = input;
  const actor = await db.user.findUnique({ where: { id: user.id } });
  const permission = permissionForReview(accion);
  if (!permission) throw new HttpError(400, "Acción de revisión inválida.");
  if (
    !canReview(actor, incident, permission) ||
    (incident.individual &&
      ["VALIDAR", "FALSO"].includes(accion) &&
      !canReview(actor, incident, "evidencia"))
  )
    throw new HttpError(
      403,
      "No tienes permisos actuales para revisar este incidente.",
    );
  if (incident.estado === "FALSO" && accion !== "RETIRAR_PUNTOS")
    throw new HttpError(
      409,
      "El incidente fue declarado falso. Primero revisa la apelación correspondiente.",
    );
  if (
    accion === "VALIDAR" &&
    ["RESUELTO", "RETIRADO"].includes(incident.estado)
  )
    throw new HttpError(
      409,
      "Reabre primero el incidente mediante una revisión autorizada antes de validarlo.",
      "INCIDENT_REOPEN_REQUIRED",
    );
  if (
    ![
      "VALIDAR",
      "FALSO",
      "RESOLVER",
      "REABRIR",
      "GRAVEDAD",
      "RETIRAR_PUNTOS",
    ].includes(accion)
  )
    throw new HttpError(400, "Acción de revisión inválida.");
  if (
    ["VALIDAR", "GRAVEDAD"].includes(accion) &&
    (!Number.isInteger(nivelRiesgo) || nivelRiesgo < 1 || nivelRiesgo > 5)
  )
    throw new HttpError(400, "Asigna una gravedad entre 1 y 5.");
  let data = {};
  let puntosAnulados = [];
  if (accion === "FALSO") {
    data = { estado: "FALSO", publicado: false, motivoRetiro: motivo };
    const reports = await db.report.findMany({
      where: { incidenteId: incident.id },
    });
    if (reports.length > 1)
      throw new HttpError(
        409,
        "Revisa cada aporte por separado. Declarar un incidente agrupado falso no puede sancionar a todos sus autores.",
        "REPORT_REVIEW_REQUIRED",
      );
    if (
      reports.length &&
      (await db.attachment.count({
        where: { reporteId: reports[0].id, privado: true },
      })) &&
      !canReview(actor, incident, "evidencia")
    )
      throw new HttpError(
        403,
        "Necesitas permiso para revisar las pruebas privadas de este aporte.",
      );
    for (const report of reports) await declareReportFalse(db, report);
  }
  if (accion === "RETIRAR_PUNTOS") {
    if (actor.rol !== "ADMIN")
      throw new HttpError(
        403,
        "La retirada de puntos requiere evaluación administrativa.",
      );
    if (incident.estado !== "FALSO")
      throw new HttpError(
        409,
        "Solo puede retirar puntos de un incidente declarado falso.",
      );
    const reports = await db.report.findMany({
      where: { incidenteId: incident.id },
      select: { id: true },
    });
    const votes = await db.vote.findMany({
      where: { incidenteId: incident.id, tipo: "CONFIRMAR" },
      select: { id: true },
    });
    const keys = reports
      .flatMap((r) => ["reporte:" + r.id, "prueba:" + r.id])
      .concat(votes.map((v) => "confirmacion:" + v.id));
    puntosAnulados = await db.pointEvent.findMany({
      where: { clave: { in: keys } },
    });
    if (!puntosAnulados.length) return incident;
    await db.pointEvent.deleteMany({ where: { clave: { in: keys } } });
    await db.auditLog.create({
      data: {
        usuarioId: user.id,
        accion: "ANULAR_PUNTOS_FALSO",
        entidad: "INCIDENTE",
        entidadId: String(incident.id),
        datos: { motivo, puntosAnulados },
      },
    });
  }
  if (accion === "VALIDAR") {
    if (!(await canPublishIncident(db, incident.id)))
      throw new HttpError(
        409,
        "El autor debe verificar su correo con Google antes de publicar el reporte.",
        "REPORT_EMAIL_REQUIRED",
      );
    data = {
      estado: "VALIDADO",
      publicado: true,
      fechaPublicacion: incident.fechaPublicacion || new Date(),
      nivelRiesgo,
      validacion: 1,
      evaluacion: "AGENTE",
      motivoRetiro: null,
    };
    const contributions = await db.report.findMany({
      where: { incidenteId: incident.id },
    });
    if (
      (await db.attachment.count({
        where: {
          reporteId: {
            in: contributions
              .filter((r) => !["FALSO", "RETIRADO"].includes(r.estado))
              .map((r) => r.id),
          },
          privado: true,
        },
      })) &&
      !canReview(actor, incident, "evidencia")
    )
      throw new HttpError(
        403,
        "Necesitas permiso para revisar las pruebas privadas de estos aportes.",
      );
    if (
      contributions.length > 1 &&
      !contributions.some(
        (r) => !["EN_REVISION", "FALSO", "RETIRADO"].includes(r.estado),
      )
    )
      throw new HttpError(
        409,
        "Revisa y aprueba al menos un aporte por separado antes de validar este incidente.",
        "REPORT_REVIEW_REQUIRED",
      );
    if (
      contributions.length === 1 &&
      contributions[0].estado === "EN_REVISION"
    ) {
      const privateEvidence = await db.attachment.count({
        where: { reporteId: contributions[0].id, privado: true },
      });
      if (privateEvidence && !canReview(actor, incident, "evidencia"))
        throw new HttpError(
          403,
          "Necesitas permiso para revisar las pruebas privadas de este aporte.",
        );
      await db.report.update({
        where: { id: contributions[0].id },
        data: { estado: "PENDIENTE" },
      });
    }
    await rewardValidated(db, incident.id);
  }
  if (accion === "GRAVEDAD") data = { nivelRiesgo, evaluacion: "AGENTE" };
  if (accion === "RESOLVER") {
    data = {
      estado: "RESUELTO",
      publicado:
        incident.historico &&
        incident.validacion >= 1 &&
        (await canPublishIncident(db, incident.id)),
      motivoRetiro: "Resuelto por personal autorizado",
    };
  }
  if (accion === "REABRIR") {
    if (incident.estado !== "RESUELTO" && incident.estado !== "RETIRADO")
      throw new HttpError(
        409,
        "Solo puede reabrirse un incidente resuelto o retirado.",
      );
    if (!(await canPublishIncident(db, incident.id, { includeRetired: true })))
      throw new HttpError(
        409,
        "El autor debe verificar su correo con Google antes de publicar el reporte.",
        "REPORT_EMAIL_REQUIRED",
      );
    data = {
      estado: incident.validacion >= 1 ? "VALIDADO" : "ACTIVO",
      publicado: true,
      fechaPublicacion: new Date(),
      validacion: incident.validacion >= 1 ? 1 : 0.5,
      motivoRetiro: null,
    };
    await db.report.updateMany({
      where: {
        incidenteId: incident.id,
        usuario: { correoVerificado: true },
        estado: { notIn: ["EN_REVISION", "FALSO"] },
      },
      data: {
        estado: incident.validacion >= 1 ? "VALIDADO" : "PENDIENTE",
        recordatorioEnviado: false,
      },
    });
    await db.vote.deleteMany({
      where: { incidenteId: incident.id, tipo: "RESOLVER" },
    });
  }
  const result = await db.incident.update({ where: { id: incident.id }, data });
  if (["VALIDAR", "FALSO", "RESOLVER", "REABRIR"].includes(accion))
    await db.flag.updateMany({
      where: { incidenteId: incident.id, estado: "PENDIENTE" },
      data: { estado: "REVISADO" },
    });
  await db.review.create({
    data: {
      usuarioId: user.id,
      incidenteId: incident.id,
      accion,
      motivo,
      datos: {
        anterior: {
          estado: incident.estado,
          nivelRiesgo: incident.nivelRiesgo,
        },
        actual: data,
        ...(puntosAnulados.length ? { puntosAnulados } : {}),
      },
    },
  });
  await notifyOwners(db, incident, "Revisión del incidente", motivo);
  return result;
}
async function declareReportFalse(db, report) {
  const changed = await db.report.updateMany({
    where: { id: report.id, sancionAplicada: false },
    data: { estado: "FALSO", sancionAplicada: true },
  });
  if (changed.count)
    await db.user.update({
      where: { id: report.usuarioId },
      data: { faltas: { increment: 1 } },
    });
  else
    await db.report.update({
      where: { id: report.id },
      data: { estado: "FALSO" },
    });
  await refreshCredibility(db, report.usuarioId);
}
async function reviewReport(db, reportId, user, input) {
  const r = await db.report.findUnique({
    where: { id: reportId },
    include: { incidente: true, adjuntos: true, usuario: true },
  });
  if (!r?.incidente) throw new HttpError(404, "Reporte no encontrado.");
  const actor = await db.user.findUnique({ where: { id: user.id } });
  const { accion, motivo, nivelRiesgo } = input;
  if (!["VALIDAR", "FALSO", "RETIRAR_PUNTOS"].includes(accion))
    throw new HttpError(400, "Decisión de aporte inválida.");
  if (
    !canReview(actor, r.incidente, permissionForReview(accion)) ||
    ((r.incidente.individual || r.adjuntos.some((a) => a.privado)) &&
      !canReview(actor, r.incidente, "evidencia"))
  )
    throw new HttpError(
      403,
      "No tienes permisos para revisar este aporte y sus pruebas.",
    );
  if (r.estado === "FALSO" && accion !== "RETIRAR_PUNTOS")
    throw new HttpError(
      409,
      "Primero debe aceptarse la apelación de este aporte.",
    );
  if (accion === "RETIRAR_PUNTOS") {
    if (actor.rol !== "ADMIN")
      throw new HttpError(403, "Solo un administrador puede retirar puntos.");
    if (r.estado !== "FALSO")
      throw new HttpError(
        409,
        "Solo pueden retirarse puntos de un aporte declarado falso.",
      );
    const votes = await db.vote.findMany({
      where: {
        incidenteId: r.incidenteId,
        usuarioId: r.usuarioId,
        tipo: "CONFIRMAR",
      },
    });
    const keys = [
      "reporte:" + r.id,
      "prueba:" + r.id,
      ...votes.map((v) => "confirmacion:" + v.id),
    ];
    const puntosAnulados = await db.pointEvent.findMany({
      where: { clave: { in: keys } },
    });
    if (puntosAnulados.length) {
      await db.pointEvent.deleteMany({ where: { clave: { in: keys } } });
      await db.auditLog.create({
        data: {
          usuarioId: actor.id,
          accion: "ANULAR_PUNTOS_APORTE_FALSO",
          entidad: "INCIDENTE",
          entidadId: String(r.incidenteId),
          datos: { reporteId: r.id, motivo, puntosAnulados },
        },
      });
    }
  } else if (accion === "VALIDAR") {
    if (["RESUELTO", "RETIRADO", "FALSO"].includes(r.incidente.estado))
      throw new HttpError(
        409,
        "Reabre primero el incidente mediante una revisión autorizada antes de validar sus aportes.",
        "INCIDENT_REOPEN_REQUIRED",
      );
    if (!r.usuario.correoVerificado)
      throw new HttpError(
        409,
        "El autor debe verificar su correo antes de validar el aporte.",
        "REPORT_EMAIL_REQUIRED",
      );
    if (!Number.isInteger(nivelRiesgo) || nivelRiesgo < 1 || nivelRiesgo > 5)
      throw new HttpError(400, "Asigna una gravedad entre 1 y 5.");
    await db.report.update({
      where: { id: r.id },
      data: { estado: "VALIDADO", nivelRiesgo },
    });
    await db.incident.update({
      where: { id: r.incidenteId },
      data: {
        estado: "VALIDADO",
        publicado: true,
        fechaPublicacion: r.incidente.fechaPublicacion || new Date(),
        evaluacion: "AGENTE",
        validacion: 1,
        nivelRiesgo: Math.max(r.incidente.nivelRiesgo || 0, nivelRiesgo),
        motivoRetiro: null,
      },
    });
    await rewardValidated(db, r.incidenteId);
  } else {
    await declareReportFalse(db, r);
    const remaining = await db.report.count({
      where: {
        incidenteId: r.incidenteId,
        estado: { notIn: ["FALSO", "RETIRADO"] },
      },
    });
    if (!remaining) {
      await db.incident.update({
        where: { id: r.incidenteId },
        data: { estado: "FALSO", publicado: false, motivoRetiro: motivo },
      });
      await db.flag.updateMany({
        where: { incidenteId: r.incidenteId, estado: "PENDIENTE" },
        data: { estado: "REVISADO" },
      });
    } else {
      const accepted = await db.report.count({
        where: {
          incidenteId: r.incidenteId,
          estado: { notIn: ["EN_REVISION", "FALSO", "RETIRADO"] },
          usuario: { correoVerificado: true },
        },
      });
      // Un aporte retenido no puede heredar la aprobación del único aporte
      // que acaba de declararse falso. Las emergencias siguen por evaluar.
      if (!accepted)
        await db.incident.update({
          where: { id: r.incidenteId },
          data: {
            estado: "PENDIENTE",
            evaluacion: "PENDIENTE",
            validacion: 0.5,
            publicado:
              r.incidente.emergencia &&
              (await canPublishIncident(db, r.incidenteId)),
            motivoRetiro: null,
          },
        });
      else if (
        !r.incidente.individual &&
        r.incidente.evaluacion !== "AGENTE" &&
        ["ACTIVO", "VALIDADO", "PENDIENTE"].includes(r.incidente.estado)
      ) {
        const rules = await config(db);
        const confirms = await db.vote.count({
          where: eligibleConfirmationWhere(r.incidenteId),
        });
        const validacion = Math.min(
          1,
          0.5 + (0.5 * confirms) / rules.confirmaciones,
        );
        await db.incident.update({
          where: { id: r.incidenteId },
          data: {
            validacion,
            estado: r.incidente.publicado
              ? validacion >= 1
                ? "VALIDADO"
                : "ACTIVO"
              : "PENDIENTE",
          },
        });
        if (validacion < 1) {
          const affected = await db.report.findMany({
            where: { incidenteId: r.incidenteId, estado: "VALIDADO" },
            select: { usuarioId: true },
          });
          await db.report.updateMany({
            where: { incidenteId: r.incidenteId, estado: "VALIDADO" },
            data: { estado: "PENDIENTE" },
          });
          for (const userId of new Set(affected.map((row) => row.usuarioId)))
            await refreshCredibility(db, userId);
        }
      }
    }
  }
  await db.review.create({
    data: {
      usuarioId: actor.id,
      incidenteId: r.incidenteId,
      accion: accion + "_REPORTE",
      motivo,
      datos: { reporteId: r.id, anterior: r.estado },
    },
  });
  await db.notification.create({
    data: {
      usuarioId: r.usuarioId,
      incidenteId: r.incidenteId,
      titulo: "Revisión del reporte #" + r.id,
      mensaje: motivo,
      tipo: "REVISION_REPORTE",
    },
  });
  return db.report.findUnique({
    where: { id: r.id },
    include: { usuario: true, adjuntos: true },
  });
}
// Recalcula solo conclusiones comunitarias. Una revisión de agente no depende
// del número de votos ni se invalida por revocar el correo a otro participante.
async function refreshVerificationEffects(db, usuarioId) {
  const rules = await config(db);
  const incidents = await db.incident.findMany({
    where: {
      OR: [
        { votos: { some: { usuarioId } } },
        { reportes: { some: { usuarioId } } },
      ],
    },
  });
  for (const row of incidents) {
    if (["FALSO", "RETIRADO"].includes(row.estado)) continue;
    const data = {};
    if (row.evaluacion !== "AGENTE" && !row.individual) {
      const confirms = await db.vote.count({
        where: eligibleConfirmationWhere(row.id),
      });
      const resolves = await db.vote.count({
        where: {
          incidenteId: row.id,
          tipo: "RESOLVER",
          usuario: { correoVerificado: true },
        },
      });
      data.validacion = Math.min(
        1,
        0.5 + (0.5 * confirms) / rules.confirmaciones,
      );
      if (
        row.estado !== "RESUELTO" ||
        row.motivoRetiro === "Resuelto por cinco vecinos"
      ) {
        data.estado =
          resolves >= rules.resoluciones
            ? "RESUELTO"
            : data.validacion >= 1
              ? "VALIDADO"
              : row.evaluacion === "PENDIENTE"
                ? "PENDIENTE"
                : "ACTIVO";
        const wasPublic =
          row.publicado ||
          (row.estado === "RESUELTO" &&
            row.motivoRetiro === "Resuelto por cinco vecinos");
        data.publicado =
          wasPublic &&
          (data.estado !== "RESUELTO" ||
            (row.historico && data.validacion >= 1));
        if (row.estado === "RESUELTO" && data.estado !== "RESUELTO")
          data.motivoRetiro = null;
      }
    }
    if (Object.keys(data).length)
      await db.incident.update({ where: { id: row.id }, data });
    if (data.validacion < 1) {
      const affected = await db.report.findMany({
        where: { incidenteId: row.id, estado: "VALIDADO" },
        select: { usuarioId: true },
      });
      await db.report.updateMany({
        where: { incidenteId: row.id, estado: "VALIDADO" },
        data: { estado: "PENDIENTE" },
      });
      for (const id of new Set(affected.map((r) => r.usuarioId)))
        await refreshCredibility(db, id);
    } else if (data.validacion >= 1 && data.estado !== "RESUELTO")
      await rewardValidated(db, row.id);
  }
}
module.exports = {
  transaction,
  award,
  credibility,
  refreshCredibility,
  rewardValidated,
  eligibleConfirmationWhere,
  alertAgents,
  notifyOwners,
  chatOpen,
  reviewIncident,
  reviewReport,
  refreshVerificationEffects,
};
