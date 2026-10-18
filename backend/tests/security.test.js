const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express");
const {
  trustProxy,
  originGuard,
  rateLimits,
  counter,
} = require("../src/lib/security");

test("Confianza de proxy requiere direcciones explícitas y nunca un número de saltos", () => {
  assert.equal(trustProxy(undefined), false);
  assert.equal(trustProxy("false"), false);
  assert.deepEqual(trustProxy("loopback,10.6.0.0/16,2001:db8::/32"), [
    "loopback",
    "10.6.0.0/16",
    "2001:db8::/32",
  ]);
  for (const value of [
    "true",
    "1",
    "127.0.0.1/99",
    "::1/129",
    "example.com",
    "loopback,",
  ])
    assert.throws(() => trustProxy(value));
});

test("CSRF bloquea solicitudes de navegador ajenas sin Origin y respeta orígenes explícitamente permitidos", async () => {
  const app = express();
  app.use(originGuard(["https://civigo.online"]));
  app.post("/mutation", (req, res) => res.sendStatus(204));
  app.use((e, req, res, next) =>
    res.status(e.status || 500).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + server.address().port + "/mutation";
  try {
    for (const headers of [
      { Origin: "https://evil.test" },
      { Referer: "https://evil.test/form" },
      { "Sec-Fetch-Site": "cross-site" },
    ])
      assert.equal((await fetch(url, { method: "POST", headers })).status, 403);
    for (const headers of [
      {},
      { Origin: "https://civigo.online", "Sec-Fetch-Site": "cross-site" },
      { Referer: "https://civigo.online/profile" },
    ])
      assert.equal((await fetch(url, { method: "POST", headers })).status, 204);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("Límites separan sesiones verificadas detrás de una IP y no aceptan cookies ni XFF inventados", async () => {
  const app = express();
  const limits = rateLimits({
    userLimit: 2,
    anonymousLimit: 2,
    loginLimit: 2,
    loadUser: async (req) =>
      ({ A: { id: 1 }, B: { id: 2 } })[req.headers.cookie] || null,
  });
  app.use(limits.ip, express.json(), limits.identity);
  app.all(/.*/, (req, res) => res.sendStatus(204));
  app.use((e, req, res, next) =>
    res.status(e.status || 500).json({ code: e.code }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  async function get(id, cookie, forwarded) {
    return fetch(base + "/api/incidents/" + id, {
      headers: {
        Cookie: cookie,
        "X-Forwarded-For": forwarded || "203.0.113.20",
      },
    });
  }
  try {
    assert.equal((await get(1, "A")).status, 204);
    assert.equal((await get(2, "A")).status, 204);
    const limited = await get(3, "A", "198.51.100.123");
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
    assert.equal((await get(3, "B")).status, 204);
    assert.equal((await get(4, "invented1")).status, 204);
    assert.equal((await get(5, "invented2")).status, 204);
    assert.equal((await get(6, "invented3", "198.51.100.4")).status, 429);
    for (let n = 0; n < 2; n++)
      assert.equal(
        (
          await fetch(base + "/api/users/login", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": "198.51.100." + n,
            },
            body: JSON.stringify({ correo: " TEST@Example.com " }),
          })
        ).status,
        204,
      );
    assert.equal(
      (
        await fetch(base + "/api/users/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ correo: "test@example.com" }),
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await fetch(base + "/api/users/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ correo: "other@example.com" }),
        })
      ).status,
      204,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('Password attempts share a strict IP limit across reset, forgot and change endpoints', async () => {
  const { identity } = rateLimits({ passwordLimit: 3, passwordAccountLimit: 2, loadUser: async () => null });
  const call = (route, correo) => new Promise(resolve => identity({ path: '/api/users/password/' + route, ip: '192.0.2.1', method: 'POST', body: { correo } }, { setHeader() {} }, error => resolve(error?.status ?? 204)));
  assert.equal(await call('forgot', ' A@Example.com '), 204);
  assert.equal(await call('forgot', 'a@example.com'), 204);
  assert.equal(await call('forgot', 'A@example.com'), 429);
  assert.equal(await call('reset'), 429);
  assert.equal(await call('change'), 429);
});

test("La cuota vencida se renueva con Retry-After verificable", () => {
  let time = 1000;
  const consume = counter({ now: () => time, windowMs: 1000, maxBuckets: 2 });
  const headers = {};
  const res = { setHeader: (k, v) => (headers[k] = v) };
  consume("actor", 1, res);
  assert.throws(() => consume("actor", 1, res), { status: 429 });
  assert.equal(headers["Retry-After"], "1");
  time = 2000;
  assert.doesNotThrow(() => consume("actor", 1, res));
});

function consumeLimit(handler, path, body = {}) {
  return new Promise(resolve => handler({ path, ip: '192.0.2.15', method: 'POST', body },
    { setHeader() {} }, error => resolve(error?.status ?? 204)));
}

test('login and password quotas cannot be bypassed by case or a trailing slash', async () => {
  const { identity } = rateLimits({ loginLimit: 1, passwordAccountLimit: 1, loadUser: async () => null });
  const body = { correo: 'fixture@example.invalid' };
  assert.equal(await consumeLimit(identity, '/api/users/LoGiN/', body), 204);
  assert.equal(await consumeLimit(identity, '/api/users/login', body), 429);
  assert.equal(await consumeLimit(identity, '/api/users/PASSWORD/forgot/', body), 204);
  assert.equal(await consumeLimit(identity, '/api/USERS/password/FORGOT', body), 429);
});

test('authentication IP quota covers all case aliases before parsing the body', async () => {
  const { ip } = rateLimits({ authIpLimit: 2 });
  assert.equal(await consumeLimit(ip, '/API/Users/Register/'), 204);
  assert.equal(await consumeLimit(ip, '/api/users/PASSWORD/reset'), 204);
  assert.equal(await consumeLimit(ip, '/api/users/email/GOOGLE/verify/'), 429);
  assert.equal(await consumeLimit(ip, '/api/users/login'), 429);
});

test('Google and ordinary user limits share a bucket across equivalent endpoint spellings', async () => {
  const { identity } = rateLimits({ identityAuthLimit: 1, userLimit: 1, loadUser: async () => ({ id: 10 }) });
  assert.equal(await consumeLimit(identity, '/api/users/email/Google/verify/'), 204);
  assert.equal(await consumeLimit(identity, '/api/users/email/google/verify'), 429);
  assert.equal(await consumeLimit(identity, '/api/Reports/42/appeal/'), 204);
  assert.equal(await consumeLimit(identity, '/api/reports/49/APPEAL'), 429);
});
