function publicUser(user) {
  return {
    id: user.id,
    nombreUsuario: user.nombreUsuario,
    nickname: user.nombreUsuario,
    credibilidad: user.reputacion,
    reputacion: user.reputacion,
    rol: user.rol,
    tipoAgente: user.tipoAgente,
  };
}
function ownUser(u) {
  return {
    ...publicUser(u),
    nombres: u.nombres,
    apellidos: u.apellidos,
    correo: u.correo,
    telefono: u.telefono,
    correoVerificado: u.correoVerificado,
    premium: u.premium,
    ocultarAnuncios: u.ocultarAnuncios,
    monedas: u.monedas,
    faltas: u.faltas,
    bloqueado: u.bloqueado,
    distrito: u.distrito,
    permisos: u.permisos,
    fechaCreacion: u.fechaCreacion,
  };
}
function attachment(a) {
  return {
    id: a.id,
    nombre: a.nombre,
    mimeType: a.mimeType,
    size: a.size,
    privado: a.privado,
    tipo: a.tipo,
    url: "/api/uploads/" + a.id,
  };
}
function report(r, privateView = false) {
  return {
    id: r.id,
    tipo: r.tipo,
    tipoId: r.tipoId,
    descripcion: r.descripcion,
    latitud: r.latitud,
    longitud: r.longitud,
    nivelRiesgo: r.nivelRiesgo,
    estado: r.estado,
    incidenteId: r.incidenteId,
    fechaEvento: r.fechaEvento,
    fechaPublicacion: r.incidente?.fechaPublicacion ?? null,
    fechaCreacion: r.fechaCreacion,
    usuario: r.usuario ? publicUser(r.usuario) : undefined,
    adjuntos: (r.adjuntos || [])
      .filter((a) => privateView || !a.privado)
      .map(attachment),
    incidente: r.incidente
      ? incident({
          ...r.incidente,
          pruebasRecibidas:
            r.incidente.pruebasRecibidas ??
            (r.usuario?.correoVerificado === true &&
              (r.adjuntos || []).some((a) => a.tipo === "EVIDENCIA")),
        })
      : undefined,
  };
}
function incident(i, privateView = false) {
  const allReports = i.reportes || [];
  const verifiedReports = allReports.filter(
    (r) => r.usuario?.correoVerificado === true,
  );
  const visibleReports = privateView ? allReports : verifiedReports;
  const votes = (i.votos || []).filter(
    (v) => v.usuario?.correoVerificado === true,
  );
  const risk = require("./risk").incidentRisk({
    ...i,
    pruebasRecibidas: Array.isArray(i.reportes)
      ? verifiedReports.some((r) =>
          (r.adjuntos || []).some((a) => a.tipo === "EVIDENCIA"),
        )
      : (i.pruebasRecibidas ?? false),
  });
  const adjuntos = visibleReports
    .flatMap((r) => r.adjuntos || [])
    .filter((a) => privateView || !a.privado)
    .map(attachment);
  return {
    id: i.id,
    tipo: i.tipo,
    tipoId: i.tipoId,
    tipoSlug: i.tipoCatalogo?.slug,
    categoria: i.tipoCatalogo?.categoria?.nombre,
    descripcion:
      !privateView && allReports.length !== verifiedReports.length
        ? (verifiedReports[0]?.descripcion ?? "")
        : i.descripcion,
    latitud: i.latitud,
    longitud: i.longitud,
    distrito: i.distrito,
    nivelRiesgo: i.nivelRiesgo,
    gravedad: i.nivelRiesgo,
    estado: i.estado,
    totalReportes:
      !privateView && allReports.length
        ? verifiedReports.length
        : (i._count?.reportes ?? i.totalReportes),
    confirmaciones: votes.filter((v) => v.tipo === "CONFIRMAR").length,
    resoluciones: votes.filter((v) => v.tipo === "RESOLVER").length,
    validacion: i.validacion,
    pesoValidacion: i.validacion,
    aportePuntos: risk.pending ? null : risk.points,
    factorAntiguedad: risk.age,
    evaluacion: i.evaluacion,
    publicado: i.publicado,
    individual: i.individual,
    historico: i.historico,
    emergencia: i.emergencia,
    persistente: i.persistente,
    fuente: i.fuente,
    motivoRetiro: i.motivoRetiro,
    fechaEvento: i.fechaEvento,
    fechaPublicacion: i.fechaPublicacion ?? null,
    fechaCreacion: i.fechaCreacion,
    fechaActualizacion: i.fechaActualizacion,
    adjuntos,
    chatAbierto: require("./workflows").chatOpen(i),
    porEvaluar: i.nivelRiesgo == null || i.evaluacion === "PENDIENTE",
    reportes: visibleReports.map((r) =>
      report({ ...r, incidente: undefined }, privateView),
    ),
    revisiones: privateView ? i.revisiones : undefined,
    flags: privateView ? i.flags : undefined,
  };
}
module.exports = { publicUser, ownUser, attachment, report, incident };
