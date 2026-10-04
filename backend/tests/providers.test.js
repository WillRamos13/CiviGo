const test = require("node:test");
const assert = require("node:assert/strict");
const providers = require("../src/lib/providers");
const keys = [
  "NODE_ENV",
  "DEMO_VERIFICATION",
  "AI_API_KEY",
  "OPENAI_API_KEY",
  "AI_MODEL",
  "AI_BASE_URL",
  "AI_TIMEOUT_MS",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
  "RESEND_API_KEY",
  "EMAIL_FROM",
];
async function isolated(work) {
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const previousFetch = global.fetch;
  for (const k of keys) delete process.env[k];
  try {
    await work();
  } finally {
    global.fetch = previousFetch;
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("Los proveedores ausentes declaran su estado y no inventan envíos ni evaluaciones", () =>
  isolated(async () => {
    global.fetch = async () => {
      throw new Error("No debe invocarse ninguna red");
    };
    assert.equal(providers.services().ia.configurado, false);
    assert.equal(providers.services().telefono.configurado, false);
    assert.equal(providers.services().correo.configurado, false);
    assert.equal(
      await providers.evaluateReport(
        { descripcion: "Ensayo" },
        { nombre: "Incendio", slug: "incendio" },
      ),
      null,
    );
    assert.equal(await providers.assist("Ayuda", {}), null);
    assert.equal(
      await providers.sendEmail(
        "fixture@tests.local",
        "Ensayo",
        "<p>Ensayo</p>",
      ),
      false,
    );
    await assert.rejects(providers.requestPhone("+51900000001"), {
      status: 503,
      code: "PHONE_PROVIDER_MISSING",
    });
    process.env.NODE_ENV = "production";
    process.env.DEMO_VERIFICATION = "true";
    assert.equal(providers.services().telefono.demo, false);
  }));

test("El adaptador IA valida gravedad, tipos propuestos y respuestas dañadas", () =>
  isolated(async () => {
    process.env.AI_API_KEY = "fixture-token-without-provider";
    let content;
    global.fetch = async (url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.store, false);
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(request.text?.format?.type, "json_schema");
      return {
        ok: true,
        json: async () => ({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: content }],
            },
          ],
        }),
      };
    };
    const input = {
      descripcion: "Dato de prueba, no un hecho real",
      fechaEvento: new Date(),
    };
    content = JSON.stringify({
      gravedad: 4,
      posibleFalso: true,
      motivo: "Revisar",
      emergenciaActiva: false,
      tipoPropuesto: {
        nombre: "Estructura dañada",
        categoriaSlug: "infraestructura",
      },
    });
    const ordinary = await providers.evaluateReport(input, {
      nombre: "Incendio",
      slug: "incendio",
    });
    assert.equal(ordinary.gravedad, 4);
    assert.equal(ordinary.posibleFalso, true);
    assert.equal(ordinary.tipoPropuesto, null);
    assert.equal(
      (
        await providers.evaluateReport(input, {
          nombre: "Otro incidente",
          slug: "otro",
        })
      ).tipoPropuesto.nombre,
      "Estructura dañada",
    );
    for (const invalid of [
      "JSON roto",
      JSON.stringify({ gravedad: 6 }),
      { unsafe: "object" },
      JSON.stringify({ gravedad: "4" }),
    ]) {
      content = invalid;
      assert.equal(
        await providers.evaluateReport(input, {
          nombre: "Incendio",
          slug: "incendio",
        }),
        null,
      );
    }
    global.fetch = async () => {
      throw new Error("Proveedor no disponible");
    };
    assert.equal(
      await providers.evaluateReport(input, {
        nombre: "Incendio",
        slug: "incendio",
      }),
      null,
    );
  }));

test("SMS/WhatsApp y correo usan los contratos de sus proveedores sin exponer credenciales", () =>
  isolated(async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC" + "a".repeat(32);
    process.env.TWILIO_AUTH_TOKEN = "fixture-token";
    process.env.TWILIO_VERIFY_SERVICE_SID = "VA" + "b".repeat(32);
    let status = "pending";
    global.fetch = async (url, options) => {
      assert.ok(url.startsWith("https://verify.twilio.com/"));
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("To"), "+51900000001");
      if (url.endsWith("/Verifications"))
        assert.equal(body.get("Channel"), "whatsapp");
      else assert.equal(body.get("Code"), "123456");
      return { ok: true, json: async () => ({ status }) };
    };
    await providers.requestPhone("+51900000001", "whatsapp");
    assert.equal(await providers.checkPhone("+51900000001", "123456"), false);
    status = "approved";
    assert.equal(await providers.checkPhone("+51900000001", "123456"), true);
    await assert.rejects(providers.requestPhone("+51900000001", "invalid"), {
      status: 400,
    });
    process.env.RESEND_API_KEY = "fixture-resend";
    process.env.EMAIL_FROM = "CiviGo <fixture@tests.local>";
    global.fetch = async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.deepEqual(JSON.parse(options.body).to, ["fixture@tests.local"]);
      return { ok: true, json: async () => ({ id: "fixture-mail" }) };
    };
    assert.equal(
      await providers.sendEmail(
        "fixture@tests.local",
        "Ensayo",
        "<p>Ensayo</p>",
      ),
      true,
    );
    global.fetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    assert.equal(
      await providers.sendEmail(
        "fixture@tests.local",
        "Ensayo",
        "<p>Ensayo</p>",
      ),
      false,
    );
    assert.ok(!JSON.stringify(providers.services()).includes("fixture-token"));
  }));
