"use strict";

const crypto = require("node:crypto");
const { hashPassword, verifyPassword } = require("../src/lib/password");

/** Explicitly requested demo accounts, not Google mailboxes or OAuth proofs. */
async function createDemoUsers({ database, count = 2 } = {}) {
  if (!database || !Number.isInteger(count) || count < 1 || count > 2)
    throw new Error(
      "La creación explícita permite una o dos cuentas de prueba.",
    );
  const run = crypto.randomBytes(6).toString("hex");
  const accounts = [];
  for (let index = 1; index <= count; index++) {
    const password = crypto.randomBytes(18).toString("base64url");
    const suffix = crypto.randomInt(10000000000, 100000000000).toString();
    accounts.push({
      password,
      data: {
        nombreUsuario: `demo${index}_${run}`,
        nombres: "Usuario de prueba",
        apellidos: `CiviGo ${index}`,
        fechaNacimiento: new Date("2000-01-01T00:00:00Z"),
        correo: `demo${index}.${run}@civigo.test`,
        // Reserved, non-routable country prefix: no actual person's phone.
        telefono: "+999" + suffix,
        password: await hashPassword(password),
        rol: "USUARIO",
        correoVerificado: true,
        telefonoVerificado: false,
        bloqueado: false,
        reputacion: null,
      },
    });
  }
  const created = await database.$transaction(async (db) => {
    const result = [];
    for (const account of accounts) {
      const user = await db.user.create({ data: account.data });
      await db.auditLog.create({
        data: {
          usuarioId: user.id,
          accion: "CUENTA_DEMO_VERIFICADA",
          entidad: "User",
          entidadId: String(user.id),
          datos: {
            origen: "Solicitud explícita del propietario",
            correoVerificado: true,
            verificacionGoogleReal: false,
          },
        },
      });
      result.push({
        id: user.id,
        correo: user.correo,
        nickname: user.nombreUsuario,
        password: account.password,
      });
    }
    return result;
  });
  // Verify actual stored hashes and flags before handing out credentials.
  for (const account of created) {
    const stored = await database.user.findUnique({
      where: { id: account.id },
    });
    if (
      !stored ||
      stored.rol !== "USUARIO" ||
      stored.correoVerificado !== true ||
      stored.bloqueado ||
      !(await verifyPassword(account.password, stored.password))
    )
      throw new Error("No se pudo comprobar el acceso de las cuentas nuevas.");
  }
  return created;
}

async function main() {
  if (!process.argv.includes("--apply"))
    throw new Error(
      "Usa --apply para crear dos cuentas nuevas en la base configurada. No se modifican cuentas existentes.",
    );
  require("dotenv").config({ quiet: true });
  const database = require("../src/lib/db");
  const output = process.env.DEMO_ACCOUNTS_OUTPUT;
  let destination;
  let outputHandle;
  try {
    if (output) {
      const fs = require("node:fs/promises");
      const path = require("node:path");
      const local = path.resolve(__dirname, "../.local");
      destination = path.resolve(output);
      if (!destination.startsWith(local + path.sep))
        throw new Error(
          "La salida privada debe permanecer dentro de backend/.local.",
        );
      await fs.mkdir(path.dirname(destination), { recursive: true });
      // Reserve a private new file before any DB mutation; never overwrite.
      outputHandle = await fs.open(destination, "wx", 0o600);
    }
    const accounts = await createDemoUsers({ database });
    if (outputHandle) {
      await outputHandle.writeFile(JSON.stringify(accounts, null, 2));
      console.log(
        "Dos cuentas de prueba verificadas creadas y comprobadas. Accesos guardados en el archivo privado indicado.",
      );
    } else {
      // An explicit operator run prints its own new credentials, never DB URLs.
      console.log(JSON.stringify(accounts, null, 2));
    }
  } finally {
    if (outputHandle) await outputHandle.close();
    await database.$disconnect();
  }
}

if (require.main === module)
  main().catch(() => {
    console.error(
      "No se pudieron preparar las cuentas: revisa conexión, permisos o salida privada. No se muestran secretos de conexión.",
    );
    process.exitCode = 1;
  });

module.exports = { createDemoUsers };
