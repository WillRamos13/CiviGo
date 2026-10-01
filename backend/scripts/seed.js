require("dotenv").config({ quiet: true });
const prisma = require("../src/lib/db");
const { seedCatalog, CATALOG, DEFAULT_CONFIG } = require("../src/lib/catalog");
async function seed() {
  await seedCatalog();
  await prisma.appConfig.upsert({
    where: { clave: "reglas" },
    update: {},
    create: { clave: "reglas", valor: DEFAULT_CONFIG },
  });
  const types = await prisma.incidentType.findMany();
  for (const type of types) {
    await prisma.report.updateMany({
      where: { tipo: type.nombre, tipoId: null },
      data: { tipoId: type.id },
    });
    await prisma.incident.updateMany({
      where: { tipo: type.nombre, tipoId: null },
      data: {
        tipoId: type.id,
        individual: type.individual,
        historico: type.historico,
        emergencia: type.emergencia,
        persistente: type.persistente,
      },
    });
  }
  console.log(
    "Catálogo y reglas iniciales preparados; no se modificaron credenciales ni se eliminaron registros.",
  );
}
if (require.main === module)
  seed()
    .catch((e) => {
      console.error("No se pudo preparar el catálogo:", e.code || e.name);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
module.exports = { seed };
