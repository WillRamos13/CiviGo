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
  assert.deepEqual(report.proveedores[2].variablesPendientes, ["EMAIL_FROM"]);
  assert.deepEqual(report.proveedores[3].variablesPendientes, [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
  ]);
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
  assert.deepEqual(report.proveedores[3].variablesPendientes, []);
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
