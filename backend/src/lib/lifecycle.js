const prisma = require("./db");
const { sendEmail, services } = require("./providers");
const { alertAgents, transaction } = require("./workflows");
async function processLifecycle(now = new Date(), db = prisma) {
  const reports = await db.report.findMany({
    where: {
      incidente: { individual: true, publicado: true, validacion: { lt: 1 } },
      estado: { notIn: ["FALSO", "RETIRADO"] },
    },
    include: {
      usuario: true,
      incidente: true,
      adjuntos: { where: { tipo: "EVIDENCIA" } },
    },
  });
  let reminders = 0,
    expired = 0,
    reduced = 0;
  for (const r of reports) {
    const days =
      (now - (r.incidente.fechaPublicacion || r.incidente.fechaCreacion)) /
      86400000;
    const i = r.incidente;
    if (days >= 1 && !r.recordatorioEnviado && services().correo.configurado) {
      const sent = await sendEmail(
        r.usuario.correo,
        "Aporta pruebas para tu reporte de CiviGo",
        "<p>Tienes un reporte pendiente de validación. Entra a CiviGo y adjunta pruebas privadas antes de siete días desde la publicación. Solo personal autorizado puede revisarlas.</p>",
      );
      if (sent) {
        await db.report.update({
          where: { id: r.id },
          data: { recordatorioEnviado: true },
        });
        reminders++;
      }
    }
    if (days < 3) continue;
    const execute =
      db === prisma
        ? transaction
        : (work) =>
            db.$transaction(work, {
              isolationLevel: "Serializable",
              maxWait: 10000,
              timeout: 60000,
            });
    const changed = await execute(async (tx) => {
      // Relee la validación y las pruebas dentro de la misma transacción que
      // modifica el estado: una evaluación humana concurrente tiene prioridad.
      const current = await tx.report.findUnique({
        where: { id: r.id },
        include: {
          incidente: true,
          adjuntos: { where: { tipo: "EVIDENCIA" } },
        },
      });
      if (
        !current ||
        !current.incidente?.publicado ||
        current.incidente.validacion >= 1 ||
        ["FALSO", "RETIRADO", "RESUELTO"].includes(current.estado) ||
        ["FALSO", "RETIRADO", "RESUELTO"].includes(current.incidente.estado)
      )
        return null;
      const incident = current.incidente;
      const currentDays =
        (now - (incident.fechaPublicacion || incident.fechaCreacion)) /
        86400000;
      if (currentDays < 3) return null;
      if (!current.adjuntos.length) {
        if (currentDays >= 7) {
          await tx.incident.update({
            where: { id: incident.id },
            data: {
              estado: "RETIRADO",
              publicado: false,
              validacion: 0,
              motivoRetiro: "Sin pruebas dentro de siete días",
            },
          });
          await tx.report.update({
            where: { id: current.id },
            data: { estado: "RETIRADO" },
          });
          return "expired";
        }
        if (incident.validacion > 0.25) {
          await tx.incident.update({
            where: { id: incident.id },
            data: { validacion: 0.25 },
          });
          return "reduced";
        }
      } else if (currentDays >= 7) {
        const prior = await tx.notification.findFirst({
          where: {
            incidenteId: incident.id,
            titulo: "Pruebas presentadas pendientes",
          },
        });
        if (!prior)
          await alertAgents(
            tx,
            incident,
            "Pruebas presentadas pendientes",
            "Las pruebas se entregaron; requieren revisión humana y no se retira por demora del personal.",
          );
      }
      return null;
    });
    if (changed === "expired") expired++;
    if (changed === "reduced") reduced++;
  }
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.verification.deleteMany({
    where: { expiresAt: { lt: new Date(+now - 86400000) } },
  });
  return { reminders, expired, reduced };
}
module.exports = { processLifecycle };
