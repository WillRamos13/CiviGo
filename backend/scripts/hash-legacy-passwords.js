require("dotenv").config();
const prisma = require("../src/lib/db");
const { hashPassword, PREFIX } = require("../src/lib/password");
(async () => {
  const users = await prisma.user.findMany({ select: { id: true, password: true } });
  const pending = users.filter(row => !row.password.startsWith(PREFIX));
  console.log(`Contraseñas antiguas pendientes: ${pending.length}`);
  if (!process.argv.includes("--apply")) {
    console.log("Solo diagnóstico. Para convertirlas: npm run passwords:migrate -- --apply");
    return;
  }
  let count = 0;
  for (const user of pending) {
    const encoded = await hashPassword(user.password);
    const result = await prisma.user.updateMany({ where: { id: user.id, password: user.password }, data: { password: encoded } });
    count += result.count;
  }
  console.log(`Contraseñas convertidas: ${count}. No se muestran contraseñas en los registros.`);
})().catch(error => { console.error("Falló la conversión:", error.code || error.name); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
