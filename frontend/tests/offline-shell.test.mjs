import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
function worker({ online = true } = {}) {
  const handlers = new Map(),
    requests = [],
    writes = [];
  runInNewContext(source, {
    URL,
    Response,
    self: {
      location: { origin: "https://civigo.test" },
      addEventListener: (type, handler) => handlers.set(type, handler),
    },
    fetch: async (request) => {
      requests.push(request.url);
      if (!online) throw new Error("Simulated offline network");
      return new Response("Current public asset");
    },
    caches: {
      match: async () => new Response("Previously saved public asset"),
      open: async () => ({
        put: async (request) => {
          writes.push(request.url);
        },
      }),
    },
  });
  function dispatch(path, method = "GET") {
    let response;
    handlers.get("fetch")({
      request: new Request("https://civigo.test" + path, { method }),
      respondWith: (value) => {
        response = value;
      },
    });
    return response;
  }
  return { dispatch, requests, writes };
}

test("online shell uses current CSS rather than an obsolete cached development bundle", async () => {
  const app = worker();
  const response = await app.dispatch("/_next/static/chunks/app_globals.css");
  assert.equal(await response.text(), "Current public asset");
  assert.equal(app.requests.length, 1);
  assert.equal(app.writes.length, 1);
});

test("official logo remains available from its public cache when the network fails", async () => {
  const app = worker({ online: false });
  const response = await app.dispatch("/civigo-logo.jpeg");
  assert.equal(await response.text(), "Previously saved public asset");
  assert.equal(app.requests.length, 1);
  assert.equal(app.writes.length, 0);
});

test("worker never intercepts session, private evidence or mutation requests", () => {
  const app = worker();
  for (const [path, method] of [
    ["/api/users/me", "GET"],
    ["/api/uploads/private-proof", "GET"],
    ["/uploads/private-proof", "GET"],
    ["/api/users/logout", "POST"],
    ["/civigo-logo.jpeg", "POST"],
  ])
    assert.equal(app.dispatch(path, method), undefined);
  assert.equal(app.requests.length, 0);
  assert.equal(app.writes.length, 0);
});
