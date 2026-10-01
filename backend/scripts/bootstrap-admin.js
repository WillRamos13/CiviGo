"use strict";
require("dotenv").config({ quiet: true });
const prisma = require("../src/lib/db");
async function bootstrap({
  database = prisma,
  email: requestedEmail = process.env.ADMIN_EMAIL,
  log = console.log,
} = {}) {
  const email = String(requestedEmail || "")
    .trim()
    .toLowerCase();
  if (!email)
    throw new Error(
      "Define ADMIN_EMAIL con el correo de la cuenta registrada que será el primer administrador.",
    );
  await database.appConfig.upsert({
    where: { clave: "bootstrap-admin-lock" },
    create: { clave: "bootstrap-admin-lock", valor: {} },
    update: {},
  });
  await database.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT clave FROM "AppConfig" WHERE clave = 'bootstrap-admin-lock' FOR UPDATE`;
      if (await db.user.count({ where: { rol: "ADMIN", bloqueado: false } }))
        throw new Error(
          "Ya existe un administrador activo. Usa su panel para asignar permisos.",
        );
      const user = await db.user.findUnique({ where: { correo: email } });
      if (!user || user.bloqueado)
        throw new Error("No hay una cuenta activa registrada con ese correo.");
      await db.user.update({ where: { id: user.id }, data: { rol: "ADMIN" } });
      await db.auditLog.create({
        data: {
          usuarioId: user.id,
          accion: "ADMIN_INICIAL",
          entidad: "User",
          entidadId: String(user.id),
          datos: { origen: "Script explícito ADMIN_EMAIL" },
        },
      });
    },
    { maxWait: 10000, timeout: 60000 },
  );
  log(
    "Administrador inicial preparado. La contraseña, el teléfono y el correo de la cuenta se conservaron.",
  );
}
if (require.main === module)
  bootstrap()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
module.exports = { bootstrap };
