"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const { Prisma } = require("@prisma/client");
const { targetFor } = require("./import-official-history");
const {
  METHOD,
  assessHistoricalSeverity,
} = require("../src/lib/historical-severity");
const sha = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
function parseArgs(args) {
  const opts = { commit: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--commit") opts.commit = true;
    else if (
      ["--input", "--manifest", "--project-ref", "--output-dir"].includes(
        args[i],
      ) &&
      args[i + 1]
    )
      opts[args[i++].slice(2)] = args[i];
    else throw new Error("Argumento inválido.");
  }
  if (!["input", "manifest", "project-ref", "output-dir"].every((k) => opts[k]))
    throw new Error(
      "Faltan archivo, manifiesto, proyecto o destino de respaldo.",
    );
  return opts;
}
function preservedHash(rows, targetIds) {
  return sha(
    rows.map((row) => {
      if (!targetIds.has(row.id)) return row;
      const { nivelRiesgo, fechaActualizacion, ...unchanged } = row;
      void nivelRiesgo;
      void fechaActualizacion;
      return unchanged;
    }),
  );
}
async function run(options, prisma) {
  const target = targetFor(process.env.DATABASE_URL, options["project-ref"]);
  const raw = fs.readFileSync(path.resolve(options.input)),
    source = JSON.parse(raw);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(options.manifest)));
  const ids = manifest.ids,
    records = source.registros;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    !ids.every(Number.isInteger) ||
    new Set(ids).size !== ids.length ||
    !Array.isArray(records) ||
    ids.length !== records.length ||
    manifest.manifest?.fileSHA256 !== sha(raw) ||
    target.projectRef !== manifest.target?.projectRef
  )
    throw new Error(
      "El archivo o el destino no coincide con el manifiesto de importación.",
    );
  const idsSet = new Set(ids),
    outputDir = path.resolve(options["output-dir"]);
  fs.mkdirSync(outputDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const result = await prisma.$transaction(
    async (db) => {
      if (options.commit)
        await db.$queryRaw(
          Prisma.sql`SELECT id FROM "Incident" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
        );
      const before = await db.incident.findMany({ orderBy: { id: "asc" } });
      const rows = new Map(
        before.filter((r) => idsSet.has(r.id)).map((r) => [r.id, r]),
      );
      const ledger = (
        await db.appConfig.findMany({
          where: { clave: { startsWith: "historical:" } },
          orderBy: { clave: "asc" },
        })
      ).filter((r) => idsSet.has(r.valor?.incidenteId));
      if (rows.size !== ids.length || ledger.length !== ids.length)
        throw new Error("Faltan históricos o sus registros de procedencia.");
      const byRef = new Map(ledger.map((r) => [r.valor.referencia, r]));
      if (
        byRef.size !== ids.length ||
        new Set(ledger.map((r) => r.valor.incidenteId)).size !== ids.length
      )
        throw new Error("La procedencia no es unívoca.");
      const changes = [],
        completed = [];
      for (const record of records) {
        const entry = byRef.get(record.referencia),
          row = rows.get(entry?.valor.incidenteId);
        if (
          !row ||
          !row.historico ||
          row.fuente !== source.metadatos.fuente ||
          row.descripcion !== record.descripcion.trim() ||
          row.evaluacion !== "PENDIENTE" ||
          row.validacion !== 0 ||
          row.estado !== "PENDIENTE" ||
          row.totalReportes !== 0 ||
          !entry.valor.procedencia
        )
          throw new Error(
            "El histórico cambió o no coincide con su procedencia; no se sobrescribe.",
          );
        const assessment = assessHistoricalSeverity(row.descripcion);
        if (row.nivelRiesgo !== null) {
          if (
            entry.valor.gravedadPreliminar?.metodo === METHOD &&
            row.nivelRiesgo === assessment.nivel
          )
            completed.push(row.id);
          else
            throw new Error(
              "Ya existe una gravedad que este proceso no puede sobrescribir.",
            );
        } else
          changes.push({
            id: row.id,
            clave: entry.clave,
            ...assessment,
            descripcionSHA256: sha(row.descripcion),
          });
      }
      const summary = {
        mode: options.commit ? "COMMIT" : "DRY_RUN",
        target,
        metodo: METHOD,
        registros: ids.length,
        porActualizar: changes.length,
        yaEvaluados: completed.length,
        niveles: changes.reduce(
          (a, r) => ((a[r.nivel] = (a[r.nivel] || 0) + 1), a),
          {},
        ),
        revisionHumana: false,
      };
      if (!options.commit || !changes.length) return summary;
      // Durable local rollback evidence must exist BEFORE the first mutation.
      const backup = {
        creadoEn: new Date().toISOString(),
        target,
        sourceSHA256: sha(raw),
        incidentes: [...rows.values()],
        procedencias: ledger,
      };
      const backupFile = path.join(outputDir, `respaldo-${runId}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), {
        flag: "wx",
      });
      const assessedAt = new Date().toISOString();
      for (let level = 1; level <= 5; level++) {
        const batch = changes.filter((r) => r.nivel === level);
        if (!batch.length) continue;
        const updated = await db.incident.updateMany({
          where: {
            id: { in: batch.map((r) => r.id) },
            nivelRiesgo: null,
            historico: true,
            evaluacion: "PENDIENTE",
            validacion: 0,
          },
          data: { nivelRiesgo: level },
        });
        if (updated.count !== batch.length)
          throw new Error(
            "Actualización concurrente detectada; se revierte el lote completo.",
          );
      }
      for (let offset = 0; offset < changes.length; offset += 500) {
        const patch = changes
          .slice(offset, offset + 500)
          .map(({ clave, id, ...assessment }) => ({
            clave,
            valor: {
              gravedadPreliminar: { ...assessment, evaluadoEn: assessedAt },
            },
          }));
        const updated =
          await db.$executeRaw`UPDATE "AppConfig" AS a SET "valor" = a."valor" || p.valor, "actualizadoEn" = NOW() FROM jsonb_to_recordset(${JSON.stringify(patch)}::jsonb) AS p(clave text, valor jsonb) WHERE a.clave = p.clave`;
        if (updated !== patch.length)
          throw new Error(
            "No se pudo guardar toda la trazabilidad; se revierte la operación.",
          );
      }
      const after = await db.incident.findMany({ orderBy: { id: "asc" } });
      if (preservedHash(before, idsSet) !== preservedHash(after, idsSet))
        throw new Error(
          "Se modificaron campos ajenos a la gravedad; se revierte la operación.",
        );
      const levels = new Map(changes.map((r) => [r.id, r.nivel]));
      if (
        after
          .filter((r) => levels.has(r.id))
          .some((r) => r.nivelRiesgo !== levels.get(r.id))
      )
        throw new Error("La verificación de niveles falló.");
      await db.auditLog.create({
        data: {
          accion: "ASIGNAR_GRAVEDAD_HISTORICOS",
          entidad: "Incident",
          datos: {
            metodo: METHOD,
            sourceSHA256: sha(raw),
            cantidad: changes.length,
            idsSHA256: sha(changes.map((r) => r.id)),
            niveles: summary.niveles,
            revisionHumana: false,
            criterio:
              "Modalidad publicada en la descripción; no certifica autenticidad ni vigencia",
            estadosYValidacionConservados: true,
          },
        },
      });
      return {
        ...summary,
        actualizados: changes.length,
        anterioresConservados: before.length - ids.length,
        camposAjenosConservados: true,
        respaldo: backupFile,
      };
    },
    { timeout: 60000, maxWait: 15000, isolationLevel: "Serializable" },
  );
  fs.writeFileSync(
    path.join(
      outputDir,
      `${options.commit ? "resultado" : "simulacion"}-${runId}.json`,
    ),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}
async function main() {
  let prisma;
  try {
    const options = parseArgs(process.argv.slice(2));
    targetFor(process.env.DATABASE_URL, options["project-ref"]);
    const url = new URL(process.env.DATABASE_URL);
    for (const [key, value] of Object.entries({
      connection_limit: "1",
      connect_timeout: "15",
      pool_timeout: "15",
    }))
      url.searchParams.set(key, value);
    process.env.DATABASE_URL = url.href;
    prisma = require("../src/lib/db");
    await run(options, prisma);
  } catch (error) {
    console.error(
      JSON.stringify({
        error:
          "No se completó la asignación. No se sobrescriben revisiones ni datos que difieran del manifiesto.",
        code: error.code || error.name,
      }),
    );
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}
if (require.main === module) void main();
module.exports = { parseArgs, preservedHash, run };
