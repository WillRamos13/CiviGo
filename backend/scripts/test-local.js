// Isolated PostgreSQL tests: never reads .env or connects to an external DB.
const { PGlite } = require("@electric-sql/pglite");
const { LocalSocketServer } = require("./local-socket-server");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
async function main() {
  const db = await PGlite.create();
  const server = new LocalSocketServer({ db, port: 0, host: "127.0.0.1" });
  try {
    const migrations = path.join(__dirname, "../prisma/migrations");
    for (const name of (await fs.readdir(migrations)).sort()) {
      if (!/^\d/.test(name)) continue;
      await db.exec(
        await fs.readFile(path.join(migrations, name, "migration.sql"), "utf8"),
      );
    }
    await server.start();
    const address = server.server.address();
    const connection = `postgresql://postgres:postgres@127.0.0.1:${address.port}/postgres?connection_limit=1&pgbouncer=true&statement_cache_size=0`;
    const files = process.argv.slice(2);
    const child = spawn(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        ...(files.length ? files : ["tests/*.test.js"]),
      ],
      {
        cwd: path.join(__dirname, ".."),
        stdio: "inherit",
        env: {
          ...process.env,
          ...require("../tests/helpers/provider-environment")
            .providerEnvironment,
          NODE_ENV: "test",
          ALLOW_REMOTE_TESTS: "false",
          TEST_DATABASE_URL: connection,
          DATABASE_URL: connection,
          DIRECT_URL: connection,
        },
      },
    );
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await server.stop();
    await db.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
