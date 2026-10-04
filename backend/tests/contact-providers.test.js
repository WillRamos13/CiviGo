const test = require("node:test");
const assert = require("node:assert/strict");
const contacts = require("../src/lib/contact-providers");

const keys = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "NODE_ENV",
  "DEMO_VERIFICATION",
];
async function isolated(work) {
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  for (const key of keys) delete process.env[key];
  process.env.TWILIO_ACCOUNT_SID = "AC" + "a".repeat(32);
  process.env.TWILIO_AUTH_TOKEN = "fixture-private-not-a-real-key";
  process.env.TWILIO_VERIFY_SERVICE_SID = "VA" + "b".repeat(32);
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
const phone = "+51900000001";
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

test("El estado de contacto valida configuración y jamás publica secretos", () =>
  isolated(async () => {
    assert.equal(contacts.contactServices().telefono.configurado, true);
    assert.equal(contacts.contactServices().correo.configurado, true);
    assert.ok(!JSON.stringify(contacts.contactServices()).includes("fixture-"));
    process.env.TWILIO_VERIFY_SERVICE_SID = "invalid/extra-path";
    process.env.EMAIL_FROM = "invalid-address";
    global.fetch = () =>
      assert.fail("Configuración inválida no debe contactar un proveedor");
    assert.equal(contacts.contactServices().telefono.configurado, false);
    assert.equal(contacts.contactServices().correo.configurado, false);
    await assert.rejects(contacts.requestPhone(phone), {
      status: 503,
      code: "PHONE_PROVIDER_MISSING",
    });
    assert.equal(
      await contacts.sendEmail("to@tests.local", "Asunto", "<p>Prueba</p>"),
      false,
    );
    process.env.TWILIO_VERIFY_SERVICE_SID = "VA" + "b".repeat(32);
    process.env.TWILIO_AUTH_TOKEN = "   ";
    assert.equal(contacts.contactServices().telefono.configurado, false);
    process.env.NODE_ENV = "production";
    process.env.DEMO_VERIFICATION = "true";
    assert.equal(contacts.contactServices().telefono.demo, false);
  }));

test("Twilio Verify manda cada solicitud una sola vez y solo acepta el estado esperado", () =>
  isolated(async () => {
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      assert.equal(
        url,
        "https://verify.twilio.com/v2/Services/VA" +
          "b".repeat(32) +
          "/Verifications",
      );
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(
        options.headers["Content-Type"],
        "application/x-www-form-urlencoded",
      );
      assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), {
        To: phone,
        Channel: "whatsapp",
        Locale: "es",
      });
      return response({
        status: "pending",
        to: phone,
        arbitraryPrivateData: "must-not-return",
      });
    };
    assert.deepEqual(await contacts.requestPhone(phone, "whatsapp"), {
      status: "pending",
    });
    assert.equal(calls, 1);
    for (const invalid of ["approved", "failed", "expired", null, undefined]) {
      global.fetch = async () => response({ status: invalid });
      await assert.rejects(contacts.requestPhone(phone), {
        status: 503,
        code: "PHONE_PROVIDER_INVALID_RESPONSE",
      });
    }
    calls = 0;
    global.fetch = async () => {
      calls++;
      throw new Error("secret fixture must stay private");
    };
    await assert.rejects(
      contacts.requestPhone(phone),
      (error) => error.status === 503 && !error.message.includes("secret"),
    );
    assert.equal(calls, 1, "Un timeout no debe duplicar SMS/WhatsApp");
  }));

test("Teléfonos, canales y códigos inválidos no realizan llamadas cobrables", () =>
  isolated(async () => {
    global.fetch = () =>
      assert.fail("La validación debe ocurrir antes de la red");
    for (const value of ["900000001", " +51900000001", "https://bad", null, {}])
      await assert.rejects(contacts.requestPhone(value), {
        status: 400,
        code: "PHONE_INVALID",
      });
    await assert.rejects(contacts.requestPhone(phone, "call"), {
      status: 400,
      code: "PHONE_CHANNEL_INVALID",
    });
    for (const code of ["abcde", "123", "12345678901", 123456, null])
      await assert.rejects(contacts.checkPhone(phone, code), {
        status: 400,
        code: "PHONE_CODE_INVALID",
      });
  }));

test("Twilio distingue código erróneo, vencido, límites y canal sin habilitar", () =>
  isolated(async () => {
    global.fetch = async () => response({ status: "pending", valid: true });
    assert.equal(await contacts.checkPhone(phone, "123456"), false);
    global.fetch = async () => response({ status: "approved", valid: false });
    assert.equal(
      await contacts.checkPhone(phone, "123456"),
      true,
      "El contrato usa status, no valid legado",
    );
    global.fetch = async () => response({ status: "unknown" });
    await assert.rejects(contacts.checkPhone(phone, "123456"), {
      status: 503,
      code: "PHONE_PROVIDER_INVALID_RESPONSE",
    });
    global.fetch = async () =>
      response({ code: 20404, message: "secret raw provider text" }, 404);
    await assert.rejects(contacts.checkPhone(phone, "123456"), {
      status: 400,
      code: "PHONE_CODE_EXPIRED",
    });
    await assert.rejects(contacts.requestPhone(phone), {
      status: 503,
      code: "PHONE_PROVIDER_UNAVAILABLE",
    });
    for (const code of [60202, 60203, 60207, 20429]) {
      global.fetch = async () => response({ code }, 400);
      await assert.rejects(contacts.requestPhone(phone), {
        status: 429,
        code: "PHONE_RATE_LIMITED",
      });
    }
    global.fetch = async () => response({ code: 68008 }, 400);
    await assert.rejects(contacts.requestPhone(phone, "whatsapp"), {
      status: 503,
      code: "PHONE_CHANNEL_UNAVAILABLE",
    });
    global.fetch = async () => response({ code: 20003 }, 401);
    await assert.rejects(contacts.requestPhone(phone), {
      status: 503,
      code: "PHONE_PROVIDER_CONFIG",
    });
    global.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new Error("damaged");
      },
    });
    await assert.rejects(contacts.checkPhone(phone, "123456"), {
      status: 503,
      code: "PHONE_PROVIDER_INVALID_RESPONSE",
    });
  }));

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
