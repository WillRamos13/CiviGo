"use strict";
const path = require("node:path");
const fs = require("node:fs/promises");
const { PGlite } = require("@electric-sql/pglite");
const { LocalSocketServer } = require("./local-socket-server");
async function start() {
  const port = Number(process.env.LOCAL_DB_PORT || 55432);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("LOCAL_DB_PORT debe ser un puerto válido entre 1 y 65535.");
  const dataDir =
    process.env.LOCAL_DB_DIR || path.join(__dirname, "../.local/postgres");
  await fs.mkdir(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir);
  let server;
  try {
    server = new LocalSocketServer({ db, port, host: "127.0.0.1" });
    server.addEventListener("error", () =>
      console.error(
        "La conexión local encontró un error; comprueba la disponibilidad antes de continuar.",
      ),
    );
    await server.start();
  } catch (error) {
    if (server) await server.stop();
    await db.close();
    throw error;
  }
  console.log(
    `Base local lista en 127.0.0.1:${port}. DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true&statement_cache_size=0`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
if (require.main === module)
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { start };
