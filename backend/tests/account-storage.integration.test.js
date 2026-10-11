const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  if (!["127.0.0.1", "localhost"].includes(new URL(connection).hostname))
    throw new Error("Requires local test database");
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
}
test(
  "Password recovery is private, expiring, single-use and revokes sessions; upload quotas survive deletions",
  { skip: !connection, timeout: 60000 },
  async (t) => {
    const db = require("../src/lib/db");
    const { hashPassword, verifyPassword } = require("../src/lib/password");
    const {
      requestReset,
      finishReset,
      changePassword,
    } = require("../src/lib/password-reset");
    const {
      reserveUpload,
      claimOrphan,
      removeClaimed,
      cleanupUploads,
    } = require("../src/lib/upload-quota");
    const run = crypto.randomUUID();
    const user = await db.user.create({
      data: {
        nombreUsuario: run,
        correo: run + "@gmail.com",
        telefono: run,
        password: await hashPassword("Old-password123!"),
      },
    });
    const files = new Set();
    const emails = [];
    const send = async (...args) => {
      emails.push(args);
      return true;
    };
    const session = async () =>
      db.session.create({
        data: {
          id: crypto.randomBytes(32).toString("hex"),
          usuarioId: user.id,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    const row = (extra) => ({
      id: crypto.randomUUID(),
      usuarioId: user.id,
      nombre: "test.jpg",
      mimeType: "image/jpeg",
      path: "pending:" + crypto.randomUUID(),
      privado: false,
      tipo: "PUBLICO",
      size: 10,
      ...extra,
    });
    try {
      await t.test(
        "Unknown email and cooldown produce no extra email; raw token is not stored",
        async () => {
          await requestReset(db, "unknown-" + run + "@gmail.com", send);
          assert.equal(emails.length, 0);
          await requestReset(db, user.correo, send);
          await requestReset(db, user.correo, send);
          assert.equal(emails.length, 1);
          const token = emails[0][2].match(/#token=([a-f0-9]{64})/)[1];
          const verification = await db.verification.findFirst({
            where: { usuarioId: user.id },
          });
          assert.notEqual(verification.codigoHash, token);
          await session();
          await assert.rejects(
            finishReset(db, "a".repeat(64), "New-password123!"),
            { status: 400 },
          );
          await finishReset(db, token, "New-password123!");
          assert.equal(
            await db.session.count({ where: { usuarioId: user.id } }),
            0,
          );
          assert.equal(
            await verifyPassword(
              "New-password123!",
              (await db.user.findUnique({ where: { id: user.id } })).password,
            ),
            true,
          );
          await assert.rejects(finishReset(db, token, "Other-password123!"), {
            status: 400,
          });
        },
      );
      await t.test(
        "Change requires current password and does not auto-verify Gmail",
        async () => {
          await session();
          await assert.rejects(
            changePassword(db, user.id, "wrong", "Changed-password123!"),
            { status: 400 },
          );
          assert.equal(
            await db.session.count({ where: { usuarioId: user.id } }),
            1,
          );
          await changePassword(
            db,
            user.id,
            "New-password123!",
            "Changed-password123!",
          );
          assert.equal(
            await db.session.count({ where: { usuarioId: user.id } }),
            0,
          );
          assert.equal(
            (await db.user.findUnique({ where: { id: user.id } }))
              .correoVerificado,
            false,
          );
        },
      );
      await t.test(
        "Expired links and links for a previous email cannot change the password",
        async () => {
          for (const expired of [true, false]) {
            const token = crypto.randomBytes(32).toString("hex");
            await db.verification.create({
              data: {
                usuarioId: user.id,
                tipo: "PASSWORD_RESET",
                destino: expired ? user.correo : "old-" + user.correo,
                codigoHash: crypto
                  .createHash("sha256")
                  .update(token)
                  .digest("hex"),
                expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)),
              },
            });
            await assert.rejects(finishReset(db, token, "Invalid-change123!"), {
              status: 400,
            });
            assert.equal(
              await verifyPassword(
                "Changed-password123!",
                (await db.user.findUnique({ where: { id: user.id } })).password,
              ),
              true,
            );
          }
        },
      );
      await t.test(
        "Parallel reservations respect account bytes and draft limit",
        async () => {
          const attempts = await Promise.allSettled(
            Array.from({ length: 4 }, () =>
              reserveUpload(db, row(), new Date(), {
                bytes: 20,
                daily: 10,
                pending: 2,
                identity: 2,
              }),
            ),
          );
          assert.equal(
            attempts.filter((x) => x.status === "fulfilled").length,
            2,
          );
          assert.equal(
            await db.attachment.count({ where: { usuarioId: user.id } }),
            2,
          );
          await db.attachment.deleteMany({ where: { usuarioId: user.id } });
          await assert.rejects(
            reserveUpload(db, row(), new Date(), {
              bytes: 100,
              daily: 2,
              pending: 9,
              identity: 2,
            }),
            { code: "UPLOAD_QUOTA" },
          );
        },
      );
      await t.test(
        "Cleanup retains associated identity documents and retries a failed deletion",
        async () => {
          const old = new Date(Date.now() - 2 * 86400000);
          const orphan = await db.attachment.create({
            data: row({
              estado: "LISTO",
              creadoEn: old,
              path: "test-orphan-" + run,
            }),
          });
          const identity = await db.attachment.create({
            data: row({
              tipo: "IDENTIDAD",
              privado: true,
              estado: "LISTO",
              creadoEn: old,
            }),
          });
          await db.recovery.create({
            data: {
              usuarioId: user.id,
              telefonoNuevo: "+51912345678",
              motivo: "Fixture document recovery",
              adjuntoId: identity.id,
            },
          });
          assert.equal(await claimOrphan(db, identity.id, null, user.id), null);
          assert.equal(
            await claimOrphan(db, orphan.id, null, user.id + 1),
            null,
          );
          const claimed = await claimOrphan(db, orphan.id, old);
          assert.equal(
            claimed,
            null,
            "strict age boundary retains a just-created draft",
          );
          const claimedOld = await claimOrphan(db, orphan.id, new Date());
          await assert.rejects(
            removeClaimed(
              db,
              {
                remove: async () => {
                  throw Error("storage unavailable");
                },
              },
              claimedOld,
            ),
          );
          assert.equal(
            (await db.attachment.findUnique({ where: { id: orphan.id } }))
              .estado,
            "BORRANDO",
          );
          await cleanupUploads(db, { remove: async (path) => files.add(path) });
          assert.equal(files.has(orphan.path), true);
          assert.equal(
            await db.attachment.findUnique({ where: { id: orphan.id } }),
            null,
          );
          assert.notEqual(
            await db.attachment.findUnique({ where: { id: identity.id } }),
            null,
          );
        },
      );
      await t.test(
        "Retained documents do not starve cleanup batches or consume unattached identity slots",
        async () => {
          const rows = Array.from({ length: 101 }, () =>
            row({
              tipo: "IDENTIDAD",
              privado: true,
              creadoEn: new Date(Date.now() - 3 * 86400000),
            }),
          );
          await db.attachment.createMany({ data: rows });
          await db.recovery.createMany({
            data: rows.map((file) => ({
              usuarioId: user.id,
              telefonoNuevo: "+51912345678",
              motivo: "Retained test identity",
              adjuntoId: file.id,
            })),
          });
          const orphan = await db.attachment.create({
            data: row({
              creadoEn: new Date(Date.now() - 2 * 86400000),
              path: "orphan-behind-documents-" + run,
            }),
          });
          await cleanupUploads(db, { remove: async (path) => files.add(path) });
          assert.equal(
            await db.attachment.findUnique({ where: { id: orphan.id } }),
            null,
          );
          assert.equal(
            await db.attachment.count({
              where: { id: { in: rows.map((row) => row.id) } },
            }),
            101,
          );
          await reserveUpload(db, row({ tipo: "IDENTIDAD" }), new Date(), {
            bytes: 10000,
            daily: 100,
            pending: 9,
            identity: 2,
          });
          await reserveUpload(db, row({ tipo: "IDENTIDAD" }), new Date(), {
            bytes: 10000,
            daily: 100,
            pending: 9,
            identity: 2,
          });
          await assert.rejects(
            reserveUpload(db, row({ tipo: "IDENTIDAD" }), new Date(), {
              bytes: 10000,
              daily: 100,
              pending: 9,
              identity: 2,
            }),
            { code: "UPLOAD_QUOTA" },
          );
        },
      );
    } finally {
      await db.recovery.deleteMany({ where: { usuarioId: user.id } });
      await db.attachment.deleteMany({ where: { usuarioId: user.id } });
      await db.usageCounter.deleteMany({
        where: { clave: { startsWith: `uploads:${user.id}:` } },
      });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  },
);
