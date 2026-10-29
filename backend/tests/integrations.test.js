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

test("Google verifica el Gmail y Resend envía códigos y recordatorios", () => {
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
    /recordatorios y códigos/,
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

test("búsqueda de imágenes requiere activación explícita y clave privada independiente de Firebase", () => {
  const missing = integrationChecklist({}, {});
  const pending = missing.proveedores.find(
    (provider) => provider.id === "imagenWeb",
  );
  assert.equal(pending.configurado, false);
  assert.deepEqual(pending.variablesPendientes, [
    "GOOGLE_VISION_API_KEY",
    "IMAGE_WEB_CHECK_ENABLED",
  ]);
  assert.match(pending.indicacion, /Cloud Vision API y la facturación/);
  assert.match(pending.indicacion, /solo en Railway/);
  assert.match(pending.aviso, /no acredita autoría ni autenticidad/);
  assert.match(pending.aviso, /otras aplicaciones/);
  const key = "private-vision-fixture";
  const configured = integrationChecklist(
    { GOOGLE_VISION_API_KEY: key, IMAGE_WEB_CHECK_ENABLED: "true" },
    {},
  );
  const provider = configured.proveedores.find(
    (entry) => entry.id === "imagenWeb",
  );
  assert.equal(provider.configurado, true);
  assert.deepEqual(provider.variablesPendientes, []);
  assert.equal(JSON.stringify(configured).includes(key), false);
  assert.equal(
    configured.frontend.variables.includes("GOOGLE_VISION_API_KEY"),
    false,
  );
  const disabled = integrationChecklist({ GOOGLE_VISION_API_KEY: key }, {});
  const paused = disabled.proveedores.find((entry) => entry.id === "imagenWeb");
  assert.equal(paused.configurado, false);
  assert.deepEqual(paused.variablesPendientes, ["IMAGE_WEB_CHECK_ENABLED"]);
  const noQuota = integrationChecklist(
    {
      GOOGLE_VISION_API_KEY: key,
      IMAGE_WEB_CHECK_ENABLED: "true",
      IMAGE_WEB_DAILY_LIMIT: "0",
    },
    {},
  );
  assert.match(
    noQuota.proveedores.find((entry) => entry.id === "imagenWeb").aviso,
    /pausadas por una cuota/,
  );
});
