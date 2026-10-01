"use strict";
require("dotenv").config({ quiet: true });
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const backend = path.join(__dirname, "..");
const baselineKey = "local-migration-baseline";
function assertLocal(connection) {
  let url;
  try {
    url = new URL(connection);
  } catch {
    throw new Error("Define una conexión PostgreSQL local válida.");
  }
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Esta preparación es exclusiva de la base local; no modifica una base remota.",
    );
}
function runPrisma(args, connection, { quiet = false } = {}) {
  const result = spawnSync(
    process.execPath,
    [path.join(backend, "node_modules/prisma/build/index.js"), ...args],
    {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: connection },
      stdio: quiet ? "pipe" : "inherit",
      windowsHide: true,
    },
  );
  if (result.error)
    throw new Error("No se pudo iniciar Prisma para preparar la base local.");
  return result.status ?? 1;
}
async function prepareLocalDatabase(
  connection,
  { runner = (args) => runPrisma(args, connection), log = console.log } = {},
) {
  assertLocal(connection);
  const successful = (args) => {
    if (runner(args) !== 0)
      throw new Error(
        "La preparación local no se completó. Se conservan los datos; revisa el esquema o elige un LOCAL_DB_DIR nuevo.",
      );
  };
  // Generate before loading/connecting the engine; Windows keeps its DLL loaded.
  successful(["generate"]);
  const { PrismaClient } = require("@prisma/client");
  const database = new PrismaClient({
    datasources: { db: { url: connection } },
  });
  let legacy = false;
  let pending = null;
  let applied = [];
  try {
    const [status] =
      await database.$queryRaw`SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS managed, to_regclass('public."AppConfig"') IS NOT NULL AS config, EXISTS(SELECT 1 FROM pg_tables WHERE schemaname = 'public') AS populated`;
    legacy = !status.managed && status.populated;
    if (status.config) {
      const marker = await database.appConfig.findUnique({
        where: { clave: baselineKey },
      });
      if (marker) {
        if (
          !Array.isArray(marker.valor?.migraciones) ||
          marker.valor.migraciones.some(
            (name) => typeof name !== "string" || !/^[a-zA-Z0-9_]+$/.test(name),
          )
        )
          throw new Error(
            "El marcador de la preparación local anterior no es válido.",
          );
        pending = marker.valor.migraciones;
      }
    }
    if (pending && status.managed) {
      const rows = await database.$queryRawUnsafe(
        'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
      );
      applied = rows.map((row) => row.migration_name);
    }
  } finally {
    await database.$disconnect();
  }
  if (legacy || pending) {
    log(
      pending
        ? "Se reanuda la baseline local pendiente; los datos se conservan."
        : "La base local anterior no tiene historial de migraciones; se conservarán sus datos.",
    );
    const compare = [
      "migrate",
      "diff",
      "--from-url",
      connection,
      "--to-schema-datamodel",
      path.join(backend, "prisma/schema.prisma"),
      "--exit-code",
    ];
    const difference = runner(compare);
    if (difference === 2 && !pending)
      successful(["db", "push", "--skip-generate"]);
    else if (difference === 2)
      throw new Error(
        "El esquema cambió durante una baseline local pendiente; conserva la base y revisa sus migraciones antes de continuar.",
      );
    else if (difference !== 0)
      throw new Error(
        "No se pudo comprobar el esquema de la base local anterior.",
      );
    // Baseline only an equivalent schema. Never force reset or accept data loss.
    successful(compare);
    const directories =
      pending ||
      (
        await fs.readdir(path.join(backend, "prisma/migrations"), {
          withFileTypes: true,
        })
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    // Keep a recoverable checkpoint before resolving individual migrations.
    // An interrupted run must not replay CREATE TABLE against existing data.
    try {
      // db push reproduces schema, but not this migration's data backfill.
      // It is idempotent and keeps pending incidents without a publication date.
      await database.$executeRaw`UPDATE "Incident" SET "fechaPublicacion" = "fechaCreacion" WHERE "publicado" = true AND "fechaPublicacion" IS NULL`;
      if (!pending) {
        await database.appConfig.upsert({
          where: { clave: baselineKey },
          create: { clave: baselineKey, valor: { migraciones: directories } },
          update: { valor: { migraciones: directories } },
        });
      }
    } finally {
      await database.$disconnect();
    }
    for (const migration of directories)
      if (!applied.includes(migration))
        successful(["migrate", "resolve", "--applied", migration]);
    try {
      await database.appConfig.delete({ where: { clave: baselineKey } });
    } finally {
      await database.$disconnect();
    }
  }
  successful(["migrate", "deploy"]);
  log("Cliente Prisma y migraciones locales preparados sin borrar registros.");
}
if (require.main === module)
  prepareLocalDatabase(process.env.DATABASE_URL).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { assertLocal, runPrisma, prepareLocalDatabase };
