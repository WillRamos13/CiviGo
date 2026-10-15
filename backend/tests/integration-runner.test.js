"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { integrationEnvironment } = require("../scripts/run-integration");

const local = "postgresql://fixture:local-only@127.0.0.1:55432/test";
const remote = "postgresql://fixture:private-password@remote.invalid:5432/test";

test("local integration pins every database client to the test connection", () => {
  const env = {
    NODE_ENV: "development",
    TEST_DATABASE_URL: local,
    DATABASE_URL: remote,
    DIRECT_URL: remote,
    ALLOW_REMOTE_TESTS: "true",
    OPENAI_API_KEY: "fixture-provider-key",
    RESEND_API_KEY: "fixture-mail-key",
    ENABLE_JOBS: "true",
  };
  const original = { ...env };
  const result = integrationEnvironment(env);
  for (const key of ["DATABASE_URL", "DIRECT_URL", "TEST_DATABASE_URL"])
    assert.equal(result[key], local);
  assert.equal(result.NODE_ENV, "test");
  assert.equal(result.ALLOW_REMOTE_TESTS, "false");
  assert.equal(result.OPENAI_API_KEY, "");
  assert.equal(result.RESEND_API_KEY, "");
  assert.equal(result.ENABLE_JOBS, "false");
  assert.deepEqual(env, original);
});

test("remote TEST_DATABASE_URL cannot bypass explicit remote opt-in", () => {
  for (const url of [
    remote,
    "postgresql://localhost:fixture@remote.invalid/test",
    "postgresql://fixture:private-password@127.0.0.1.invalid/localhost",
  ]) {
    for (const flag of [undefined, "true"])
      assert.throws(
        () =>
          integrationEnvironment({
            TEST_DATABASE_URL: url,
            ALLOW_REMOTE_TESTS: flag,
          }),
        (error) =>
          /localhost/.test(error.message) &&
          !error.message.includes("private-password"),
      );
  }
});

test("remote integration requires both --remote and the explicit environment flag", () => {
  assert.throws(
    () => integrationEnvironment({ DATABASE_URL: remote }, ["--remote"]),
    /ALLOW_REMOTE_TESTS=true/,
  );
  const result = integrationEnvironment(
    { DATABASE_URL: remote, DIRECT_URL: local, ALLOW_REMOTE_TESTS: "true" },
    ["--remote"],
  );
  assert.equal(result.DATABASE_URL, remote);
  assert.equal(result.DIRECT_URL, remote);
  assert.equal(result.TEST_DATABASE_URL, remote);
  assert.equal(result.ALLOW_REMOTE_TESTS, "true");
});

test("invalid connection, production and unknown arguments fail before starting tests", () => {
  assert.throws(() => integrationEnvironment({}), /TEST_DATABASE_URL/);
  for (const url of [
    "invalid",
    "https://fixture:private-password@localhost/test",
    "postgresql:/test",
  ])
    assert.throws(
      () => integrationEnvironment({ TEST_DATABASE_URL: url }),
      (error) =>
        /PostgreSQL/.test(error.message) &&
        !error.message.includes("private-password"),
    );
  assert.throws(
    () =>
      integrationEnvironment(
        {
          NODE_ENV: "production",
          DATABASE_URL: remote,
          ALLOW_REMOTE_TESTS: "true",
        },
        ["--remote"],
      ),
    /production/,
  );
  assert.throws(
    () => integrationEnvironment({ TEST_DATABASE_URL: local }, ["--remtoe"]),
    /Argumentos/,
  );
});

test("IPv4 and hostname loopback connections match the integration fixtures", () => {
  for (const host of ["127.0.0.1", "localhost"])
    assert.equal(
      integrationEnvironment({
        TEST_DATABASE_URL: `postgresql://fixture:local@${host}:55432/test`,
      }).NODE_ENV,
      "test",
    );
  assert.throws(
    () =>
      integrationEnvironment({
        TEST_DATABASE_URL: "postgresql://fixture:local@[::1]:55432/test",
      }),
    /localhost o 127.0.0.1/,
  );
});
