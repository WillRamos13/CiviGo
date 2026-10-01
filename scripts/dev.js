"use strict";
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.join(__dirname, ".."),
  backend = path.join(root, "backend"),
  frontend = path.join(root, "frontend");
const dotenv = require(path.join(backend, "node_modules/dotenv"));
const children = [];
let stopping = false;
function launch(script, args = [], env = {}, cwd = root) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (e) => console.error(e.message));
  return child;
}
function run(script, args = [], env = {}, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = launch(script, args, env, cwd);
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`La preparación terminó con código ${code}.`)),
    );
  });
}
function launchService(script, args, env, cwd, name) {
  const child = launch(script, args, env, cwd);
  const fail = (code) => {
    if (stopping) return;
    console.error(`${name} se detuvo. Se cierran los servicios de desarrollo.`);
    stop();
    process.exitCode = code || 1;
  };
  child.once("error", () => fail(1));
  child.once("exit", fail);
  return child;
}
async function waitForDb(url) {
  const connection = new URL(url);
  // PGlite begins listening only after database initialization. Do not load
  // Prisma here: its DLL stays in the parent process on Windows during generate.
  for (let i = 0; i < 30; i++) {
    if (stopping) throw new Error("El servidor local se detuvo al iniciar.");
    const listening = await new Promise((resolve) => {
      const socket = net.createConnection({
        host: connection.hostname,
        port: Number(connection.port),
      });
      const finish = (ready) => {
        socket.destroy();
        resolve(ready);
      };
      socket.setTimeout(500, () => finish(false));
      socket.once("error", () => finish(false));
      socket.once("connect", () => finish(true));
    });
    if (listening) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("La base local no inició.");
}
async function main() {
  if (
    !fs.existsSync(path.join(backend, "node_modules")) ||
    !fs.existsSync(path.join(frontend, "node_modules"))
  )
    throw new Error("Ejecuta npm install en backend y frontend primero.");
  const local = process.argv.includes("--local"),
    demo = process.argv.includes("--demo");
  dotenv.config({ path: path.join(backend, ".env"), quiet: true });
  const frontendConfig = {
    ...(dotenv.config({
      path: path.join(frontend, ".env"),
      quiet: true,
      processEnv: {},
    }).parsed || {}),
    ...(dotenv.config({
      path: path.join(frontend, ".env.local"),
      quiet: true,
      processEnv: {},
    }).parsed || {}),
  };
  const env = {
    NODE_ENV: "development",
    BACKEND_URL: "http://127.0.0.1:4000",
    FRONTEND_URL: "http://localhost:3000,http://127.0.0.1:3000",
    PORT: "4000",
    API_HOST: "127.0.0.1",
  };
  if (frontendConfig.NEXT_PUBLIC_MAPBOX_TOKEN && !process.env.MAPBOX_TOKEN)
    env.MAPBOX_TOKEN = frontendConfig.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (local) {
    const localPort = Number(process.env.LOCAL_DB_PORT || 55432);
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535)
      throw new Error(
        "LOCAL_DB_PORT debe ser un puerto válido entre 1 y 65535.",
      );
    env.LOCAL_DB_PORT = String(localPort);
    env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${localPort}/postgres?connection_limit=1&pgbouncer=true&statement_cache_size=0`;
    env.DEMO_VERIFICATION = "true";
    launchService(
      path.join(backend, "scripts/local-db.js"),
      [],
      env,
      backend,
      "La base local",
    );
    await waitForDb(env.DATABASE_URL);
    await run(
      path.join(backend, "scripts/prepare-local-db.js"),
      [],
      env,
      backend,
    );
    await run(path.join(backend, "scripts/seed.js"), [], env, backend);
  }
  if (demo) {
    if (!local)
      throw new Error(
        "La semilla de demostración de este lanzador requiere --local.",
      );
    await run(path.join(backend, "scripts/seed-demo.js"), [], env, backend);
  }
  launchService(
    path.join(backend, "src/server.js"),
    [],
    env,
    backend,
    "La API",
  );
  launchService(
    path.join(frontend, "node_modules/next/dist/bin/next"),
    ["dev", "--hostname", "127.0.0.1", "--port", "3000"],
    { ...env, PORT: "3000" },
    frontend,
    "La web",
  );
  console.log(
    "CiviGo iniciando: http://localhost:3000 · API: http://127.0.0.1:4000",
  );
}
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
}
process.on("SIGINT", () => {
  stop();
  setTimeout(() => process.exit(0), 500);
});
process.on("SIGTERM", () => {
  stop();
  setTimeout(() => process.exit(0), 500);
});
main().catch((error) => {
  console.error(error.message);
  stop();
  process.exitCode = 1;
});
