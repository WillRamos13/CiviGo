"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Esta prueba requiere PostgreSQL local.");
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
}

test(
  "Administración: crear usuarios y verificar correo con autorización, auditoría y sesión conservada",
  { skip: !connection, timeout: 60000 },
  async (t) => {
    const db = require("../src/lib/db");
    const { hashPassword, verifyPassword } = require("../src/lib/password");
    const { hashToken } = require("../src/lib/auth");
    const { DISTRICTS } = require("../src/lib/catalog");
    const app = require("../src/server");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const run = crypto.randomBytes(6).toString("hex");
    const password = "Fixture solo local 2026!";
    const users = [];
    let admin;
    let citizen;
    let agent;
    const body = (label, extra = {}) => ({
      nombres: "Prueba",
      apellidos: "Administración",
      nickname: `${run}_${label}`,
      correo: `${run}_${label}@gmail.com`,
      telefono: "+999" + crypto.randomInt(10000000000, 100000000000),
      fechaNacimiento: "1995-01-01",
      password,
      ...extra,
    });
    async function session(user) {
      const token = crypto.randomBytes(32).toString("hex");
      await db.session.create({
        data: {
          id: hashToken(token),
          usuarioId: user.id,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return { ...user, cookie: "civigo_session=" + token };
    }
    async function request(
      route,
      actor = admin,
      payload,
      method = payload === undefined ? "GET" : "POST",
    ) {
      const response = await fetch(base + route, {
        method,
        headers: {
          ...(actor ? { Cookie: actor.cookie } : {}),
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const json = await response.json();
      if (response.status === 201 && json.usuario?.id)
        users.push(json.usuario.id);
      return {
        status: response.status,
        json,
        cookie: response.headers.get("set-cookie"),
      };
    }
    try {
      const initial = body("operator");
      const operator = await db.user.create({
        data: {
          nombres: initial.nombres,
          apellidos: initial.apellidos,
          nombreUsuario: initial.nickname,
          correo: initial.correo,
          telefono: initial.telefono,
          password: await hashPassword(password),
          rol: "ADMIN",
          correoVerificado: true,
        },
      });
      users.push(operator.id);
      admin = await session(operator);
      await t.test(
        "Crear no cambia la sesión, normaliza Gmail y cifra la contraseña sin aceptar privilegios extras",
        async () => {
          const input = body("Citizen", {
            correo: `  ${run}_Citizen@GMAIL.COM  `,
            reputacion: 100,
            monedas: 9999,
            premium: true,
            telefonoVerificado: true,
          });
          const result = await request("/admin/users", admin, input);
          assert.equal(result.status, 201, JSON.stringify(result.json));
          assert.equal(result.cookie, null);
          assert.equal(
            result.json.usuario.correo,
            input.correo.trim().toLowerCase(),
          );
          assert.equal(result.json.usuario.rol, "USUARIO");
          assert.equal(result.json.usuario.correoVerificado, false);
          assert.equal(result.json.usuario.monedas, 0);
          assert.equal(result.json.usuario.premium, false);
          assert.equal(result.json.usuario.reputacion, null);
          assert.equal(JSON.stringify(result.json).includes(password), false);
          const stored = await db.user.findUnique({
            where: { id: result.json.usuario.id },
          });
          assert.equal(stored.telefonoVerificado, false);
          assert.equal(await verifyPassword(password, stored.password), true);
          citizen = await session(stored);
          assert.equal((await request("/users/me")).json.usuario.id, admin.id);
          const login = await request("/users/login", null, {
            correo: stored.correo,
            password,
          });
          assert.equal(login.status, 200);
          assert.equal(login.json.usuario.id, stored.id);
          await request(
            "/users/logout",
            { cookie: login.cookie.split(";")[0] },
            {},
          );
        },
      );
      await t.test(
        "Crear agentes respeta distrito y permisos; sólo ADMIN puede crear otros administradores",
        async () => {
          assert.equal(
            (
              await request(
                "/admin/users",
                admin,
                body("nodistrict", { rol: "AGENTE", tipoAgente: "SERENAZGO" }),
              )
            ).status,
            400,
          );
          const result = await request(
            "/admin/users",
            admin,
            body("agent", {
              rol: "AGENTE",
              tipoAgente: "SERENAZGO",
              distrito: DISTRICTS[0],
              permisos: ["revisar", "evidencia", "revisar"],
            }),
          );
          assert.equal(result.status, 201, JSON.stringify(result.json));
          assert.deepEqual(result.json.usuario.permisos, [
            "revisar",
            "evidencia",
          ]);
          agent = await session(result.json.usuario);
          const created = await request(
            "/admin/users",
            admin,
            body("manager", {
              rol: "ADMIN",
              correo: `${run}@civigo.test`,
              correoVerificado: true,
              motivoVerificacion:
                "Alta interna autorizada por el administrador.",
            }),
          );
          assert.equal(created.status, 201, JSON.stringify(created.json));
          assert.equal(created.json.usuario.correoVerificado, true);
          for (const actor of [null, citizen, agent]) {
            assert.equal(
              (await request("/admin/users", actor, body("forbidden"))).status,
              actor ? 403 : 401,
            );
            assert.equal(
              (
                await request(
                  `/admin/users/${citizen.id}`,
                  actor,
                  {
                    correoVerificado: true,
                    motivoVerificacion: "Intento no autorizado",
                  },
                  "PATCH",
                )
              ).status,
              actor ? 403 : 401,
            );
          }
        },
      );
      await t.test(
        "Validación manual exige motivo y booleano; revocarla vuelve a impedir participar",
        async () => {
          const route = `/admin/users/${citizen.id}`;
          for (const payload of [
            { correoVerificado: "true" },
            { correoVerificado: true },
            { correoVerificado: true, motivoVerificacion: "breve" },
          ])
            assert.equal(
              (await request(route, admin, payload, "PATCH")).status,
              400,
            );
          assert.equal(
            (await db.user.findUnique({ where: { id: citizen.id } }))
              .correoVerificado,
            false,
          );
          const reason =
            "Titularidad comprobada durante la revisión administrativa.";
          assert.equal(
            (
              await request(
                route,
                admin,
                { correoVerificado: true, motivoVerificacion: reason },
                "PATCH",
              )
            ).status,
            200,
          );
          const audit = await db.auditLog.findFirst({
            where: {
              accion: "VALIDAR_CORREO_ADMIN",
              entidadId: String(citizen.id),
            },
            orderBy: { id: "desc" },
          });
          assert.equal(audit.usuarioId, admin.id);
          assert.equal(audit.datos.motivo, reason);
          assert.equal(audit.datos.verificacionGoogleReal, false);
          assert.equal(
            (await request("/users/me", citizen)).json.usuario.correoVerificado,
            true,
          );
          assert.equal(
            (
              await request(
                route,
                admin,
                {
                  correoVerificado: false,
                  motivoVerificacion:
                    "Validación retirada tras nueva revisión del titular.",
                },
                "PATCH",
              )
            ).status,
            200,
          );
          assert.equal((await request("/reports", citizen, {})).status, 403);
          assert.equal((await request("/users/me")).json.usuario.id, admin.id);
        },
      );
      await t.test(
        "Errores de unicidad o identidad no dejan cuentas ni auditorías parciales",
        async () => {
          const count = await db.auditLog.count({
            where: { usuarioId: admin.id },
          });
          assert.equal(
            (
              await request(
                "/admin/users",
                admin,
                body("duplicate", { correo: citizen.correo }),
              )
            ).status,
            409,
          );
          for (const extra of [
            { fechaNacimiento: new Date().toISOString().slice(0, 10) },
            { password: "corta" },
            { correo: `${run}@example.test` },
            { permisos: ["inventado"] },
            { rol: "ROOT" },
            { correoVerificado: true },
          ])
            assert.equal(
              (await request("/admin/users", admin, body("invalid", extra)))
                .status,
              400,
            );
          assert.equal(
            await db.auditLog.count({ where: { usuarioId: admin.id } }),
            count,
          );
          const logs = await db.auditLog.findMany({
            where: { usuarioId: admin.id },
          });
          assert.equal(JSON.stringify(logs).includes(password), false);
        },
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.auditLog.deleteMany({
        where: {
          OR: [
            { usuarioId: { in: users } },
            { entidad: "USUARIO", entidadId: { in: users.map(String) } },
          ],
        },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  },
);
