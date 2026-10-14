"use strict";

const { createHash, randomUUID, randomInt } = require("node:crypto");
const { hashPassword, verifyPassword } = require("./password");
const { permissionKeys } = require("./agent-permissions");

// An operator-only reset. This module is never imported by the web server or seed.
const SNAPSHOT_FORMAT = "civigo-data-reset-snapshot/v1";
const INPUT_FORMAT = "civigo-explicit-reset/v1";
const legacyTableNames = Object.freeze([
  "AuthSession",
  "IncidentConfirmation",
  "ReportComment",
  "ReportConfirmation",
]);
const snapshotTables = Object.freeze(
  [
    ["User", "user", "id"],
    ["Session", "session", "id"],
    ["Verification", "verification", "id"],
    ["Category", "category", "id"],
    ["IncidentType", "incidentType", "id"],
    ["Report", "report", "id"],
    ["Incident", "incident", "id"],
    ["UsageCounter", "usageCounter", "clave"],
    ["Attachment", "attachment", "id"],
    ["Vote", "vote", "id"],
    ["ChatMessage", "chatMessage", "id"],
    ["Notification", "notification", "id"],
    ["Flag", "flag", "id"],
    ["Review", "review", "id"],
    ["Appeal", "appeal", "id"],
    ["Recovery", "recovery", "id"],
    ["PointEvent", "pointEvent", "id"],
    ["RankingSettlement", "rankingSettlement", "id"],
    ["Reward", "reward", "id"],
    ["Redemption", "redemption", "id"],
    ["Business", "business", "id"],
    ["MapAnnouncement", "mapAnnouncement", "id"],
    ["ExternalTrafficModeration", "externalTrafficModeration", "id"],
    ["ExternalApiUsage", "externalApiUsage", "id"],
    ["AdImpression", "adImpression", "id"],
    ["RouteFavorite", "routeFavorite", "id"],
    ["RouteHistory", "routeHistory", "id"],
    ["AuditLog", "auditLog", "id"],
    ["AppConfig", "appConfig", "clave"],
  ].map(Object.freeze),
);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function stableSerialize(value) {
  function normalize(item) {
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(item[key])]),
      );
    return item;
  }
  return JSON.stringify(normalize(value));
}

function fingerprint(value) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function fingerprintSnapshotState(snapshot) {
  const legacy = snapshot.legacyTables || {};
  return fingerprint(
    Object.keys(legacy).length
      ? { tables: snapshot.tables, legacyTables: legacy }
      : snapshot.tables,
  );
}

function criticalStateFingerprint(tables, legacyTables = {}) {
  const oldUserIds = new Set((tables.User || []).map(({ id }) => String(id)));
  const critical = { ...tables };
  // Provider counters continue to record paid usage across the reset. Changes to
  // these untouched counters must not invalidate an otherwise current backup.
  delete critical.ExternalApiUsage;
  critical.UsageCounter = (tables.UsageCounter || []).filter(({ clave }) => {
    const match = /^uploads:([1-9]\d*):/.exec(clave);
    return match && oldUserIds.has(match[1]);
  });
  return Object.keys(legacyTables).length
    ? fingerprint({ tables: critical, legacyTables })
    : fingerprint(critical);
}

function fingerprintSnapshotCriticalState(snapshot) {
  return criticalStateFingerprint(snapshot.tables, snapshot.legacyTables);
}

function connectionIdentity(connection) {
  let url;
  try {
    url = new URL(connection);
  } catch {
    fail("RESET_TARGET", "Conexión PostgreSQL inválida.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname ||
    url.pathname === "/"
  )
    fail("RESET_TARGET", "Conexión PostgreSQL inválida.");
  const schemas = url.searchParams.getAll("schema");
  if (schemas.length > 1 || (schemas.length && schemas[0] !== "public"))
    fail(
      "RESET_TARGET",
      "El reinicio explícito sólo admite el esquema public.",
    );
  // Credentials and tuning options are deliberately excluded from the identity.
  return {
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.slice(1)),
    role: decodeURIComponent(url.username),
    schema: "public",
  };
}

function identityFingerprint(connection) {
  return fingerprint(connectionIdentity(connection));
}

function assertModelInventory(
  models = require("@prisma/client").Prisma.dmmf.datamodel.models,
) {
  const expected = snapshotTables.map(([table]) => table).sort();
  const actual = models.map(({ name }) => name).sort();
  if (stableSerialize(actual) !== stableSerialize(expected))
    fail(
      "RESET_SCHEMA_CHANGED",
      "El esquema cambió; revisa el respaldo y las relaciones antes de reiniciar.",
    );
}

async function readTables(database) {
  const tables = {};
  for (const [table, delegate, primaryKey] of snapshotTables) {
    if (!database[delegate]?.findMany)
      fail("RESET_SCHEMA_CHANGED", "Falta un modelo del respaldo.");
    tables[table] = await database[delegate].findMany({
      orderBy: { [primaryKey]: "asc" },
    });
  }
  return tables;
}

async function discoverLegacyTables(database) {
  const rows = await database.$queryRawUnsafe(
    `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN ('AuthSession', 'IncidentConfirmation', 'ReportComment', 'ReportConfirmation') ORDER BY tablename`,
  );
  const names = rows.map(({ tablename }) => tablename);
  if (names.some((name) => !legacyTableNames.includes(name)))
    fail(
      "RESET_SCHEMA_CHANGED",
      "La base contiene una tabla histórica no reconocida.",
    );
  // Prisma's model inventory cannot reveal tables retained by an older schema.
  // Refuse an unknown inbound FK instead of relying on a destructive attempt.
  const relations = await database.$queryRawUnsafe(
    `SELECT DISTINCT child.relname AS child, child_schema.nspname AS schema_name FROM pg_catalog.pg_constraint relation JOIN pg_catalog.pg_class child ON child.oid = relation.conrelid JOIN pg_catalog.pg_namespace child_schema ON child_schema.oid = child.relnamespace WHERE relation.contype = 'f' AND relation.confrelid IN ('public."User"'::regclass, 'public."Report"'::regclass, 'public."Incident"'::regclass, 'public."Attachment"'::regclass) ORDER BY child_schema.nspname, child.relname`,
  );
  const known = new Set([
    ...snapshotTables.map(([table]) => table),
    ...legacyTableNames,
  ]);
  if (
    relations.some(
      ({ child, schema_name }) => schema_name !== "public" || !known.has(child),
    )
  )
    fail(
      "RESET_SCHEMA_CHANGED",
      "Hay una relación histórica adicional que debe incluirse en el respaldo antes de reiniciar.",
    );
  return names;
}

async function readLegacyTables(database, names) {
  const tables = {};
  for (const name of names) {
    if (!legacyTableNames.includes(name))
      fail("RESET_SCHEMA_CHANGED", "Tabla histórica no permitida.");
    const rows = await database.$queryRawUnsafe(
      'SELECT to_jsonb(legacy_row) AS datos FROM public."' +
        name +
        '" legacy_row ORDER BY to_jsonb(legacy_row)::text',
    );
    tables[name] = rows.map(({ datos }) => datos);
  }
  return tables;
}

async function captureResetSnapshot(
  database,
  { connection, now = new Date(), locked = false } = {},
) {
  assertModelInventory();
  const collect = async (db) => {
    const tables = await readTables(db);
    const legacyTables = await readLegacyTables(
      db,
      await discoverLegacyTables(db),
    );
    const snapshot = {
      format: SNAPSHOT_FORMAT,
      capturedAt: now.toISOString(),
      targetFingerprint: identityFingerprint(connection),
      tables,
      legacyTables,
    };
    snapshot.stateFingerprint = fingerprintSnapshotState(snapshot);
    snapshot.criticalStateFingerprint =
      fingerprintSnapshotCriticalState(snapshot);
    return snapshot;
  };
  return locked
    ? collect(database)
    : database.$transaction(collect, {
        isolationLevel: "Serializable",
        maxWait: 10000,
        timeout: 60000,
      });
}

function validateSnapshot(snapshot, connection, { expectedLegacyTables } = {}) {
  if (
    !snapshot ||
    snapshot.format !== SNAPSHOT_FORMAT ||
    !Number.isFinite(+new Date(snapshot.capturedAt)) ||
    snapshot.targetFingerprint !== identityFingerprint(connection)
  )
    fail(
      "RESET_BACKUP",
      "El respaldo no pertenece a la base seleccionada o está incompleto.",
    );
  const required = snapshotTables.map(([table]) => table);
  if (
    !snapshot.tables ||
    stableSerialize(Object.keys(snapshot.tables).sort()) !==
      stableSerialize(required.sort()) ||
    required.some((table) => !Array.isArray(snapshot.tables[table]))
  )
    fail(
      "RESET_BACKUP",
      "El respaldo debe incluir todos los modelos completos.",
    );
  const legacy = snapshot.legacyTables || {};
  if (
    typeof legacy !== "object" ||
    Array.isArray(legacy) ||
    Object.keys(legacy).some(
      (table) =>
        !legacyTableNames.includes(table) || !Array.isArray(legacy[table]),
    ) ||
    (expectedLegacyTables &&
      stableSerialize(Object.keys(legacy).sort()) !==
        stableSerialize([...expectedLegacyTables].sort()))
  )
    fail(
      "RESET_BACKUP",
      "El respaldo debe incluir todas las tablas históricas presentes en la base.",
    );
  if (snapshot.stateFingerprint !== fingerprintSnapshotState(snapshot))
    fail(
      "RESET_BACKUP",
      "El contenido del respaldo no coincide con su huella.",
    );
  if (
    snapshot.criticalStateFingerprint &&
    snapshot.criticalStateFingerprint !==
      fingerprintSnapshotCriticalState(snapshot)
  )
    fail(
      "RESET_BACKUP",
      "Las relaciones del respaldo no coinciden con su huella.",
    );
  return snapshot;
}

function validateInput(input) {
  if (
    !input ||
    input.format !== INPUT_FORMAT ||
    !Array.isArray(input.accounts) ||
    input.accounts.length !== 5
  )
    fail(
      "RESET_INPUT",
      "El archivo privado debe contener cuatro administradores y un colaborador.",
    );
  const emails = new Set(),
    names = new Set();
  const accounts = input.accounts.map((account) => {
    if (
      !account ||
      typeof account !== "object" ||
      Object.keys(account).some(
        (key) =>
          ![
            "correo",
            "password",
            "nombreUsuario",
            "nombres",
            "apellidos",
            "rol",
            "tipoAgente",
          ].includes(key),
      )
    )
      fail("RESET_INPUT", "La cuenta contiene campos no permitidos.");
    const correo =
      typeof account.correo === "string"
        ? account.correo.trim().toLowerCase()
        : "";
    const nombreUsuario =
      typeof account.nombreUsuario === "string"
        ? account.nombreUsuario.trim()
        : "";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ||
      correo.length > 254 ||
      !/^[\p{L}\p{N}_.-]{3,32}$/u.test(nombreUsuario) ||
      emails.has(correo) ||
      names.has(nombreUsuario)
    )
      fail("RESET_INPUT", "Los correos y nombres deben ser válidos y únicos.");
    if (
      typeof account.password !== "string" ||
      account.password.length < 8 ||
      account.password.length > 128
    )
      fail(
        "RESET_INPUT",
        "La contraseña de una cuenta no tiene una longitud admitida.",
      );
    if (
      !["ADMIN", "AGENTE"].includes(account.rol) ||
      (account.rol === "AGENTE" && account.tipoAgente !== "COLABORADOR") ||
      (account.rol === "ADMIN" && account.tipoAgente != null)
    )
      fail(
        "RESET_INPUT",
        "Sólo se admiten administradores y el agente colaborador.",
      );
    emails.add(correo);
    names.add(nombreUsuario);
    const nombres = account.nombres == null ? nombreUsuario : account.nombres;
    const apellidos = account.apellidos == null ? "" : account.apellidos;
    if (
      typeof nombres !== "string" ||
      !nombres.trim() ||
      nombres.length > 100 ||
      typeof apellidos !== "string" ||
      apellidos.length > 100
    )
      fail("RESET_INPUT", "Los nombres de la cuenta no son válidos.");
    return {
      correo,
      nombreUsuario,
      password: account.password,
      nombres: nombres.trim(),
      apellidos: apellidos.trim(),
      rol: account.rol,
      tipoAgente: account.rol === "AGENTE" ? "COLABORADOR" : null,
    };
  });
  if (
    accounts.filter(({ rol }) => rol === "ADMIN").length !== 4 ||
    accounts.filter(({ rol }) => rol === "AGENTE").length !== 1
  )
    fail(
      "RESET_INPUT",
      "Se requieren exactamente cuatro administradores y un colaborador.",
    );
  const options = input.datasetOptions;
  if (
    !options ||
    Object.keys(options).some(
      (key) => !["now", "count", "seed"].includes(key),
    ) ||
    options.count !== 500 ||
    typeof options.seed !== "string" ||
    !options.seed.trim() ||
    options.seed.length > 256 ||
    !Number.isFinite(+new Date(options.now))
  )
    fail(
      "RESET_INPUT",
      "La carga debe solicitar exactamente 500 reportes con fecha y semilla explícitas.",
    );
  return {
    accounts,
    datasetOptions: {
      now: new Date(options.now),
      count: 500,
      seed: options.seed,
    },
  };
}

function resetInventory(snapshot) {
  const tables = snapshot.tables;
  const oldIds = new Set(tables.User.map(({ id }) => id));
  const preservedAttachments = new Set(
    tables.MapAnnouncement.map(({ imagenId }) => imagenId).filter(Boolean),
  );
  const purgeAttachments = tables.Attachment.filter(
    ({ id }) => !preservedAttachments.has(id),
  );
  if (
    tables.Attachment.some(
      (row) => preservedAttachments.has(row.id) && row.reporteId != null,
    )
  )
    fail(
      "RESET_BACKUP",
      "Un anuncio está vinculado a un adjunto de reporte; revisa esa relación primero.",
    );
  return {
    counts: Object.fromEntries(
      snapshotTables.map(([table]) => [table, tables[table].length]),
    ),
    preservedAttachments: tables.Attachment.filter(({ id }) =>
      preservedAttachments.has(id),
    ),
    purgeAttachments: purgeAttachments.map(
      ({ id, path, size, mimeType, privado, tipo, usuarioId }) => ({
        id,
        path,
        size,
        mimeType,
        privado,
        tipo,
        usuarioId,
      }),
    ),
    oldUserIds: [...oldIds],
  };
}

async function planExplicitReset({
  database,
  connection,
  input,
  snapshot,
} = {}) {
  const validated = validateInput(input);
  const current = await captureResetSnapshot(database, { connection });
  if (snapshot) {
    validateSnapshot(snapshot, connection, {
      expectedLegacyTables: Object.keys(current.legacyTables || {}),
    });
    if (
      fingerprintSnapshotCriticalState(snapshot) !==
      current.criticalStateFingerprint
    )
      fail(
        "RESET_STALE_BACKUP",
        "La base cambió después del respaldo; crea uno nuevo antes de continuar.",
      );
  }
  const inventory = resetInventory(current);
  return {
    mode: "plan",
    targetFingerprint: current.targetFingerprint,
    stateFingerprint: current.stateFingerprint,
    criticalStateFingerprint: current.criticalStateFingerprint,
    inputFingerprint: fingerprint(input),
    counts: inventory.counts,
    legacyCounts: Object.fromEntries(
      Object.entries(current.legacyTables || {}).map(([table, rows]) => [
        table,
        rows.length,
      ]),
    ),
    newAccounts: validated.accounts.map(
      ({ correo, nombreUsuario, rol, tipoAgente }) => ({
        correo,
        nombreUsuario,
        rol,
        tipoAgente,
        correoVerificado: true,
        permisos: rol === "AGENTE" ? [...permissionKeys] : [],
      }),
    ),
    newReports: 500,
    newIncidents: 500,
    newReviews: 500,
    preservedAdvertisingFiles: inventory.preservedAttachments.length,
    storageObjectsToRemoveAfterCommit: inventory.purgeAttachments.length,
    preservedModels: [
      "Category",
      "IncidentType",
      "Reward",
      "Business",
      "MapAnnouncement",
      "ExternalApiUsage",
    ],
    globalApiQuotasPreserved: true,
  };
}

const deletionOrder = Object.freeze([
  "session",
  "verification",
  "appeal",
  "recovery",
  "vote",
  "chatMessage",
  "flag",
  "review",
  "notification",
  "pointEvent",
  "redemption",
  "adImpression",
  "routeFavorite",
  "routeHistory",
  "rankingSettlement",
]);

function validateDataset(dataset, { userIds, types, count = 500 }) {
  if (
    !dataset ||
    !Array.isArray(dataset.entries) ||
    dataset.entries.length !== count
  )
    fail(
      "RESET_DATASET",
      "El generador debe producir exactamente 500 pares reporte/incidente.",
    );
  const permittedIncident = new Set([
    "tipo",
    "tipoId",
    "descripcion",
    "latitud",
    "longitud",
    "distrito",
    "nivelRiesgo",
    "estado",
    "totalReportes",
    "validacion",
    "publicado",
    "evaluacion",
    "individual",
    "historico",
    "emergencia",
    "persistente",
    "fuente",
    "fechaEvento",
    "fechaPublicacion",
    "fechaCreacion",
  ]);
  const permittedReport = new Set([
    "usuarioId",
    "tipo",
    "tipoId",
    "descripcion",
    "latitud",
    "longitud",
    "gpsLatitud",
    "gpsLongitud",
    "nivelRiesgo",
    "estado",
    "confirmaciones",
    "fechaEvento",
    "fechaCreacion",
  ]);
  const permittedReview = new Set([
    "usuarioId",
    "accion",
    "motivo",
    "datos",
    "creadoEn",
  ]);
  const activeTypes = new Map(
    types.filter((type) => type.activo).map((type) => [type.id, type]),
  );
  const identities = new Set();
  for (const { incident, report, review, provenance } of dataset.entries) {
    if (
      !incident ||
      !report ||
      !review ||
      Object.keys(incident).some((key) => !permittedIncident.has(key)) ||
      Object.keys(report).some((key) => !permittedReport.has(key)) ||
      Object.keys(review).some((key) => !permittedReview.has(key))
    )
      fail(
        "RESET_DATASET",
        "La carga contiene campos no permitidos o referencias arbitrarias.",
      );
    const type = activeTypes.get(incident.tipoId);
    if (
      !type ||
      incident.tipo !== type.nombre ||
      report.tipoId !== type.id ||
      report.tipo !== type.nombre ||
      !userIds.includes(report.usuarioId) ||
      !userIds.includes(review.usuarioId)
    )
      fail(
        "RESET_DATASET",
        "La carga debe usar el catálogo y las cuentas nuevas.",
      );
    if (
      incident.estado !== "VALIDADO" ||
      report.estado !== "VALIDADO" ||
      incident.publicado !== true ||
      incident.validacion !== 1 ||
      incident.totalReportes !== 1 ||
      report.confirmaciones !== 0 ||
      incident.fuente !== "CARGA_INICIAL" ||
      review.accion !== "CARGA_INICIAL" ||
      review.datos?.synthetic !== true ||
      provenance?.synthetic !== true
    )
      fail(
        "RESET_DATASET",
        "La carga debe conservar su procedencia y no inventar votos ni evaluaciones de IA.",
      );
    if (
      ["individual", "historico", "emergencia", "persistente"].some(
        (key) => incident[key] !== type[key],
      )
    )
      fail(
        "RESET_DATASET",
        "La carga no puede cambiar las reglas del tipo de incidente.",
      );
    if (
      ![incident.latitud, incident.longitud].every(Number.isFinite) ||
      Math.abs(incident.latitud) > 90 ||
      Math.abs(incident.longitud) > 180 ||
      incident.latitud !== report.latitud ||
      incident.longitud !== report.longitud ||
      incident.descripcion !== report.descripcion ||
      typeof incident.descripcion !== "string" ||
      incident.descripcion.length < 20 ||
      incident.descripcion.length > 2000 ||
      !Number.isInteger(incident.nivelRiesgo) ||
      incident.nivelRiesgo < 1 ||
      incident.nivelRiesgo > 5 ||
      report.nivelRiesgo !== incident.nivelRiesgo
    )
      fail(
        "RESET_DATASET",
        "Las coordenadas, descripciones y gravedad deben coincidir en cada par.",
      );
    const identity = stableSerialize([incident.latitud, incident.longitud]);
    if (identities.has(identity))
      fail("RESET_DATASET", "La carga no puede duplicar ubicaciones.");
    identities.add(identity);
    if (
      ![
        incident.fechaEvento,
        incident.fechaPublicacion,
        report.fechaEvento,
      ].every((value) => value && Number.isFinite(+new Date(value)))
    )
      fail("RESET_DATASET", "La carga necesita fechas válidas.");
  }
  return dataset;
}

async function applyExplicitReset({
  database,
  connection,
  input,
  snapshot,
  confirmTarget,
  buildDataset,
  roads,
  timeout = 120000,
} = {}) {
  const validated = validateInput(input);
  validateSnapshot(snapshot, connection);
  if (confirmTarget !== snapshot.targetFingerprint)
    fail(
      "RESET_CONFIRM",
      "Confirma expresamente la huella de la base seleccionada.",
    );
  if (typeof buildDataset !== "function")
    fail("RESET_DATASET", "Falta el generador revisado de reportes.");
  assertModelInventory();
  const discoveredLegacy = await discoverLegacyTables(database);
  validateSnapshot(snapshot, connection, {
    expectedLegacyTables: discoveredLegacy,
  });
  // Hash outside the write barrier; plaintext is never written to PostgreSQL or logs.
  const hashedAccounts = [];
  for (const account of validated.accounts)
    hashedAccounts.push({
      ...account,
      password: await hashPassword(account.password),
    });
  const backupFingerprint = fingerprint(snapshot);
  const inventory = resetInventory(snapshot);
  const result = await database.$transaction(
    async (db) => {
      // Fixed, validated table names only. Prevent every writer while checking the backup
      // and replacing the data; readers can continue to see the old committed state.
      await db.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
      await db.$executeRawUnsafe(
        "LOCK TABLE " +
          [...snapshotTables.map(([table]) => table), ...discoveredLegacy]
            .map((table) => 'public."' + table + '"')
            .sort()
            .join(", ") +
          " IN SHARE ROW EXCLUSIVE MODE",
      );
      const current = await captureResetSnapshot(db, {
        connection,
        locked: true,
      });
      if (
        current.criticalStateFingerprint !==
        fingerprintSnapshotCriticalState(snapshot)
      )
        fail(
          "RESET_STALE_BACKUP",
          "La base cambió después del respaldo; no se borró ningún dato.",
        );
      const run = randomUUID().replaceAll("-", "");
      const users = [];
      for (const [index, account] of hashedAccounts.entries()) {
        users.push(
          await db.user.create({
            data: {
              ...account,
              // Temporary identities permit replacement even if an old account has the
              // requested email. No real phone number is assigned or marked verified.
              nombreUsuario: "reset_" + run + "_" + index,
              correo: "reset_" + run + "_" + index + "@civigo.invalid",
              telefono: "+999" + randomInt(10000000000, 99999999999) + index,
              correoVerificado: true,
              telefonoVerificado: false,
              bloqueado: false,
              permisos: account.rol === "AGENTE" ? [...permissionKeys] : [],
              distrito: null,
              reputacion: null,
            },
          }),
        );
      }
      const primaryAdmin = users.find(({ rol }) => rol === "ADMIN");
      if (inventory.preservedAttachments.length)
        await db.attachment.updateMany({
          where: {
            id: { in: inventory.preservedAttachments.map(({ id }) => id) },
          },
          data: { usuarioId: primaryAdmin.id },
        });
      if (inventory.oldUserIds.length)
        await db.externalTrafficModeration.updateMany({
          where: { usuarioId: { in: inventory.oldUserIds } },
          data: { usuarioId: primaryAdmin.id },
        });
      const deleted = {};
      deleted.legacyTables = {};
      for (const table of Object.keys(current.legacyTables || {})) {
        if (!legacyTableNames.includes(table))
          fail("RESET_SCHEMA_CHANGED", "Tabla histórica no permitida.");
        deleted.legacyTables[table] = await db.$executeRawUnsafe(
          'DELETE FROM public."' + table + '"',
        );
      }
      for (const delegate of deletionOrder)
        deleted[delegate] = (await db[delegate].deleteMany({})).count;
      deleted.attachment = (
        await db.attachment.deleteMany({
          where: {
            id: { notIn: inventory.preservedAttachments.map(({ id }) => id) },
          },
        })
      ).count;
      deleted.report = (await db.report.deleteMany({})).count;
      deleted.incident = (await db.incident.deleteMany({})).count;
      const retiredEntities = [
        "User",
        "USUARIO",
        "Report",
        "REPORTE",
        "Incident",
        "INCIDENTE",
        "MENSAJE",
      ];
      deleted.auditLog = (
        await db.auditLog.deleteMany({
          where: {
            OR: [
              { usuarioId: { in: inventory.oldUserIds } },
              { entidad: { in: retiredEntities } },
            ],
          },
        })
      ).count;
      const historicalKeys = snapshot.tables.AppConfig.filter(
        ({ clave, valor }) =>
          clave.startsWith("historical:") &&
          (snapshot.tables.Incident.some(
            ({ id }) => id === valor?.incidenteId,
          ) ||
            inventory.oldUserIds.includes(valor?.importadoPor)),
      ).map(({ clave }) => clave);
      deleted.appConfig = (
        await db.appConfig.deleteMany({
          where: { clave: { in: historicalKeys } },
        })
      ).count;
      deleted.usageCounter = (
        await db.usageCounter.deleteMany({
          where: {
            OR: inventory.oldUserIds.map((id) => ({
              clave: { startsWith: `uploads:${id}:` },
            })),
          },
        })
      ).count;
      deleted.user = (
        await db.user.deleteMany({
          where: { id: { in: inventory.oldUserIds } },
        })
      ).count;
      for (const [index, account] of hashedAccounts.entries())
        users[index] = await db.user.update({
          where: { id: users[index].id },
          data: {
            correo: account.correo,
            nombreUsuario: account.nombreUsuario,
          },
        });
      const types = await db.incidentType.findMany({ orderBy: { id: "asc" } });
      const dataset = validateDataset(
        buildDataset({
          ...validated.datasetOptions,
          types,
          authorIds: users.map(({ id }) => id),
          reviewerId: primaryAdmin.id,
          roads,
        }),
        { userIds: users.map(({ id }) => id), types },
      );
      const allocated =
        await db.$queryRaw`SELECT nextval(pg_get_serial_sequence('"Incident"', 'id'))::integer AS id FROM generate_series(1, ${500}::integer)`;
      if (
        allocated.length !== 500 ||
        new Set(allocated.map(({ id }) => id)).size !== 500
      )
        fail("RESET_DATASET", "No se pudieron asignar identificadores nuevos.");
      await db.incident.createMany({
        data: dataset.entries.map(({ incident }, index) => ({
          ...incident,
          id: allocated[index].id,
        })),
      });
      await db.report.createMany({
        data: dataset.entries.map(({ report }, index) => ({
          ...report,
          incidenteId: allocated[index].id,
        })),
      });
      await db.review.createMany({
        data: dataset.entries.map(({ review }, index) => ({
          ...review,
          incidenteId: allocated[index].id,
        })),
      });
      await db.auditLog.create({
        data: {
          usuarioId: primaryAdmin.id,
          accion: "CARGA_INICIAL_REPORTES",
          entidad: "RESET_EXPLICITO",
          datos: {
            synthetic: true,
            origen: "Solicitud explícita del propietario",
            resetRun: run,
            snapshotFingerprint: backupFingerprint,
            previousStateFingerprint: snapshot.stateFingerprint,
            countsDeleted: deleted,
            accountsCreated: users.length,
            incidentsCreated: 500,
            reportsCreated: 500,
            independentConfirmations: 0,
            aiEvaluations: 0,
            dataset: dataset.summary || {},
          },
        },
      });
      const finalCounts = {
        users: await db.user.count(),
        reports: await db.report.count(),
        incidents: await db.incident.count(),
        reviews: await db.review.count(),
        votes: await db.vote.count(),
        sessions: await db.session.count(),
      };
      if (
        stableSerialize(finalCounts) !==
        stableSerialize({
          users: 5,
          reports: 500,
          incidents: 500,
          reviews: 500,
          votes: 0,
          sessions: 0,
        })
      )
        fail(
          "RESET_COUNTS",
          "La comprobación final falló; se revierte el reinicio completo.",
        );
      for (const [index, user] of users.entries())
        if (
          !user.correoVerificado ||
          user.bloqueado ||
          user.correo !== validated.accounts[index].correo ||
          !(await verifyPassword(
            validated.accounts[index].password,
            user.password,
          ))
        )
          fail(
            "RESET_ACCOUNTS",
            "No se pudieron comprobar las cuentas nuevas; se revierte el reinicio.",
          );
      return {
        mode: "applied",
        targetFingerprint: snapshot.targetFingerprint,
        backupFingerprint,
        counts: finalCounts,
        deleted,
        accounts: users.map(
          ({ id, correo, nombreUsuario, rol, tipoAgente, permisos }) => ({
            id,
            correo,
            nombreUsuario,
            rol,
            tipoAgente,
            permisos,
          }),
        ),
        storageObjectsToRemoveAfterCommit: inventory.purgeAttachments,
        preservedAdvertisingFileIds: inventory.preservedAttachments.map(
          ({ id }) => id,
        ),
        datasetSummary: dataset.summary || {},
      };
    },
    { isolationLevel: "Serializable", maxWait: 10000, timeout },
  );
  // Storage objects deliberately remain untouched until the transaction is committed
  // and the operator has copied them to the recoverable backup.
  return result;
}

module.exports = {
  SNAPSHOT_FORMAT,
  INPUT_FORMAT,
  snapshotTables,
  legacyTableNames,
  deletionOrder,
  stableSerialize,
  fingerprint,
  fingerprintSnapshotState,
  criticalStateFingerprint,
  fingerprintSnapshotCriticalState,
  connectionIdentity,
  identityFingerprint,
  assertModelInventory,
  discoverLegacyTables,
  captureResetSnapshot,
  validateSnapshot,
  validateInput,
  resetInventory,
  validateDataset,
  planExplicitReset,
  applyExplicitReset,
};
