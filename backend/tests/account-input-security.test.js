const test = require("node:test");
const assert = require("node:assert/strict");
const { email, phone } = require("../src/lib/account-input");
const { rateLimits } = require("../src/lib/security");

test("email and phone reject JSON containers instead of coercing them into account identifiers", () => {
  for (const value of [
    ["person@gmail.com"],
    { toString: "person@gmail.com" },
    123,
    true,
    null,
    undefined,
  ])
    assert.throws(() => email(value), { status: 400 });
  for (const value of [["+51912345678"], 912345678, null, {}])
    assert.throws(() => phone(value), { status: 400 });
  assert.equal(email(" Person@Gmail.com "), "person@gmail.com");
  assert.equal(phone("912 345 678"), "+51912345678");
});

test("JSON arrays cannot bypass the account limit for login and password recovery", async () => {
  for (const path of ["/api/users/login", "/api/users/password/forgot"]) {
    const { identity } = rateLimits({
      loginLimit: 1,
      passwordAccountLimit: 1,
      loadUser: async () => null,
    });
    const request = (correo) =>
      new Promise((resolve) =>
        identity(
          { path, ip: "192.0.2.11", method: "POST", body: { correo } },
          { setHeader() {} },
          (error) => resolve(error?.status ?? 204),
        ),
      );
    assert.equal(await request(["target@gmail.com"]), 400);
    assert.equal(await request(" Target@Gmail.com "), 204);
    assert.equal(await request("target@gmail.com"), 429);
    assert.equal(await request(["target@gmail.com"]), 400);
  }
});
