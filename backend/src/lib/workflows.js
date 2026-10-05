const prisma = require("./db");
const { config } = require("./catalog");
const { HttpError } = require("./http");
const { canReview } = require("./auth");
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
async function rewardValidated(db, incidenteId) {
  const rules = await config(db);
  const reports = await db.report.findMany({
    where: { incidenteId, usuario: { correoVerificado: true } },
    orderBy: { fechaCreacion: "asc" },
    include: {
      adjuntos: {
        where: { tipo: { in: ["EVIDENCIA", "PUBLICO"] } },
        select: { id: true },
      },
    },
  });
  const votes = await db.vote.findMany({
    where: {
      incidenteId,
      tipo: "CONFIRMAR",
      usuario: { correoVerificado: true },
    },
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
  const previousWithdrawal = await db.auditLog.findFirst({
    where: {
      accion: "ANULAR_PUNTOS_FALSO",
      entidad: "INCIDENTE",
      entidadId: String(incidenteId),
    },
    orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
  });
  const originals = new Map(
    (previousWithdrawal?.datos?.puntosAnulados || []).map((point) => [
      point.clave,
      point,
    ]),
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
      await refreshCredibility(db, r.usuarioId);
    }
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
  const permission =
    accion === "RESOLVER"
      ? "resolver"
      : accion === "REABRIR"
        ? "reabrir"
        : "revisar";
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
    for (const uid of new Set(reports.map((r) => r.usuarioId))) {
      await db.user.update({
        where: { id: uid },
        data: { faltas: { increment: 1 } },
      });
      await refreshCredibility(db, uid);
    }
    await db.report.updateMany({
      where: { incidenteId: incident.id },
      data: { estado: "FALSO" },
    });
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
    if (!(await canPublishIncident(db, incident.id)))
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
module.exports = {
  transaction,
  award,
  credibility,
  refreshCredibility,
  rewardValidated,
  alertAgents,
  notifyOwners,
  chatOpen,
  reviewIncident,
};
