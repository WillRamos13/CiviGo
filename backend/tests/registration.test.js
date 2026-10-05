const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Prisma } = require("@prisma/client");
const { HttpError } = require("../src/lib/http");
const { verifyPassword } = require("../src/lib/password");

test("Registro HTTP y errores internos sin base de datos ni proveedores", async (t) => {
  const environment = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:1/registration_test",
    TRUST_PROXY: "false",
    FRONTEND_URL: "http://registration.test",
    ENABLE_JOBS: "false",
    COOKIE_SAME_SITE: "lax",
    ROADS_FILE: path.join(
      __dirname,
      `missing-registration-roads-${process.pid}.json`,
    ),
    AI_API_KEY: "",
    OPENAI_API_KEY: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
  };
  const previous = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  const previousPrisma = globalThis.__civigoPrisma;
  const logs = [];
  let server;
  try {
    Object.assign(process.env, environment);
    // El servidor usa su configuración real, pero no lee el .env local.
    t.mock.method(require("dotenv"), "config", () => ({ parsed: {} }));
    t.mock.method(console, "error", (...args) => logs.push(args));
    const unexpectedDatabaseCall = async () => {
      throw new Error("La prueba no debe acceder a una base de datos.");
    };
    // db.js permite inyectar el cliente; los delegados planos evitan que los
    // proxies de Prisma impidan usar mock.method y nunca abren conexiones.
    globalThis.__civigoPrisma = {
      $connect: unexpectedDatabaseCall,
      user: { create: unexpectedDatabaseCall },
      session: {
        create: unexpectedDatabaseCall,
        findUnique: unexpectedDatabaseCall,
      },
      incident: { findMany: unexpectedDatabaseCall },
    };
    const prisma = require("../src/lib/db");
    t.mock.method(prisma, "$connect", unexpectedDatabaseCall);
    t.mock.method(prisma.user, "create", unexpectedDatabaseCall);
    t.mock.method(prisma.session, "create", unexpectedDatabaseCall);
    t.mock.method(prisma.session, "findUnique", unexpectedDatabaseCall);
    t.mock.method(prisma.incident, "findMany", unexpectedDatabaseCall);

    const app = require("../src/server");
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = "http://127.0.0.1:" + server.address().port;
    const password = "clave-ficticia-registro-123";
    const input = {
      nickname: "  Vecino de Ica  ",
      nombres: "  Ana  ",
      apellidos: "  Pérez  ",
      fechaNacimiento: "2000-01-01",
      correo: "  ANA@GMAIL.COM  ",
      telefono: "(912) 345-678",
      password,
    };
    async function register(body = input) {
      const response = await fetch(base + "/api/users/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
        },
        body: JSON.stringify(body),
      });
      return { response, body: await response.json() };
    }
    function mockSuccessfulRegistration(context) {
      const create = context.mock.method(
        prisma.user,
        "create",
        async ({ data }) => ({
          id: 91,
          ...data,
          permisos: [],
          sesiones: ["sesion-privada-ficticia"],
          bloqueado: false,
          telefonoVerificado: false,
          correoVerificado: false,
        }),
      );
      const session = context.mock.method(
        prisma.session,
        "create",
        async ({ data }) => data,
      );
      return { create, session };
    }

    await t.test(
      "nickname crea nombreUsuario, normaliza datos y descarta privilegios enviados",
      async (context) => {
        const { create, session } = mockSuccessfulRegistration(context);
        const { response, body } = await register({
          ...input,
          nombreUsuario: "alias ignorado",
          rol: "ADMIN",
          permisos: ["administrar", "revisar"],
          premium: true,
          reputacion: 100,
          bloqueado: false,
        });
        assert.equal(response.status, 201);
        assert.equal(create.mock.callCount(), 1);
        const { data } = create.mock.calls[0].arguments[0];
        assert.equal(data.nombreUsuario, "Vecino de Ica");
        assert.equal(data.nombres, "Ana");
        assert.equal(data.apellidos, "Pérez");
        assert.equal(data.correo, "ana@gmail.com");
        assert.equal(data.telefono, "+51912345678");
        assert.equal(
          data.fechaNacimiento.toISOString(),
          "2000-01-01T00:00:00.000Z",
        );
        assert.equal(data.rol, "USUARIO");
        assert.equal(data.reputacion, null);
        for (const field of ["nickname", "permisos", "premium", "bloqueado"])
          assert.equal(Object.hasOwn(data, field), false);
        assert.match(data.password, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
        assert.notEqual(data.password, password);
        assert(await verifyPassword(password, data.password));
        assert.equal(session.mock.callCount(), 1);
        assert.equal(session.mock.calls[0].arguments[0].data.usuarioId, 91);
        assert.match(
          response.headers.get("set-cookie"),
          /civigo_session=[a-f0-9]{64}.*HttpOnly/,
        );
        assert.equal(body.usuario.nickname, "Vecino de Ica");
        assert.equal(body.usuario.nombreUsuario, "Vecino de Ica");
        assert.equal(body.usuario.rol, "USUARIO");
        assert.deepEqual(body.usuario.permisos, []);
        assert.equal(Object.hasOwn(body.usuario, "password"), false);
        assert.equal(Object.hasOwn(body.usuario, "sesiones"), false);
        assert.equal(Object.hasOwn(body.usuario, "telefonoVerificado"), false);
        assert.equal(JSON.stringify(body).includes(password), false);
        assert.equal(JSON.stringify(body).includes(data.password), false);
      },
    );

    await t.test(
      "un registro sin nickname ni nombreUsuario falla antes de Prisma",
      async (context) => {
        const { create, session } = mockSuccessfulRegistration(context);
        const { nickname, ...withoutNickname } = input;
        const { response, body } = await register(withoutNickname);
        assert.equal(response.status, 400);
        assert.deepEqual(body, { error: "Nickname inválido." });
        assert.equal(create.mock.callCount(), 0);
        assert.equal(session.mock.callCount(), 0);
      },
    );

    await t.test(
      "el registro nuevo exige Gmail sin aceptar otro proveedor o un dominio parecido",
      async (context) => {
        const { create, session } = mockSuccessfulRegistration(context);
        for (const correo of [
          "persona@example.com",
          "persona@gmail.com.attacker.test",
          "persona@googlemail.com",
        ]) {
          const { response, body } = await register({ ...input, correo });
          assert.equal(response.status, 400);
          assert.equal(body.code, "EMAIL_GMAIL_REQUIRED");
        }
        assert.equal(create.mock.callCount(), 0);
        assert.equal(session.mock.callCount(), 0);
      },
    );

    await t.test(
      "los correos incompatibles con el proveedor se rechazan antes de crear la cuenta",
      async (context) => {
        const { create, session } = mockSuccessfulRegistration(context);
        for (const correo of [
          "a@@example.com",
          "a<b@example.com",
          "a>b@example.com",
        ]) {
          const { response, body } = await register({ ...input, correo });
          assert.equal(response.status, 400);
          assert.deepEqual(body, { error: "Correo inválido." });
          assert.equal(response.headers.get("set-cookie"), null);
        }
        assert.equal(create.mock.callCount(), 0);
        assert.equal(session.mock.callCount(), 0);
      },
    );

    await t.test(
      "nombreUsuario sigue siendo un alias válido para el registro",
      async (context) => {
        const { create, session } = mockSuccessfulRegistration(context);
        const { nickname, ...withoutNickname } = input;
        const { response, body } = await register({
          ...withoutNickname,
          nombreUsuario: "  Alias antiguo  ",
        });
        assert.equal(response.status, 201);
        assert.equal(
          create.mock.calls[0].arguments[0].data.nombreUsuario,
          "Alias antiguo",
        );
        assert.equal(body.usuario.nickname, "Alias antiguo");
        assert.equal(session.mock.callCount(), 1);
      },
    );

    await t.test(
      "la validación de Prisma no expone contraseñas en respuestas ni logs",
      async (context) => {
        const sentinel = "password-ficticio-no-debe-filtrarse";
        const error = new Prisma.PrismaClientValidationError(
          `Invalid prisma.user.create: password: "${sentinel}". Argument nombreUsuario is missing.`,
          { clientVersion: "registration-test" },
        );
        context.mock.method(prisma.user, "create", async () => {
          throw error;
        });
        const session = context.mock.method(
          prisma.session,
          "create",
          unexpectedDatabaseCall,
        );
        const logCount = logs.length;
        const { response, body } = await register({
          ...input,
          password: sentinel,
        });
        assert.equal(response.status, 500);
        assert.deepEqual(body, {
          error: "El servicio no pudo completar la solicitud.",
        });
        assert.equal(session.mock.callCount(), 0);
        assert.equal(logs.length, logCount + 1);
        assert.deepEqual(logs.at(-1), [
          "Error de API:",
          "PrismaClientValidationError",
          "en",
          "POST",
          "/api/users/register",
        ]);
        assert.equal(JSON.stringify(body).includes(sentinel), false);
        assert.equal(JSON.stringify(logs).includes(sentinel), false);
        assert.equal(JSON.stringify(logs).includes(error.message), false);
      },
    );

    await t.test(
      "un error desconocido con status 503 devuelve el mensaje genérico",
      async (context) => {
        const error = Object.assign(
          new Error("Detalle interno privado y ficticio"),
          { status: 503 },
        );
        context.mock.method(prisma.user, "create", async () => {
          throw error;
        });
        const { response, body } = await register();
        assert.equal(response.status, 503);
        assert.deepEqual(body, {
          error: "El servicio no pudo completar la solicitud.",
        });
        assert.equal(JSON.stringify(logs).includes(error.message), false);
      },
    );

    await t.test(
      "un HttpError 503 conserva el mensaje y código controlados",
      async (context) => {
        const error = new HttpError(
          503,
          "Registro temporalmente no disponible.",
          "REGISTRATION_UNAVAILABLE",
        );
        context.mock.method(prisma.user, "create", async () => {
          throw error;
        });
        const { response, body } = await register();
        assert.equal(response.status, 503);
        assert.deepEqual(body, {
          error: "Registro temporalmente no disponible.",
          code: "REGISTRATION_UNAVAILABLE",
        });
      },
    );

    await t.test(
      "la falta de datos de calles mantiene el error 503 público",
      async () => {
        const response = await fetch(base + "/api/navigation/roads", {
          headers: { Connection: "close" },
        });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
          error:
            "No hay datos de calles disponibles. Ejecuta npm run roads:import en el backend.",
          code: "ROADS_UNAVAILABLE",
        });
      },
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    t.mock.restoreAll();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousPrisma === undefined) delete globalThis.__civigoPrisma;
    else globalThis.__civigoPrisma = previousPrisma;
  }
});
