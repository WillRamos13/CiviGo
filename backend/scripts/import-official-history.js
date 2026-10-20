"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { prepareImport } = require("../src/lib/history-import");
const { commitHistorical } = require("../src/lib/history-commit");
function parseArgs(args) {
  const options = { commit: false };
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--commit") options.commit = true;
    else if (
      [
        "--input",
        "--expected-count",
        "--project-ref",
        "--output",
        "--roads-file",
      ].includes(name) &&
      args[index + 1]
    )
      options[name.slice(2)] = args[++index];
    else throw new Error("Argumento de importación inválido.");
  }
  if (!options.input || !/^[1-9]\d*$/.test(options["expected-count"] || ""))
    throw new Error("Indica archivo y cantidad esperada.");
  return options;
}
function targetFor(value, expectedProject) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Conexión no configurada.");
  }
  if (!expectedProject || !/^[a-z0-9]+$/.test(expectedProject))
    throw new Error("Falta identificar el proyecto autorizado.");
  const matches =
    url.hostname === `db.${expectedProject}.supabase.co` ||
    (url.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(url.username) === `postgres.${expectedProject}`);
  if (!matches || !["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error(
      "La conexión no corresponde al proyecto Supabase esperado.",
    );
  return {
    projectRef: expectedProject,
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.slice(1),
  };
}
async function run(options, prisma) {
  const target = targetFor(process.env.DATABASE_URL, options["project-ref"]);
  const raw = fs.readFileSync(path.resolve(options.input));
  const document = JSON.parse(raw),
    records = Array.isArray(document) ? document : document.registros;
  if (
    !Array.isArray(records) ||
    records.length !== Number(options["expected-count"])
  )
    throw new Error("Cantidad inesperada.");
  const fuente = document.metadatos?.fuente;
  if (typeof fuente !== "string" || !fuente.trim() || fuente.length > 150)
    throw new Error("Falta procedencia válida.");
  const catalog = await prisma.incidentType.findMany();
  const prepared = {
    registros: [],
    errores: [],
    total: records.length,
    totalValidos: 0,
  };
  const seen = new Set(),
    provenance = new Map();
  for (let offset = 0; offset < records.length; offset += 500) {
    const batch = records.slice(offset, offset + 500);
    const result = prepareImport(
      { formato: "json", fuente, contenido: JSON.stringify(batch) },
      catalog,
    );
    prepared.errores.push(
      ...result.errores.map((item) => ({ ...item, fila: item.fila + offset })),
    );
    for (const row of result.registros) {
      if (seen.has(row.clave))
        throw new Error("Referencias históricas duplicadas.");
      seen.add(row.clave);
      prepared.registros.push(row);
    }
    for (const row of batch)
      provenance.set(row.referencia, {
        fuente: row.fuente,
        servicioFuente: row.servicioFuente,
        idDgc: row.idDgc,
        objectidsFuente: row.objectidsFuente,
        distritoFuente: row.distritoFuente,
        ubigeoFuente: row.ubigeoFuente,
        direccionFuente: row.direccionFuente,
        tipoFuente: row.tipoFuente,
        subtipoFuente: row.subtipoFuente,
        modalidadesFuente: row.modalidadesFuente,
        fechaEventoPrecision: row.fechaEventoPrecision,
        fechaHoraFuenteEpoch: row.fechaHoraFuenteEpoch,
        fechaHoraFuenteComponentes: row.fechaHoraFuenteComponentes,
        zonaHorariaFuenteConfirmada: row.zonaHorariaFuenteConfirmada,
        precisionMetricaPublicada: row.precisionMetricaPublicada,
        advertencias: row.advertencias,
      });
  }
  prepared.totalValidos = prepared.registros.length;
  if (prepared.errores.length || prepared.totalValidos !== records.length) {
    const error = new Error("Registros inválidos; sin importación.");
    error.validation = prepared.errores;
    throw error;
  }
  const oldIds = (
    await prisma.incident.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    })
  ).map((row) => row.id);
  const columns =
    await prisma.$queryRaw`SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Incident' AND column_name = 'nivelRiesgo'`;
  if (columns[0]?.is_nullable !== "YES")
    throw new Error("La base no admite gravedad pendiente.");
  const dates = prepared.registros.map((row) => row.fechaEvento).sort();
  const manifest = {
    fileSHA256: crypto.createHash("sha256").update(raw).digest("hex"),
    registros: records.length,
    fuente,
    fechaMinima: dates[0],
    fechaMaxima: dates.at(-1),
  };
  const output = {
    mode: options.commit ? "COMMIT_APPEND_ONLY" : "DRY_RUN",
    target,
    manifest,
    validos: prepared.totalValidos,
    gravedadPendiente: prepared.registros.filter(
      (row) => row.nivelRiesgo === null,
    ).length,
    incidentesPrevios: oldIds.length,
    idsPreviosSHA256: crypto
      .createHash("sha256")
      .update(JSON.stringify(oldIds))
      .digest("hex"),
    importados: 0,
  };
  if (options.commit) {
    Object.assign(
      output,
      await commitHistorical(prisma, {
        prepared,
        fuente,
        metadataByReference: provenance,
        manifest,
      }),
    );
    output.incidentesPreviosConservados = await prisma.incident.count({
      where: { id: { in: oldIds } },
    });
    output.totalFinal = await prisma.incident.count();
    if (output.incidentesPreviosConservados !== oldIds.length)
      throw new Error(
        "La comprobación posterior requiere revisión; este importador no ejecuta borrados.",
      );
  }
  if (options.output)
    fs.writeFileSync(
      path.resolve(options.output),
      JSON.stringify(output, null, 2),
    );
  console.log(
    JSON.stringify(
      {
        ...output,
        ids: output.ids?.length
          ? {
              cantidad: output.ids.length,
              primero: output.ids[0],
              ultimo: output.ids.at(-1),
            }
          : output.ids,
      },
      null,
      2,
    ),
  );
  return output;
}
async function main() {
  let prisma;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options["roads-file"])
      process.env.ROADS_FILE = path.resolve(options["roads-file"]);
    require("dotenv").config({ quiet: true });
    targetFor(process.env.DATABASE_URL, options["project-ref"]);
    const connection = new URL(process.env.DATABASE_URL);
    connection.searchParams.set("connection_limit", "1");
    connection.searchParams.set("connect_timeout", "15");
    connection.searchParams.set("pool_timeout", "15");
    process.env.DATABASE_URL = connection.href;
    prisma = require("../src/lib/db");
    await run(options, prisma);
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error.validation
          ? "La validación rechazó registros."
          : "La operación no se completó. Revisa configuración y evidencias locales.",
        code: error.code || error.name,
        validation: error.validation,
      }),
    );
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}
if (require.main === module) void main();
module.exports = { parseArgs, targetFor, run };
