"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  runtimeDatabaseUrl,
  migrationDatabaseUrl,
  cliDatabaseUrl,
} = require("../src/lib/database-url");

const runtime =
  "postgresql://postgres.project:fake%40password%3Avalue%2F@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require&schema=public&pool_timeout=10&connect_timeout=5";
const transaction = runtime.replace(":5432/", ":6543/");
const direct =
  "postgresql://postgres:other-fake-password@db.project.supabase.co:5432/postgres?sslmode=require&schema=public";

function safeConfigurationError(value, variable = "DATABASE_URL") {
  return (error) => {
    assert.equal(error.code, "DATABASE_CONFIG");
    assert.ok(error.message.includes(variable));
    assert.ok(!error.message.includes(String(value)));
    assert.ok(!error.message.includes("fake-password"));
    return true;
  };
}

test("runtime pool defaults to two while preserving encoded credentials and connection options", () => {
  const before = new URL(runtime);
  const result = new URL(runtimeDatabaseUrl(runtime));
  assert.equal(result.searchParams.get("connection_limit"), "2");
  for (const key of [
    "protocol",
    "username",
    "password",
    "hostname",
    "port",
    "pathname",
  ])
    assert.equal(result[key], before[key]);
  for (const [key, value] of before.searchParams)
    assert.equal(result.searchParams.get(key), value);
});

test("explicit positive runtime limits are preserved", () => {
  for (const limit of [1, 3]) {
    const value = `${runtime}&connection_limit=${limit}`;
    assert.equal(
      new URL(runtimeDatabaseUrl(value)).searchParams.get("connection_limit"),
      String(limit),
    );
  }
});

test("runtime rejects invalid or duplicated connection limits without printing URLs", () => {
  for (const limit of ["0", "-1", "1.5", "", "01", "NaN", "Infinity", " 2"])
    assert.throws(
      () =>
        runtimeDatabaseUrl(
          `${runtime}&connection_limit=${encodeURIComponent(limit)}`,
        ),
      (error) => {
        assert.equal(error.code, "DATABASE_CONFIG");
        assert.match(error.message, /connection_limit/);
        assert.ok(!error.message.includes("postgres.project"));
        assert.ok(!error.message.includes("fake%40password"));
        return true;
      },
    );
  assert.throws(
    () =>
      runtimeDatabaseUrl(`${runtime}&connection_limit=1&connection_limit=3`),
    { code: "DATABASE_CONFIG" },
  );
});

test("Supabase transaction pooling enables PgBouncer without moving the connection", () => {
  for (const value of [
    transaction,
    `${transaction}&pgbouncer=false`,
    transaction.replace(
      "aws-0-us-east-2.pooler.supabase.com",
      "AWS-0-US-EAST-2.POOLER.SUPABASE.COM",
    ),
    direct.replace(":5432/", ":6543/"),
  ]) {
    const before = new URL(value);
    const result = new URL(runtimeDatabaseUrl(value));
    assert.equal(result.searchParams.get("pgbouncer"), "true");
    assert.equal(result.searchParams.get("connection_limit"), "2");
    assert.equal(result.hostname, before.hostname);
    assert.equal(result.port, "6543");
    assert.equal(result.username, before.username);
    assert.equal(result.password, before.password);
  }
});

test("session, direct and unrelated port 6543 connections do not gain a PgBouncer flag", () => {
  for (const value of [
    runtime,
    direct,
    transaction.replace("pooler.supabase.com", "pooler.example.invalid"),
  ])
    assert.equal(
      new URL(runtimeDatabaseUrl(value)).searchParams.has("pgbouncer"),
      false,
    );
  const configured = `${runtime}&pgbouncer=true`;
  assert.equal(
    new URL(runtimeDatabaseUrl(configured)).searchParams.get("pgbouncer"),
    "true",
  );
});

test("migration commands choose DIRECT_URL and reserve one connection", () => {
  const env = {
    DATABASE_URL: transaction,
    DIRECT_URL: ` ${direct}&connection_limit=3 `,
  };
  for (const command of ["migrate", "db", "studio", "introspect"]) {
    const result = new URL(cliDatabaseUrl(env, command));
    assert.equal(result.hostname, "db.project.supabase.co");
    assert.equal(result.username, "postgres");
    assert.equal(result.password, "other-fake-password");
    assert.equal(result.searchParams.get("connection_limit"), "1");
    assert.equal(result.searchParams.get("sslmode"), "require");
    assert.equal(result.searchParams.get("schema"), "public");
  }
  assert.equal(env.DATABASE_URL, transaction);
  assert.equal(env.DIRECT_URL, ` ${direct}&connection_limit=3 `);
});

test("migration fallback supports the existing session URL with one connection", () => {
  for (const env of [
    { DATABASE_URL: runtime },
    { DATABASE_URL: runtime, DIRECT_URL: "   " },
  ]) {
    const result = new URL(migrationDatabaseUrl(env));
    assert.equal(result.hostname, new URL(runtime).hostname);
    assert.equal(result.port, "5432");
    assert.equal(result.searchParams.get("connection_limit"), "1");
    assert.equal(result.searchParams.get("sslmode"), "require");
  }
});

test("migration rejects transaction pooling before connecting and keeps credentials private", () => {
  for (const env of [
    { DATABASE_URL: transaction },
    { DATABASE_URL: runtime, DIRECT_URL: transaction },
    {
      DATABASE_URL: transaction.replace(
        "aws-0-us-east-2.pooler.supabase.com",
        "AWS-0-US-EAST-2.POOLER.SUPABASE.COM",
      ),
    },
    { DATABASE_URL: direct.replace(":5432/", ":6543/") },
  ])
    assert.throws(
      () => cliDatabaseUrl(env, "migrate"),
      (error) => {
        assert.equal(error.code, "DATABASE_CONFIG");
        assert.match(error.message, /DIRECT_URL/);
        assert.match(error.message, /5432/);
        assert.ok(!error.message.includes(transaction));
        assert.ok(!error.message.includes("postgres.project"));
        assert.ok(!error.message.includes("fake%40password"));
        assert.ok(!error.message.includes("other-fake-password"));
        return true;
      },
    );
});

test("generation and schema-only commands do not require or inspect database connections", () => {
  for (const command of [
    "generate",
    "validate",
    "format",
    "version",
    undefined,
  ])
    for (const env of [
      {},
      { DATABASE_URL: transaction },
      { DATABASE_URL: "invalid", DIRECT_URL: "invalid" },
    ])
      assert.equal(cliDatabaseUrl(env, command), undefined);
  assert.equal(migrationDatabaseUrl({}), undefined);
  assert.equal(runtimeDatabaseUrl(""), undefined);
});

test("invalid PostgreSQL configurations fail with safe variable-specific messages", () => {
  for (const value of [
    "https://user:fake-password@example.invalid/db",
    "postgresql:/db",
    "not-a-url",
    null,
  ])
    assert.throws(
      () => runtimeDatabaseUrl(value),
      safeConfigurationError(value),
    );
  const invalid = "https://user:fake-password@example.invalid/db";
  assert.throws(
    () => migrationDatabaseUrl({ DATABASE_URL: runtime, DIRECT_URL: invalid }),
    safeConfigurationError(invalid, "DIRECT_URL"),
  );
});

test("backend constructor uses runtime credentials and reuses its singleton without accessing a database", () => {
  const dbPath = path.resolve(__dirname, "../src/lib/db.js");
  const code = `
    const assert = require('node:assert/strict');
    const clientPath = require.resolve('@prisma/client');
    const options = [];
    class FakePrismaClient { constructor(value) { options.push(value); } }
    require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { PrismaClient: FakePrismaClient } };
    const dbPath = ${JSON.stringify(dbPath)};
    const first = require(dbPath);
    assert.equal(require(dbPath), first);
    delete require.cache[dbPath];
    assert.equal(require(dbPath), first);
    assert.equal(options.length, 1);
    const url = new URL(options[0].datasources.db.url);
    assert.equal(url.hostname, 'aws-0-us-east-2.pooler.supabase.com');
    assert.equal(url.port, '6543');
    assert.equal(url.username, 'postgres.project');
    assert.equal(url.password, 'fake%40password%3Avalue%2F');
    assert.equal(url.searchParams.get('connection_limit'), '2');
    assert.equal(url.searchParams.get('pgbouncer'), 'true');
    assert.equal(first.prisma, first);
  `;
  const result = spawnSync(process.execPath, ["-e", code], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: transaction,
      DIRECT_URL: direct,
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
