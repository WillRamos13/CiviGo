const express = require("express");
const prisma = require("../lib/db");
const { auth, requirePermission, canReview } = require("../lib/auth");
const {
  asyncRoute,
  HttpError,
  id,
  text,
  coordinates,
  districtScope,
  slug,
  inCoverage,
} = require("../lib/http");
const { ownUser, incident, attachment } = require("../lib/projections");
const { config, validateConfig, DISTRICTS } = require("../lib/catalog");
const { services } = require("../lib/providers");
const {
  transaction,
  reviewIncident,
  refreshCredibility,
  notifyOwners,
} = require("../lib/workflows");
const { ranking, currentMonth, monthRange } = require("../lib/ranking");
const { processLifecycle } = require("../lib/lifecycle");
const router = express.Router();
router.use(auth);
const adminOnly = (req, res, next) =>
  req.user.rol === "ADMIN"
    ? next()
    : next(new HttpError(403, "Solo administradores."));
router.get("/integrations", adminOnly, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(require("../lib/integrations").integrationChecklist());
});
async function audit(db, user, accion, entidad, entidadId, datos = {}) {
  return db.auditLog.create({
    data: {
      usuarioId: user.id,
      accion,
      entidad,
      entidadId: String(entidadId),
      datos,
    },
  });
}
const permissions = [
  "revisar",
  "resolver",
  "reabrir",
  "evidencia",
  "catalogo",
  "usuarios",
  "negocios",
  "premios",
  "ranking",
];
router.get(
  "/catalog",
  adminOnly,
  asyncRoute(async (req, res) =>
    res.json({
      categorias: await prisma.category.findMany({
        include: { tipos: true },
        orderBy: { orden: "asc" },
      }),
      config: await config(),
      distritos: DISTRICTS,
      servicios: services(),
    }),
  ),
);
router.get(
  "/",
  requirePermission("revisar"),
  asyncRoute(async (req, res) => {
    const scope = districtScope(req.user);
    const [pendientes, activos, flags, usuarios, apelaciones] =
      await Promise.all([
        prisma.incident.count({ where: { ...scope, evaluacion: "PENDIENTE" } }),
        prisma.incident.count({
          where: { ...scope, estado: { in: ["ACTIVO", "VALIDADO"] } },
        }),
        prisma.flag.count({ where: { estado: "PENDIENTE", incidente: scope } }),
        req.user.rol === "ADMIN" ? prisma.user.count() : Promise.resolve(null),
        req.user.rol === "ADMIN"
          ? prisma.appeal.count({ where: { estado: "PENDIENTE" } })
          : Promise.resolve(null),
      ]);
    res.json({
      estadisticas: { pendientes, activos, flags, usuarios, apelaciones },
      servicios: services(),
      permisosDisponibles: permissions,
      demo: true,
    });
  }),
);
router.get(
  "/incidents",
  requirePermission("revisar"),
  asyncRoute(async (req, res) => {
    const rows = await prisma.incident.findMany({
      where: districtScope(req.user),
      include: {
        tipoCatalogo: { include: { categoria: true } },
        reportes: {
          include: { usuario: true, adjuntos: true },
          orderBy: { fechaCreacion: "asc" },
        },
        votos: true,
        flags: true,
        revisiones: { orderBy: { creadoEn: "desc" } },
      },
      orderBy: { fechaActualizacion: "desc" },
      take: 250,
    });
    res.json(
      rows.map((i) => {
        const view = incident(i, canReview(req.user, i, "evidencia"));
        return { ...view, flags: i.flags, revisiones: i.revisiones };
      }),
    );
  }),
);
router.post(
  "/incidents/:id/review",
  asyncRoute(async (req, res) => {
    const row = await prisma.incident.findUnique({
      where: { id: id(req.params.id) },
    });
    if (!row) throw new HttpError(404, "Incidente no encontrado.");
    const accion = req.body.accion;
    const permission =
      accion === "RESOLVER"
        ? "resolver"
        : accion === "REABRIR"
          ? "reabrir"
          : "revisar";
    if (!canReview(req.user, row, permission))
      throw new HttpError(403, "Incidente fuera de tus permisos o distrito.");
    if (
      row.individual &&
      ["VALIDAR", "FALSO"].includes(accion) &&
      !canReview(req.user, row, "evidencia")
    )
      throw new HttpError(
        403,
        "Se requiere permiso de revisar pruebas privadas.",
      );
    const result = await transaction((db) =>
      reviewIncident(db, row, req.user, {
        accion,
        motivo: text(req.body.motivo, "Motivo", 2000, 5),
        nivelRiesgo: req.body.nivelRiesgo,
      }),
    );
    res.json(incident(result));
  }),
);
router.post(
  "/incidents/:id/classify",
  requirePermission("revisar"),
  asyncRoute(async (req, res) => {
    const incidenteId = id(req.params.id),
      tipoId = id(req.body.tipoId),
      motivo = text(req.body.motivo, "Motivo", 2000, 5);
    const result = await transaction(async (db) => {
      const current = await db.incident.findUnique({
        where: { id: incidenteId },
        include: { reportes: true },
      });
      if (!current) throw new HttpError(404, "Incidente no encontrado.");
      if (!canReview(req.user, current))
        throw new HttpError(403, "Incidente fuera de tu distrito.");
      const type = await db.incidentType.findUnique({ where: { id: tipoId } });
      if (!type || !type.activo) throw new HttpError(400, "Tipo inválido.");
      if (type.individual && current.reportes.length > 1)
        throw new HttpError(
          409,
          "Un delito individual no puede conservar varios autores agrupados. Revisa cada aporte por separado.",
        );
      const data = {
        tipo: type.nombre,
        tipoId: type.id,
        individual: type.individual,
        historico: type.historico,
        emergencia: type.emergencia,
        persistente: type.persistente,
      };
      if (type.individual && !current.individual) {
        await db.vote.deleteMany({ where: { incidenteId } });
        await db.attachment.updateMany({
          where: { reporte: { incidenteId } },
          data: { privado: true, tipo: "EVIDENCIA" },
        });
        if (current.evaluacion !== "AGENTE") {
          data.validacion = 0.5;
          data.estado = "PENDIENTE";
          data.publicado = false;
        }
      }
      await db.report.updateMany({
        where: { incidenteId },
        data: { tipo: type.nombre, tipoId: type.id },
      });
      await audit(db, req.user, "RECLASIFICAR", "INCIDENTE", incidenteId, {
        tipoAnterior: current.tipo,
        tipoNuevo: type.nombre,
        motivo,
      });
      return db.incident.update({ where: { id: incidenteId }, data });
    });
    res.json(incident(result));
  }),
);
router.get(
  "/users",
  adminOnly,
  asyncRoute(async (req, res) =>
    res.json(
      (
        await prisma.user.findMany({
          orderBy: { fechaCreacion: "desc" },
          take: 500,
        })
      ).map(ownUser),
    ),
  ),
);
router.patch(
  "/users/:id",
  adminOnly,
  asyncRoute(async (req, res) => {
    const target = id(req.params.id);
    const b = req.body;
    const data = {};
    if (b.rol !== undefined) {
      if (!["USUARIO", "AGENTE", "ADMIN"].includes(b.rol))
        throw new HttpError(400, "Rol inválido.");
      data.rol = b.rol;
    }
    if (b.permisos !== undefined) {
      if (
        !Array.isArray(b.permisos) ||
        b.permisos.some((v) => !permissions.includes(v))
      )
        throw new HttpError(400, "Permisos inválidos.");
      data.permisos = [...new Set(b.permisos)];
    }
    if (b.distrito !== undefined) {
      if (b.distrito !== null && !DISTRICTS.includes(b.distrito))
        throw new HttpError(400, "Distrito inválido.");
      data.distrito = b.distrito;
    }
    if (b.tipoAgente !== undefined) {
      if (
        b.tipoAgente !== null &&
        !["POLICIA", "SERENAZGO", "COLABORADOR"].includes(b.tipoAgente)
      )
        throw new HttpError(400, "Tipo de agente inválido.");
      data.tipoAgente = b.tipoAgente;
    }
    for (const key of ["premium", "bloqueado"])
      if (b[key] !== undefined) {
        if (typeof b[key] !== "boolean")
          throw new HttpError(400, "Valor inválido.");
        data[key] = b[key];
      }
    if (
      target === req.user.id &&
      (data.bloqueado || (data.rol && data.rol !== "ADMIN"))
    )
      throw new HttpError(
        409,
        "No puedes retirar tu propio acceso administrativo.",
      );
    const result = await transaction(async (db) => {
      const existing = await db.user.findUnique({ where: { id: target } });
      if (!existing) throw new HttpError(404, "Usuario no encontrado.");
      if (
        (data.rol || existing.rol) === "AGENTE" &&
        (data.tipoAgente ?? existing.tipoAgente) !== "COLABORADOR" &&
        !(data.distrito ?? existing.distrito)
      )
        throw new HttpError(400, "Asigna un distrito al agente.");
      const u = await db.user.update({ where: { id: target }, data });
      if (!u.premium && u.ocultarAnuncios)
        await db.user.update({
          where: { id: target },
          data: { ocultarAnuncios: false },
        });
      await audit(db, req.user, "ACTUALIZAR", "USUARIO", target, data);
      return u;
    });
    res.json({ usuario: ownUser(result) });
  }),
);
router.get(
  "/config",
  adminOnly,
  asyncRoute(async (req, res) => res.json(await config())),
);
router.patch(
  "/config",
  adminOnly,
  asyncRoute(async (req, res) => {
    const changes = validateConfig(req.body);
    const valor = { ...(await config()), ...changes };
    await prisma.appConfig.upsert({
      where: { clave: "reglas" },
      update: { valor },
      create: { clave: "reglas", valor },
    });
    await audit(prisma, req.user, "ACTUALIZAR", "CONFIG", "reglas", changes);
    res.json(valor);
  }),
);
router.post(
  "/categories",
  adminOnly,
  asyncRoute(async (req, res) => {
    const nombre = text(req.body.nombre, "Nombre", 100);
    const row = await prisma.category.create({
      data: {
        nombre,
        slug: slug(req.body.slug || nombre),
        orden: Number.isInteger(req.body.orden) ? req.body.orden : 0,
      },
    });
    await audit(prisma, req.user, "CREAR", "CATEGORIA", row.id, { nombre });
    res.status(201).json(row);
  }),
);
router.patch(
  "/categories/:id",
  adminOnly,
  asyncRoute(async (req, res) => {
    const data = {};
    if (req.body.nombre) data.nombre = text(req.body.nombre, "Nombre", 100);
    if (req.body.orden !== undefined) {
      if (!Number.isInteger(req.body.orden))
        throw new HttpError(400, "Orden inválido.");
      data.orden = req.body.orden;
    }
    const row = await prisma.category.update({
      where: { id: id(req.params.id) },
      data,
    });
    await audit(prisma, req.user, "ACTUALIZAR", "CATEGORIA", row.id, data);
    res.json(row);
  }),
);
function typeData(b, create = false) {
  const data = {};
  if (b.nombre !== undefined || create)
    data.nombre = text(b.nombre, "Nombre", 100);
  if (create) data.slug = slug(b.slug || data.nombre);
  if (b.categoriaId !== undefined || create)
    data.categoriaId = id(b.categoriaId);
  for (const field of [
    "emergencia",
    "historico",
    "fotoObligatoria",
    "individual",
    "ubicacionRemota",
    "persistente",
    "activo",
  ])
    if (b[field] !== undefined) {
      if (typeof b[field] !== "boolean")
        throw new HttpError(400, "Regla inválida: " + field);
      data[field] = b[field];
    }
  return data;
}
async function validateType(db, data, existing = {}) {
  const values = { ubicacionRemota: false, ...existing, ...data };
  if (values.individual && !values.ubicacionRemota)
    throw new HttpError(400, "Un delito individual requiere ubicación remota.");
  if (data.slug !== undefined && !data.slug)
    throw new HttpError(
      400,
      "El nombre del tipo debe permitir un identificador válido.",
    );
  if (
    data.categoriaId !== undefined &&
    !(await db.category.findUnique({ where: { id: data.categoriaId } }))
  )
    throw new HttpError(400, "Categoría no encontrada.");
}
router.post(
  "/types",
  adminOnly,
  asyncRoute(async (req, res) => {
    const data = typeData(req.body, true);
    const row = await transaction(async (db) => {
      await validateType(db, data);
      const created = await db.incidentType.create({ data });
      await audit(db, req.user, "CREAR", "TIPO", created.id, data);
      return created;
    });
    res.status(201).json(row);
  }),
);
router.patch(
  "/types/:id",
  adminOnly,
  asyncRoute(async (req, res) => {
    const data = typeData(req.body);
    const row = await transaction(async (db) => {
      const where = { id: id(req.params.id) };
      const existing = await db.incidentType.findUnique({ where });
      if (!existing) throw new HttpError(404, "Tipo no encontrado.");
      await validateType(db, data, existing);
      const updated = await db.incidentType.update({ where, data });
      await audit(db, req.user, "ACTUALIZAR", "TIPO", updated.id, data);
      return updated;
    });
    res.json(row);
  }),
);
router.get(
  "/appeals",
  adminOnly,
  asyncRoute(async (req, res) => {
    const rows = await prisma.appeal.findMany({
      include: { usuario: true, reporte: { include: { incidente: true } } },
      orderBy: { creadoEn: "desc" },
      take: 100,
    });
    res.json(rows.map((a) => ({ ...a, usuario: ownUser(a.usuario) })));
  }),
);
router.post(
  "/appeals/:id",
  adminOnly,
  asyncRoute(async (req, res) => {
    const estado = req.body.estado;
    if (!["ACEPTADA", "RECHAZADA"].includes(estado))
      throw new HttpError(400, "Decisión inválida.");
    const respuesta = text(req.body.respuesta, "Respuesta", 2000, 5);
    const row = await transaction(async (db) => {
      const a = await db.appeal.findUnique({
        where: { id: id(req.params.id) },
        include: { reporte: { include: { incidente: true } } },
      });
      if (!a || a.estado !== "PENDIENTE")
        throw new HttpError(409, "Apelación ya revisada o inexistente.");
      if (estado === "ACEPTADA") {
        const afectados =
          a.reporte.estado === "FALSO"
            ? await db.report.findMany({
                where: {
                  ...(a.reporte.incidenteId
                    ? { incidenteId: a.reporte.incidenteId }
                    : { id: a.reporteId }),
                  estado: "FALSO",
                },
              })
            : [a.reporte];
        if (a.reporte.estado === "FALSO") {
          for (const usuarioId of new Set(
            afectados.map((report) => report.usuarioId),
          )) {
            const user = await db.user.findUnique({ where: { id: usuarioId } });
            const manual = await db.auditLog.findFirst({
              where: {
                accion: "ACTUALIZAR",
                entidad: "USUARIO",
                entidadId: String(usuarioId),
                OR: [
                  { datos: { path: ["bloqueado"], equals: true } },
                  { datos: { path: ["bloqueado"], equals: false } },
                ],
              },
              orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
            });
            const bloqueoManual = manual
              ? manual.datos.bloqueado
              : user.bloqueado && user.faltas < 4;
            const faltas = Math.max(0, user.faltas - 1);
            await db.user.update({
              where: { id: usuarioId },
              data: { faltas, bloqueado: bloqueoManual || faltas >= 4 },
            });
            await audit(
              db,
              req.user,
              "REVERTIR_SANCION_FALSO",
              "USUARIO",
              usuarioId,
              {
                incidenteId: a.reporte.incidenteId,
                apelacionId: a.id,
                faltasAnteriores: user.faltas,
                faltas,
                bloqueoManual,
              },
            );
          }
        }
        await db.report.updateMany({
          where: { id: { in: afectados.map((report) => report.id) } },
          data: { estado: "PENDIENTE" },
        });
        await db.appeal.updateMany({
          where: {
            reporteId: { in: afectados.map((report) => report.id) },
            estado: "PENDIENTE",
          },
          data: { estado: "ACEPTADA", respuesta },
        });
        if (a.reporte.incidenteId)
          await db.incident.update({
            where: { id: a.reporte.incidenteId },
            data: {
              estado: "PENDIENTE",
              publicado: a.reporte.incidente.emergencia,
              fechaPublicacion: a.reporte.incidente.emergencia
                ? new Date()
                : null,
              evaluacion: "PENDIENTE",
              validacion: 0.5,
              motivoRetiro: null,
            },
          });
        for (const usuarioId of new Set(
          afectados.map((report) => report.usuarioId),
        ))
          await refreshCredibility(db, usuarioId);
        if (a.reporte.incidente)
          await notifyOwners(
            db,
            a.reporte.incidente,
            "Apelación aceptada",
            respuesta,
          );
      }
      await audit(db, req.user, estado, "APELACION", a.id, { respuesta });
      return db.appeal.update({
        where: { id: a.id },
        data: { estado, respuesta },
      });
    });
    res.json(row);
  }),
);
router.get(
  "/recoveries",
  adminOnly,
  asyncRoute(async (req, res) => {
    const rows = await prisma.recovery.findMany({
      include: { usuario: true },
      orderBy: { creadoEn: "desc" },
    });
    res.json(
      rows.map((r) => ({
        ...r,
        usuario: ownUser(r.usuario),
        documento: r.adjuntoId ? { url: "/api/uploads/" + r.adjuntoId } : null,
      })),
    );
  }),
);
router.post(
  "/recoveries/:id",
  adminOnly,
  asyncRoute(async (req, res) => {
    const estado = req.body.estado;
    if (!["ACEPTADA", "RECHAZADA"].includes(estado))
      throw new HttpError(400, "Decisión inválida.");
    const result = await transaction(async (db) => {
      const row = await db.recovery.findUnique({
        where: { id: id(req.params.id) },
      });
      if (!row || row.estado !== "PENDIENTE")
        throw new HttpError(409, "Solicitud ya revisada o inexistente.");
      if (estado === "ACEPTADA") {
        await db.user.update({
          where: { id: row.usuarioId },
          data: { telefono: row.telefonoNuevo, telefonoVerificado: false },
        });
        await db.session.deleteMany({ where: { usuarioId: row.usuarioId } });
      }
      await audit(db, req.user, estado, "RECUPERACION", row.id);
      return db.recovery.update({ where: { id: row.id }, data: { estado } });
    });
    res.json(result);
  }),
);
function businessData(b, create = false) {
  const data = {};
  for (const key of ["nombre", "descripcion", "direccion"])
    if (b[key] !== undefined || create) data[key] = text(b[key], key, 500);
  for (const key of ["horario", "telefono"])
    if (b[key] !== undefined) data[key] = String(b[key] ?? "").slice(0, 150);
  if (b.sitioWeb !== undefined) {
    if (b.sitioWeb && !/^https?:\/\//i.test(b.sitioWeb))
      throw new HttpError(400, "URL inválida.");
    data.sitioWeb = b.sitioWeb || null;
  }
  if (create || b.latitud !== undefined || b.longitud !== undefined)
    Object.assign(data, coordinates(b.latitud, b.longitud));
  if (b.activo !== undefined) {
    if (typeof b.activo !== "boolean")
      throw new HttpError(400, "Estado inválido.");
    data.activo = b.activo;
  }
  data.demo = true;
  return data;
}
router.get(
  "/businesses",
  adminOnly,
  asyncRoute(async (req, res) =>
    res.json(
      await prisma.business.findMany({
        include: { _count: { select: { impresiones: true } } },
        orderBy: { id: "desc" },
      }),
    ),
  ),
);
router.post(
  "/businesses",
  adminOnly,
  asyncRoute(async (req, res) => {
    const data = businessData(req.body, true);
    const row = await prisma.business.create({ data });
    await audit(prisma, req.user, "CREAR", "NEGOCIO", row.id, data);
    res.status(201).json(row);
  }),
);
router.patch(
  "/businesses/:id",
  adminOnly,
  asyncRoute(async (req, res) => {
    const data = businessData(req.body);
    const row = await prisma.business.update({
      where: { id: id(req.params.id) },
      data,
    });
    await audit(prisma, req.user, "ACTUALIZAR", "NEGOCIO", row.id, data);
    res.json(row);
  }),
);
function rewardData(b, create = false) {
  const data = { demo: true };
  for (const key of ["nombre", "descripcion"])
    if (b[key] !== undefined || create) data[key] = text(b[key], key, 500);
  if (b.costoMonedas !== undefined || create) {
    if (
      typeof b.costoMonedas !== "number" ||
      !Number.isFinite(b.costoMonedas) ||
      b.costoMonedas <= 0 ||
      b.costoMonedas > 1e6
    )
      throw new HttpError(400, "Costo inválido.");
    data.costoMonedas = b.costoMonedas;
  }
  if (b.stock !== undefined || create) {
    if (!Number.isInteger(b.stock) || b.stock < 0 || b.stock > 1e6)
      throw new HttpError(400, "Stock inválido.");
    data.stock = b.stock;
  }
  if (b.activo !== undefined) {
    if (typeof b.activo !== "boolean")
      throw new HttpError(400, "Estado inválido.");
    data.activo = b.activo;
  }
  return data;
}
router.get(
  "/rewards",
  adminOnly,
  asyncRoute(async (req, res) =>
    res.json(await prisma.reward.findMany({ orderBy: { id: "desc" } })),
  ),
);
router.post(
  "/rewards",
  adminOnly,
  asyncRoute(async (req, res) => {
    const data = rewardData(req.body, true);
    const row = await prisma.reward.create({ data });
    await audit(prisma, req.user, "CREAR", "PREMIO", row.id, data);
    res.status(201).json(row);
  }),
);
router.patch(
  "/rewards/:id",
  adminOnly,
  asyncRoute(async (req, res) => {
    const data = rewardData(req.body);
    const row = await prisma.reward.update({
      where: { id: id(req.params.id) },
      data,
    });
    await audit(prisma, req.user, "ACTUALIZAR", "PREMIO", row.id, data);
    res.json(row);
  }),
);
router.get(
  "/redemptions",
  adminOnly,
  asyncRoute(async (req, res) => {
    const rows = await prisma.redemption.findMany({
      include: { usuario: true, recompensa: true },
      orderBy: { creadoEn: "desc" },
    });
    res.json(rows.map((r) => ({ ...r, usuario: ownUser(r.usuario) })));
  }),
);
router.post(
  "/redemptions/:id",
  adminOnly,
  asyncRoute(async (req, res) => {
    const estado = req.body.estado;
    if (!["APROBADO_DEMO", "CANCELADO"].includes(estado))
      throw new HttpError(400, "Estado de canje inválido.");
    const result = await transaction(async (db) => {
      const r = await db.redemption.findUnique({
        where: { id: id(req.params.id) },
      });
      if (!r || r.estado !== "SOLICITADO_DEMO")
        throw new HttpError(409, "Canje ya revisado o inexistente.");
      if (estado === "CANCELADO") {
        await db.user.update({
          where: { id: r.usuarioId },
          data: { monedas: { increment: r.costoMonedas } },
        });
        await db.reward.update({
          where: { id: r.recompensaId },
          data: { stock: { increment: 1 } },
        });
      }
      await audit(db, req.user, estado, "CANJE", r.id);
      return db.redemption.update({ where: { id: r.id }, data: { estado } });
    });
    res.json(result);
  }),
);
router.post(
  "/ranking/settle",
  adminOnly,
  asyncRoute(async (req, res) => {
    const mes = req.body.mes;
    monthRange(mes);
    if (mes >= currentMonth())
      throw new HttpError(400, "Solo puede cerrar un mes terminado.");
    const result = await transaction(async (db) => {
      if (await db.rankingSettlement.findUnique({ where: { id: mes } }))
        throw new HttpError(409, "El mes ya se cerró.");
      const data = await ranking(mes, db);
      for (const entry of data.entries) {
        if (entry.monedasEstimadas > 0)
          await db.user.update({
            where: { id: entry.usuarioId },
            data: { monedas: { increment: entry.monedasEstimadas } },
          });
      }
      await audit(db, req.user, "CERRAR", "RANKING", mes);
      return db.rankingSettlement.create({ data: { id: mes, datos: data } });
    });
    res.json(result);
  }),
);
router.post(
  "/lifecycle/run",
  adminOnly,
  asyncRoute(async (req, res) => res.json(await processLifecycle())),
);
router.get(
  "/audit",
  adminOnly,
  asyncRoute(async (req, res) =>
    res.json(
      await prisma.auditLog.findMany({
        orderBy: { creadoEn: "desc" },
        take: 200,
      }),
    ),
  ),
);
module.exports = router;
module.exports.permissions = permissions;
