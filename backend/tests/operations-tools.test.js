"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const {
  assertLocal,
  prepareLocalDatabase,
  runPrisma,
} = require("../scripts/prepare-local-db");
const { bootstrap } = require("../scripts/bootstrap-admin");
const { seedDemo } = require("../scripts/seed-demo");
const backend = path.join(__dirname, "..");

test("local preparation rejects remote hosts even if their credentials or database contain localhost", () => {
  for (const url of [
    "postgresql://localhost:password@remote.invalid:5432/local",
    "postgresql://user:password@remote.invalid:5432/localhost",
    "https://127.0.0.1/database",
    "invalid",
  ])
    assert.throws(() => assertLocal(url));
  for (const host of ["localhost", "127.0.0.1", "[::1]"])
    assert.doesNotThrow(() =>
      assertLocal(`postgresql://user:local@${host}/db`),
    );
});

test("demo seed rejects misleading remote URLs before creating users or catalog", async () => {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_REMOTE_DEMO_SEED: process.env.ALLOW_REMOTE_DEMO_SEED,
  };
  try {
    process.env.NODE_ENV = "development";
    delete process.env.ALLOW_REMOTE_DEMO_SEED;
    process.env.DATABASE_URL =
      "postgresql://localhost:local-only@remote.invalid:5432/localhost";
    await assert.rejects(seedDemo(), /solo se crean en la base local/);
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://postgres:local@127.0.0.1/db";
    await assert.rejects(seedDemo(), /producción/);
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

async function reservePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
async function startFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civigo-tools-"));
  const port = await reservePort();
  const child = spawn(
    process.execPath,
    [path.join(backend, "scripts/local-db.js")],
    {
      cwd: backend,
      env: {
        ...process.env,
        NODE_ENV: "test",
        LOCAL_DB_PORT: String(port),
        LOCAL_DB_DIR: directory,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const inspect = (bytes) => {
      output += bytes.toString();
      if (output.includes("Base local lista")) resolve();
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`La base aislada salió con código ${code}: ${output}`)),
    );
  });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    await ready;
  } catch (error) {
    child.kill();
    await exited;
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true&statement_cache_size=0`,
    close: async () => {
      child.kill();
      await exited;
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}
function silentRunner(connection, calls) {
  return (args) => {
    calls.push(args);
    // Do not overwrite a client/engine loaded by this or another test process.
    // Generation is separately exercised by the launcher and CI before tests.
    if (args[0] === "generate") return 0;
    return runPrisma(args, connection, { quiet: true });
  };
}

test(
  "fresh local preparation deploys migrations and concurrent bootstrap creates only one administrator",
  { timeout: 90000 },
  async () => {
    const fixture = await startFixture();
    const database = new PrismaClient({
      datasources: { db: { url: fixture.url } },
    });
    try {
      const calls = [];
      await prepareLocalDatabase(fixture.url, {
        runner: silentRunner(fixture.url, calls),
        log: () => {},
      });
      assert.deepEqual(
        calls.map((args) => args.slice(0, 2)),
        [["generate"], ["migrate", "deploy"]],
      );
      const migrations = await database.$queryRawUnsafe(
        'SELECT count(*)::integer AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
      );
      const directories = (
        await fs.readdir(path.join(backend, "prisma/migrations"), {
          withFileTypes: true,
        })
      ).filter((entry) => entry.isDirectory());
      assert.equal(migrations[0].n, directories.length);
      const users = [];
      for (let i = 0; i < 2; i++)
        users.push(
          await database.user.create({
            data: {
              nombreUsuario: `bootstrap_probe_${i}`,
              correo: `bootstrap_${i}@example.invalid`,
              telefono: `+5197800000${i}`,
              password: `preserved_${i}`,
            },
          }),
        );
      const results = await Promise.allSettled(
        users.map((user) =>
          bootstrap({ database, email: user.correo, log: () => {} }),
        ),
      );
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(await database.user.count({ where: { rol: "ADMIN" } }), 1);
      assert.equal(
        await database.auditLog.count({ where: { accion: "ADMIN_INICIAL" } }),
        1,
      );
      for (let i = 0; i < users.length; i++)
        assert.equal(
          (await database.user.findUnique({ where: { id: users[i].id } }))
            .password,
          `preserved_${i}`,
        );
      await database.$disconnect();
      calls.length = 0;
      await prepareLocalDatabase(fixture.url, {
        runner: silentRunner(fixture.url, calls),
        log: () => {},
      });
      assert.equal(await database.user.count(), 2);
      assert.equal(
        calls.some((args) => args[0] === "db"),
        false,
      );
    } finally {
      await database.$disconnect();
      await fixture.close();
    }
  },
);

test(
  "legacy local preparation baselines the verified schema while preserving existing users",
  { timeout: 120000 },
  async () => {
    const fixture = await startFixture();
    const database = new PrismaClient({
      datasources: { db: { url: fixture.url } },
    });
    try {
      assert.equal(
        runPrisma(["db", "push", "--skip-generate"], fixture.url, {
          quiet: true,
        }),
        0,
      );
      const user = await database.user.create({
        data: {
          nombreUsuario: "legacy_probe",
          correo: "legacy_probe@example.invalid",
          telefono: "+51978000002",
          password: "preserved_legacy",
        },
      });
      const published = await database.incident.create({
        data: {
          tipo: "Prueba local",
          latitud: -14.067,
          longitud: -75.728,
          publicado: true,
          fechaCreacion: new Date("2026-09-15T12:00:00Z"),
        },
      });
      const pending = await database.incident.create({
        data: { tipo: "Prueba pendiente", latitud: -14.067, longitud: -75.728 },
      });
      await database.$disconnect();
      const calls = [];
      const runner = silentRunner(fixture.url, calls);
      let resolutions = 0;
      await assert.rejects(
        prepareLocalDatabase(fixture.url, {
          runner: (args) => {
            if (
              args[0] === "migrate" &&
              args[1] === "resolve" &&
              ++resolutions === 2
            )
              return 1;
            return runner(args);
          },
          log: () => {},
        }),
        /Se conservan los datos/,
      );
      assert.equal(
        (await database.user.findUnique({ where: { id: user.id } })).password,
        "preserved_legacy",
      );
      assert.ok(
        await database.appConfig.findUnique({
          where: { clave: "local-migration-baseline" },
        }),
      );
      await database.$disconnect();
      calls.length = 0;
      await prepareLocalDatabase(fixture.url, {
        runner: silentRunner(fixture.url, calls),
        log: () => {},
      });
      assert.equal(
        (await database.user.findUnique({ where: { id: user.id } })).password,
        "preserved_legacy",
      );
      assert.ok(
        calls.some((args) => args[0] === "migrate" && args[1] === "resolve"),
      );
      assert.equal(
        await database.appConfig.findUnique({
          where: { clave: "local-migration-baseline" },
        }),
        null,
      );
      assert.equal(
        (
          await database.incident.findUnique({ where: { id: published.id } })
        ).fechaPublicacion.toISOString(),
        published.fechaCreacion.toISOString(),
      );
      assert.equal(
        (await database.incident.findUnique({ where: { id: pending.id } }))
          .fechaPublicacion,
        null,
      );
      assert.equal(
        calls.some(
          (args) =>
            args.includes("--accept-data-loss") ||
            args.includes("--force-reset"),
        ),
        false,
      );
    } finally {
      await database.$disconnect();
      await fixture.close();
    }
  },
);
