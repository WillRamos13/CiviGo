"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const backend = path.resolve(__dirname, "..");
const runtime =
  "postgresql://runtime:fake@aws-0-test.pooler.supabase.com:6543/postgres";
const direct =
  "postgresql://migration:fake@127.0.0.1:32145/postgres?sslmode=require";

function configProbe(command, env) {
  const code = `
    process.argv[2] = ${JSON.stringify(command)};
    require('@prisma/config').loadConfigFromFile({configRoot:process.cwd()}).then(result => {
      if (result.error) {
        const error = result.error.error;
        console.log(JSON.stringify({error: error?.message || result.error._tag}));
        return;
      }
      const url = result.config.datasource?.url;
      console.log(JSON.stringify({engine: result.config.engine, url}));
    });
  `;
  const result = spawnSync(process.execPath, ["-e", code], {
    cwd: backend,
    env: { ...process.env, DATABASE_URL: runtime, DIRECT_URL: "", ...env },
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

test("installed Prisma 6 loads the dedicated CLI connection without opening a database", () => {
  const result = configProbe("migrate", { DIRECT_URL: direct });
  assert.equal(result.error, undefined);
  assert.equal(result.engine, "classic");
  const url = new URL(result.url);
  assert.equal(url.username, "migration");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "32145");
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.equal(url.searchParams.get("connection_limit"), "1");
});

test("client generation loads the actual config without requiring DIRECT_URL", () => {
  const result = configProbe("generate", { DIRECT_URL: "invalid" });
  assert.equal(result.error, undefined);
  assert.equal(result.engine, undefined);
  assert.equal(result.url, undefined);
});

test("CLI config rejects transaction migrations before the schema engine can connect", () => {
  const result = configProbe("migrate", {});
  assert.match(result.error, /DIRECT_URL/);
  assert.match(result.error, /5432/);
  assert.ok(!result.error.includes(runtime));
  assert.ok(!result.error.includes("fake"));
  assert.equal(result.engine, undefined);
  assert.equal(result.url, undefined);
});
