// Los incidentes administrativos sin aportes ciudadanos conservan su visibilidad.
// Una agrupación ciudadana necesita al menos un autor con correo verificado.
function publicIncidentEligibility({ includeRetired = false } = {}) {
  return {
    OR: [
      { reportes: { none: {} } },
      {
        reportes: {
          some: {
            estado: {
              notIn: includeRetired ? ["FALSO"] : ["FALSO", "RETIRADO"],
            },
            usuario: { correoVerificado: true },
          },
        },
      },
    ],
  };
}

async function canPublishIncident(db, incidenteId, options) {
  return (
    (await db.incident.count({
      where: { id: incidenteId, ...publicIncidentEligibility(options) },
    })) > 0
  );
}

function verifiedVoteInclude() {
  return {
    where: { usuario: { correoVerificado: true } },
    include: { usuario: { select: { correoVerificado: true } } },
  };
}

module.exports = {
  publicIncidentEligibility,
  canPublishIncident,
  verifiedVoteInclude,
};
