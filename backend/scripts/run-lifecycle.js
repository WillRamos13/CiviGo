require("dotenv").config({ quiet: true });
const prisma = require("../src/lib/db");
const { processLifecycle } = require("../src/lib/lifecycle");
processLifecycle()
  .then((r) => console.log(JSON.stringify(r)))
  .catch((e) => {
    console.error("Falló la revisión de plazos:", e.code || e.name);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
