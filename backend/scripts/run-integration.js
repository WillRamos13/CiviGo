require("dotenv").config({ quiet: true });
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const remote = process.argv.includes("--remote");
const connection = remote
  ? process.env.DATABASE_URL
  : process.env.TEST_DATABASE_URL;
if (!connection)
  throw new Error(
    "Configura TEST_DATABASE_URL para integración local o DATABASE_URL para una base de prueba remota autorizada.",
  );
if (remote && process.env.ALLOW_REMOTE_TESTS !== "true")
  throw new Error(
    "El modo remoto necesita ALLOW_REMOTE_TESTS=true. Usa exclusivamente una base de prueba autorizada.",
  );
if (process.env.NODE_ENV === "production")
  throw new Error("No se ejecutan pruebas con NODE_ENV=production.");
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    path.join(__dirname, "../tests/*.test.js"),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...require("../tests/helpers/provider-environment").providerEnvironment,
      TEST_DATABASE_URL: connection,
    },
  },
);
process.exitCode = result.status ?? 1;
