const test = require("node:test"),
  assert = require("node:assert/strict");
const { validateRequest } = require("../electron/policy.cjs");
test("desktop permits contact inbox and payment reads, but never checkout or manual payment approval", () => {
  for (const [route, method] of [
    ["/admin/contact", "GET"],
    ["/admin/contact", "PATCH"],
    ["/payments/manage", "GET"],
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
  ])
    assert.throws(() => validateRequest({ route, method }));
});
