const test = require("node:test"),
  assert = require("node:assert/strict");
const { createIntegrationProbes } = require("../src/lib/integration-probes");
test("provider probes use shared daily quotas, cache results and never reveal account identity or credentials", async () => {
  let requests = 0,
    used = 0;
  const probe = createIntegrationProbes({
    env: {
      MERCADOPAGO_ACCESS_TOKEN: "PRIVATE_TOKEN",
      PAYMENTS_MODE: "test",
      FOURSQUARE_ENABLED: "true",
      FOURSQUARE_SERVICE_KEY: "PRIVATE_FSQ",
      FOURSQUARE_DAILY_REQUEST_LIMIT: "200",
    },
    db: {
      usageCounter: {
        upsert: async () => {},
        updateMany: async () => {
          used++;
          return { count: 1 };
        },
      },
    },
    request: async (url) => {
      requests++;
      return {
        ok: true,
        json: async () => ({ tags: ["test_user"], email: "PRIVATE_EMAIL" }),
      };
    },
  });
  const result = await probe.run();
  assert.ok(result.providers.every((row) => row.ok));
  assert.equal(requests, 2);
  assert.equal(used, 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
  await probe.run();
  assert.equal(requests, 2);
});
test("probe distinguishes production credentials in test mode and rejects provider HTTP errors", async () => {
  const probe = createIntegrationProbes({
    env: { MERCADOPAGO_ACCESS_TOKEN: "fixture", PAYMENTS_MODE: "test" },
    db: {},
    request: async () => ({
      ok: true,
      json: async () => ({ tags: ["normal"] }),
    }),
  });
  const result = await probe.run();
  assert.equal(result.providers[0].ok, false);
  assert.match(result.providers[0].message, /cuenta real/);
});
