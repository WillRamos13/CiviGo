const test = require("node:test");
const assert = require("node:assert/strict");
const { integrationChecklist } = require("../src/lib/integrations");

test("el diagnóstico enumera requisitos sin afirmar llamadas reales ni exponer valores", () => {
  const secret = "private-test-value-not-an-api-key";
  const report = integrationChecklist(
    {
      OPENAI_API_KEY: secret,
      RESEND_API_KEY: secret,
      STORAGE_PROVIDER: "supabase",
    },
    {
      ia: { configurado: true },
      telefono: { configurado: false },
      correo: { configurado: false },
      almacenamiento: { configurado: false, tipo: "supabase" },
    },
  );
  assert.equal(report.alcance, "configuracion");
  assert.equal(report.conexionesProbadas, false);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.deepEqual(report.proveedores[0].variablesPendientes, []);
  assert.deepEqual(
    report.proveedores.find((p) => p.id === "correo").variablesPendientes,
    ["EMAIL_FROM"],
  );
  assert.deepEqual(
    report.proveedores.find((p) => p.id === "almacenamiento")
      .variablesPendientes,
    ["SUPABASE_URL", "SUPABASE_SECRET_KEY"],
  );
});

test("el diagnóstico reconoce los alias existentes y no exige claves del mapa en Railway", () => {
  const report = integrationChecklist(
    {
      AI_API_KEY: "legacy-fixture",
      SUPABASE_URL: "https://fixture.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-storage-fixture",
    },
    {
      ia: { configurado: true },
      telefono: { configurado: false },
      correo: { configurado: false },
      almacenamiento: { configurado: true, tipo: "supabase" },
    },
  );
  assert.deepEqual(report.proveedores[0].variablesPendientes, []);
  assert.deepEqual(
    report.proveedores.find((p) => p.id === "almacenamiento")
      .variablesPendientes,
    [],
  );
  assert.ok(report.frontend.variables.includes("NEXT_PUBLIC_MAPBOX_TOKEN"));
  assert.ok(
    report.proveedores.every(
      (p) => !p.variablesPendientes.includes("NEXT_PUBLIC_MAPBOX_TOKEN"),
    ),
  );
});

test("configuración presente pero inválida produce una orientación sin mostrar valores", () => {
  const report = integrationChecklist(
    { OPENAI_API_KEY: "private-fixture" },
    { ia: { configurado: false } },
  );
  assert.match(report.proveedores[0].aviso, /configuración no es válida/);
  assert.equal(JSON.stringify(report).includes("private-fixture"), false);
});

test("Google es la única verificación y Resend queda para recordatorios", () => {
  const report = integrationChecklist(
    {},
    { correoGoogle: { configurado: false } },
  );
  assert.ok(!report.proveedores.some((p) => p.id === "telefono"));
  assert.deepEqual(
    report.proveedores.find((p) => p.id === "correoGoogle").variablesPendientes,
    ["FIREBASE_PROJECT_ID"],
  );
  assert.match(
    report.proveedores.find((p) => p.id === "correo").indicacion,
    /recordatorios, no verifica/,
  );
  assert.ok(report.frontend.variables.includes("NEXT_PUBLIC_FIREBASE_API_KEY"));
});

test("un modelo inválido no presenta ambas funciones de OpenAI como configuradas", () => {
  const report = integrationChecklist(
    { OPENAI_API_KEY: "private-fixture" },
    {
      ia: {
        configurado: true,
        configuracionValida: false,
        chatConfigurado: true,
        reportesConfigurado: false,
      },
    },
  );
  const provider = report.proveedores.find((item) => item.id === "ia");
  assert.equal(provider.configurado, false);
  assert.match(provider.aviso, /configuración no es válida/);
  assert.match(provider.indicacion, /AI_REPORT_MODEL/);
  assert.match(provider.indicacion, /AI_CHAT_MODEL/);
  assert.equal(JSON.stringify(report).includes("private-fixture"), false);
});
