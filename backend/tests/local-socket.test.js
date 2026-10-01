"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { PrismaClient } = require("@prisma/client");
const { LocalSocketServer } = require("../scripts/local-socket-server");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("La conexión local no terminó su limpieza.");
    await delay(10);
  }
}
function fakeDatabase(protocol) {
  return {
    waitReady: Promise.resolve(),
    isInTransaction: () => false,
    runExclusive: async (fn) => fn(),
    execProtocolRawStream: protocol,
    exec: async () => [],
  };
}
async function openSocket(server) {
  const [host, port] = server.getServerConn().split(":");
  const socket = net.connect(Number(port), host);
  socket.on("error", () => {});
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return socket;
}
async function pgClient(server) {
  const socket = await openSocket(server);
  let buffer = Buffer.alloc(0),
    pending = null;
  socket.on("data", (bytes) => {
    buffer = Buffer.concat([buffer, bytes]);
    while (buffer.length >= 5) {
      const size = buffer.readInt32BE(1) + 1;
      if (buffer.length < size) break;
      const type = String.fromCharCode(buffer[0]),
        body = buffer.subarray(5, size);
      buffer = buffer.subarray(size);
      if (!pending) continue;
      if (type === "E") pending.error = new Error(body.toString());
      if (type === "D") {
        let offset = 2;
        const row = [];
        for (let i = 0; i < body.readInt16BE(0); i++) {
          const length = body.readInt32BE(offset);
          offset += 4;
          row.push(
            length < 0
              ? null
              : body.subarray(offset, offset + length).toString(),
          );
          if (length >= 0) offset += length;
        }
        pending.rows.push(row);
      }
      if (type === "Z") {
        const result = pending;
        pending = null;
        clearTimeout(result.timer);
        if (result.error) result.reject(result.error);
        else result.resolve(result.rows);
      }
    }
  });
  const waitReady = () =>
    new Promise((resolve, reject) => {
      assert.equal(pending, null);
      pending = {
        resolve,
        reject,
        rows: [],
        timer: setTimeout(() => {
          pending = null;
          reject(new Error("El protocolo local no respondió."));
        }, 3000),
      };
    });
  const startup = Buffer.from("user\0postgres\0database\0postgres\0\0");
  const first = Buffer.alloc(8 + startup.length);
  first.writeInt32BE(first.length, 0);
  first.writeInt32BE(196608, 4);
  startup.copy(first, 8);
  const ready = waitReady();
  socket.write(first);
  await ready;
  return {
    socket,
    query: async (sql) => {
      const text = Buffer.from(sql + "\0"),
        frame = Buffer.alloc(text.length + 5);
      frame[0] = 81;
      frame.writeInt32BE(text.length + 4, 1);
      text.copy(frame, 5);
      const answer = waitReady();
      socket.write(frame);
      return answer;
    },
    close: async () => {
      socket.destroy();
      await until(() => server.getStats().activeConnections === 0);
    },
  };
}
function urlFor(server) {
  return `postgresql://postgres:postgres@${server.getServerConn()}/postgres?connection_limit=1&pgbouncer=true&statement_cache_size=0`;
}

test(
  "local queue recovers after a protocol rejection without retaining processing or queued work",
  { timeout: 5000 },
  async () => {
    let fail = true;
    const server = new LocalSocketServer({
      db: fakeDatabase(async () => {
        if (fail) {
          fail = false;
          throw new Error("Fallo de protocolo inyectado");
        }
      }),
      port: 0,
    });
    try {
      await assert.rejects(
        server.queryQueue.enqueue(1, new Uint8Array([0]), () => {}),
      );
      await server.queryQueue.enqueue(2, new Uint8Array([0]), () => {});
      await until(() => !server.queryQueue.processing);
      assert.equal(server.getStats().queuedQueries, 0);
    } finally {
      await server.stop();
    }
  },
);

test(
  "idle expiry releases the only logical connection slot and permits reconnection",
  { timeout: 5000 },
  async () => {
    const server = new LocalSocketServer({
      db: fakeDatabase(async () => {}),
      port: 0,
      idleTimeout: 30,
    });
    const sockets = [];
    try {
      await server.start();
      sockets.push(await openSocket(server));
      await until(() => server.getStats().activeConnections === 1);
      await until(() => server.getStats().activeConnections === 0);
      sockets.push(await openSocket(server));
      await until(() => server.getStats().activeConnections === 1);
      assert.equal(server.getStats().maxConnections, 1);
    } finally {
      sockets.forEach((socket) => socket.destroy());
      await server.stop();
    }
  },
);

test(
  "real PGlite accepts SQL after errors, partial-protocol reset and abandoned transaction",
  { timeout: 15000 },
  async () => {
    const db = await PGlite.create(),
      server = new LocalSocketServer({ db, port: 0 });
    let client;
    try {
      await server.start();
      client = await pgClient(server);
      await client.query("CREATE TABLE local_probe(id integer PRIMARY KEY)");
      await client.query("INSERT INTO local_probe VALUES (1)");
      await assert.rejects(client.query("INSERT INTO local_probe VALUES (1)"));
      assert.deepEqual(await client.query("SELECT 1"), [["1"]]);
      await client.close();
      client = await pgClient(server);
      const partial = Buffer.from([81, 0, 0, 3, 232, 83]);
      await new Promise((resolve, reject) =>
        client.socket.write(partial, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      client.socket.resetAndDestroy();
      await until(() => server.getStats().activeConnections === 0);
      client = await pgClient(server);
      assert.deepEqual(await client.query("SELECT 1"), [["1"]]);
      await client.query("BEGIN");
      await client.query("INSERT INTO local_probe VALUES (2)");
      client.socket.resetAndDestroy();
      await until(() => server.getStats().activeConnections === 0);
      client = await pgClient(server);
      assert.deepEqual(await client.query("SELECT count(*) FROM local_probe"), [
        ["1"],
      ]);
      const protocol = db.execProtocolRawStream.bind(db);
      let beginStarted;
      const started = new Promise((resolve) => {
        beginStarted = resolve;
      });
      db.execProtocolRawStream = async (message, options) => {
        if (
          message[0] === 81 &&
          Buffer.from(message).subarray(5).toString().startsWith("BEGIN")
        ) {
          beginStarted();
          await delay(40);
        }
        return protocol(message, options);
      };
      // Disconnect while BEGIN is still in flight, before isInTransaction is true.
      client.socket.write(
        Buffer.from([81, 0, 0, 0, 10, 66, 69, 71, 73, 78, 0]),
      );
      await started;
      client.socket.resetAndDestroy();
      await until(() => server.getStats().activeConnections === 0);
      assert.equal(db.isInTransaction(), false);
      db.execProtocolRawStream = protocol;
      client = await pgClient(server);
      assert.deepEqual(await client.query("SELECT 1"), [["1"]]);
    } finally {
      if (client) client.socket.destroy();
      await server.stop();
      await db.close();
    }
  },
);

test(
  "Prisma and repeated HTTP API reads recover their local connections",
  { timeout: 30000 },
  async () => {
    const db = await PGlite.create(),
      server = new LocalSocketServer({ db, port: 0 });
    let prisma, appServer;
    const previousUrl = process.env.DATABASE_URL;
    try {
      const migrations = path.join(__dirname, "../prisma/migrations");
      for (const directory of (
        await fs.readdir(migrations, { withFileTypes: true })
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort())
        await db.exec(
          await fs.readFile(
            path.join(migrations, directory, "migration.sql"),
            "utf8",
          ),
        );
      await server.start();
      process.env.DATABASE_URL = urlFor(server);
      process.env.NODE_ENV = "test";
      process.env.ENABLE_JOBS = "false";
      prisma = new PrismaClient({
        datasources: { db: { url: urlFor(server) } },
      });
      await prisma.$executeRawUnsafe(
        "CREATE TABLE local_prisma_probe(id integer PRIMARY KEY)",
      );
      await prisma.$executeRawUnsafe(
        "INSERT INTO local_prisma_probe VALUES (1)",
      );
      await assert.rejects(
        prisma.$executeRawUnsafe("INSERT INTO local_prisma_probe VALUES (1)"),
      );
      for (let i = 0; i < 5; i++) {
        assert.equal((await prisma.$queryRawUnsafe("SELECT 1 AS n"))[0].n, 1);
        await prisma.$disconnect();
        await until(() => server.getStats().activeConnections === 0);
      }
      const { app } = require("../src/server"),
        backendPrisma = require("../src/lib/db");
      const { seedCatalog } = require("../src/lib/catalog");
      await seedCatalog();
      appServer = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => appServer.once("listening", resolve));
      const base = `http://127.0.0.1:${appServer.address().port}`;
      for (let i = 0; i < 8; i++) {
        for (const route of [
          "/api/ready",
          "/api/catalog",
          "/api/navigation/roads",
        ]) {
          const response = await fetch(base + route);
          assert.equal(response.status, 200, route);
          const data = await response.json();
          if (route.endsWith("roads")) assert.ok(data.features.length > 30000);
          if (route.endsWith("catalog")) assert.ok(data.categorias.length > 0);
        }
        await backendPrisma.$disconnect();
        await until(() => server.getStats().activeConnections === 0);
      }
      await backendPrisma.$disconnect();
    } finally {
      if (appServer) await new Promise((resolve) => appServer.close(resolve));
      if (prisma) await prisma.$disconnect();
      const backendPrisma = globalThis.__civigoPrisma;
      if (backendPrisma) await backendPrisma.$disconnect();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      await server.stop();
      await db.close();
    }
  },
);
