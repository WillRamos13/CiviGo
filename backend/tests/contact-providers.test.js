const test = require("node:test");
const assert = require("node:assert/strict");
const contacts = require("../src/lib/contact-providers");

const keys = [
  "FIREBASE_PROJECT_ID",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "NODE_ENV",
];
async function isolated(work) {
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  for (const key of keys) delete process.env[key];
  process.env.RESEND_API_KEY = "fixture-resend-not-a-real-key";
  process.env.EMAIL_FROM = "CiviGo <notificaciones@tests.local>";
  try {
    await work();
  } finally {
    global.fetch = previousFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

test("Resend requiere aceptación con id, conserva idempotencia y no reintenta envíos", () =>
  isolated(async () => {
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(
        options.headers["Idempotency-Key"],
        "report-proof-reminder/123",
      );
      assert.deepEqual(JSON.parse(options.body), {
        from: process.env.EMAIL_FROM,
        to: ["to@tests.local"],
        subject: "Asunto",
        html: "<p>Prueba</p>",
      });
      return response({ id: "accepted-message-id" });
    };
    assert.equal(
      await contacts.sendEmail("to@tests.local", "Asunto", "<p>Prueba</p>", {
        idempotencyKey: "report-proof-reminder/123",
      }),
      true,
    );
    assert.equal(calls, 1);
    for (const invalid of [{}, { id: "" }, { id: 123 }, null, []]) {
      global.fetch = async () => response(invalid);
      assert.equal(
        await contacts.sendEmail("to@tests.local", "Asunto", "<p>Prueba</p>"),
        false,
      );
    }
    global.fetch = async () =>
      response({ message: "private-provider-response" }, 429);
    await assert.rejects(
      contacts.sendEmail("to@tests.local", "Asunto", "<p>Prueba</p>", {
        throwOnError: true,
      }),
      { status: 429, code: "EMAIL_RATE_LIMITED" },
    );
    calls = 0;
    global.fetch = async () => {
      calls++;
      throw new Error("private secret");
    };
    assert.equal(
      await contacts.sendEmail("to@tests.local", "Asunto", "<p>Prueba</p>"),
      false,
    );
    assert.equal(calls, 1);
  }));

test("Correo rechaza entradas o headers dañados sin contactar Resend", () =>
  isolated(async () => {
    global.fetch = () => assert.fail("No debe enviar un correo inválido");
    for (const args of [
      ["bad", "Asunto", "<p>Prueba</p>"],
      ["to@tests.local", "bad\r\nheader", "<p>Prueba</p>"],
      ["to@tests.local", "", "<p>Prueba</p>"],
      ["to@tests.local", "Asunto", ""],
      [
        "to@tests.local",
        "Asunto",
        "<p>Prueba</p>",
        { idempotencyKey: "bad\r\nheader" },
      ],
    ])
      await assert.rejects(
        contacts.sendEmail(args[0], args[1], args[2], {
          ...args[3],
          throwOnError: true,
        }),
        { status: 400, code: "EMAIL_INVALID" },
      );
  }));
