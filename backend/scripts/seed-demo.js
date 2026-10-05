require("dotenv").config({ quiet: true });
const crypto = require("node:crypto");
const prisma = require("../src/lib/db");
const { seed } = require("./seed");
const { hashPassword } = require("../src/lib/password");
async function seedDemo() {
  if (process.env.NODE_ENV === "production")
    throw new Error("No se crean cuentas de demostración en producción.");
  let local = false;
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    local =
      ["postgresql:", "postgres:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    throw new Error("Define DATABASE_URL con una conexión PostgreSQL válida.");
  }
  if (!local && process.env.ALLOW_REMOTE_DEMO_SEED !== "true")
    throw new Error(
      "Las cuentas demo solo se crean en la base local por defecto. Configura ALLOW_REMOTE_DEMO_SEED=true de forma explícita para una base remota de prueba.",
    );
  await seed();
  const credential =
    process.env.DEMO_PASSWORD || crypto.randomBytes(18).toString("base64url");
  const roles = [
    ["admin", "ADMIN"],
    ["agente", "AGENTE"],
    ["ciudadano", "USUARIO"],
  ];
  for (const [nickname, rol] of roles) {
    const correo = nickname + "@demo.civigo.local";
    if (await prisma.user.findUnique({ where: { correo } })) {
      console.log(
        "Cuenta demo existente:",
        correo,
        "(credenciales conservadas)",
      );
      continue;
    }
    await prisma.user.create({
      data: {
        nombreUsuario: "demo_" + nickname,
        nombres: "Demostración",
        apellidos: "CiviGo",
        correo,
        telefono: "+5190000000" + roles.findIndex((r) => r[0] === nickname),
        password: await hashPassword(credential),
        telefonoVerificado: false,
        correoVerificado: true,
        rol,
        reputacion: null,
        fechaNacimiento: new Date("2000-01-01"),
        tipoAgente: rol === "AGENTE" ? "COLABORADOR" : null,
        permisos:
          rol === "AGENTE"
            ? ["revisar", "resolver", "reabrir", "evidencia"]
            : [],
      },
    });
    console.log("Cuenta demo creada:", correo);
  }
  console.log(
    "La contraseña demo procede de DEMO_PASSWORD o fue generada aleatoriamente y no se imprime. Usa DEMO_PASSWORD explícita para poder iniciar sesión.",
  );
}
if (require.main === module)
  seedDemo()
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
module.exports = { seedDemo };
