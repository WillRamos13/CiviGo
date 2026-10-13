// The former `revisar` grant bundled these decisions. Expand it at the boundary
// so existing accounts keep their access while edited accounts use explicit grants.
const legacyReview = [
  "consultar",
  "validar",
  "gravedad",
  "clasificar",
  "falsedad",
  "avisos",
];
const agentPermissions = [
  {
    key: "consultar",
    label: "Consultar incidentes y reportes",
    description: "Leer los incidentes de su ámbito sin registrar decisiones.",
  },
  {
    key: "validar",
    label: "Validar incidentes y aportes",
    description: "Aprobar reportes después de la revisión humana.",
  },
  {
    key: "gravedad",
    label: "Ajustar gravedad",
    description: "Corregir la gravedad de un incidente entre 1 y 5.",
  },
  {
    key: "clasificar",
    label: "Reclasificar el tipo de incidente",
    description:
      "Cambiar el tipo conservando las reglas de agrupación y privacidad.",
  },
  {
    key: "falsedad",
    label: "Declarar reportes falsos",
    description:
      "Registrar una falta únicamente después de revisar las pruebas y justificarla.",
  },
  {
    key: "avisos",
    label: "Atender avisos ciudadanos",
    description:
      "Registrar la revisión de solicitudes de falsedad o incidente no encontrado.",
  },
  {
    key: "resolver",
    label: "Resolver incidentes",
    description: "Marcar un incidente como resuelto.",
  },
  {
    key: "reabrir",
    label: "Reabrir incidentes",
    description: "Reabrir incidentes resueltos o retirados cuando corresponda.",
  },
  {
    key: "evidencia",
    label: "Consultar pruebas privadas",
    description:
      "Acceder a archivos privados; no concede permiso para validar o sancionar.",
  },
  {
    key: "moderar",
    label: "Moderar conversaciones",
    description:
      "Retirar y restaurar mensajes inapropiados con motivo y registro de auditoría.",
  },
];
const permissionKeys = agentPermissions.map(({ key }) => key);
function effectivePermissions(grants = []) {
  if (!Array.isArray(grants)) return [];
  const result = [
    ...new Set(
      grants.flatMap((grant) =>
        grant === "revisar"
          ? legacyReview
          : permissionKeys.includes(grant)
            ? [grant]
            : [],
      ),
    ),
  ];
  // Operational grants need the incident workspace, never extra decisions.
  if (result.length && !result.includes("consultar"))
    result.unshift("consultar");
  return result;
}
function permissionForReview(action) {
  const actions = {
    VALIDAR: "validar",
    GRAVEDAD: "gravedad",
    FALSO: "falsedad",
    RESOLVER: "resolver",
    REABRIR: "reabrir",
    RETIRAR_PUNTOS: "admin",
  };
  return typeof action === "string" && Object.hasOwn(actions, action)
    ? actions[action]
    : undefined;
}
module.exports = {
  agentPermissions,
  permissionKeys,
  effectivePermissions,
  permissionForReview,
};
