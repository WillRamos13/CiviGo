const test = require("node:test"),
  assert = require("node:assert/strict");
const { validateRequest } = require("../electron/policy.cjs");
test("desktop permits contact inbox and payment reads, but never checkout or manual payment approval", () => {
  for (const [route, method] of [
    ["/admin/contact", "GET"],
    ["/admin/contact", "PATCH"],
    ["/payments/manage", "GET"],
    ["/admin/control", "GET"],
    ["/admin/site-statistics", "GET"],
    ["/admin/integration-probes", "GET"],
  ])
    assert.doesNotThrow(() =>
      validateRequest({
        route,
        method,
        ...(method === "PATCH"
          ? {
              body: JSON.stringify({
                clave: "contact:1:12345678-1234-1234-1234-123456789012",
              }),
            }
          : {}),
      }),
    );
  for (const [route, method] of [
    ["/payments/checkout", "POST"],
    ["/payments/webhook", "POST"],
    ["/payments/manage", "PATCH"],
    ["/admin/contact", "DELETE"],
    ["/admin/control", "POST"],
    ["/admin/site-statistics", "PATCH"],
    ["/admin/integration-probes", "POST"],
  ])
    assert.throws(() => validateRequest({ route, method }));
});
