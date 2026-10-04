require("dotenv").config({ quiet: true });
const { integrationChecklist } = require("../src/lib/integrations");

const report = integrationChecklist();
console.log(
  "Integraciones CiviGo: revisión de configuración, sin llamadas externas.",
);
for (const provider of report.proveedores) {
  console.log(
    `${provider.nombre}: ${provider.configurado ? "configuración presente" : "pendiente o inválida"}`,
  );
  if (provider.variablesPendientes.length)
    console.log(
      "  Variables pendientes: " + provider.variablesPendientes.join(", "),
    );
  console.log("  " + provider.indicacion);
  if (provider.aviso) console.log("  " + provider.aviso);
}
console.log(
  "Frontend: " + report.frontend.variables.join(", ") + " en Vercel.",
);
console.log(
  "Una configuración presente no confirma que el proveedor esté habilitado ni que tenga saldo.",
);
if (
  process.argv.includes("--strict") &&
  report.proveedores.some((p) => !p.configurado)
)
  process.exitCode = 1;
