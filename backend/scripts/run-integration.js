"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function integrationEnvironment(env, args = []) {
  if (args.some((arg) => arg !== "--remote"))
    throw new Error("Argumentos de integración inválidos.");
  if (env.NODE_ENV === "production")
    throw new Error("No se ejecutan pruebas con NODE_ENV=production.");
  const remote = args.includes("--remote");
  const connection = remote ? env.DATABASE_URL : env.TEST_DATABASE_URL;
  if (!connection)
    throw new Error(
      "Configura TEST_DATABASE_URL para integración local o DATABASE_URL para una base de prueba remota autorizada.",
    );
  let url;
  try {
    url = new URL(connection);
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname)
      throw new Error();
  } catch {
    throw new Error(
      "La conexión de pruebas debe ser una URL PostgreSQL válida.",
    );
  }
  if (remote && env.ALLOW_REMOTE_TESTS !== "true")
    throw new Error(
      "El modo remoto necesita ALLOW_REMOTE_TESTS=true. Usa exclusivamente una base de prueba autorizada.",
    );
  if (!remote && !["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error(
      "La integración local requiere una base en localhost o 127.0.0.1. Para una base de prueba remota usa --remote y ALLOW_REMOTE_TESTS=true.",
    );
  return {
    ...env,
    ...require("../tests/helpers/provider-environment").providerEnvironment,
    NODE_ENV: "test",
    ALLOW_REMOTE_TESTS: remote ? "true" : "false",
    // All clients and Prisma subprocesses must use the same approved test DB.
    DATABASE_URL: connection,
    DIRECT_URL: connection,
    TEST_DATABASE_URL: connection,
  };
}

function main(args = process.argv.slice(2)) {
  require("dotenv").config({ quiet: true });
  const env = integrationEnvironment(process.env, args);
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-concurrency=1",
      path.join(__dirname, "../tests/*.test.js"),
    ],
    {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      windowsHide: true,
      env,
    },
  );
  if (result.error)
    throw new Error("No se pudieron iniciar las pruebas de integración.");
  return result.status ?? 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { integrationEnvironment, main };
