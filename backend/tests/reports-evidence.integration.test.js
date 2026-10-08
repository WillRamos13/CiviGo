"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const connection = process.env.TEST_DATABASE_URL;

if (connection) {
  const url = new URL(connection);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  )
    throw new Error(
      "La revisión de evidencias requiere una base local aislada.",
    );
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
  delete process.env.TRUST_PROXY;
}

const photo = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTFcAAAAASUVORK5CYII=",
  "base64",
);

function shortVideo() {
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16);
  ftyp.write("ftyp", 4);
  ftyp.write("mp42", 8);
  const mvhd = Buffer.alloc(28);
  mvhd.writeUInt32BE(28);
  mvhd.write("mvhd", 4);
  mvhd.writeUInt32BE(1000, 20);
  mvhd.writeUInt32BE(12000, 24);
  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(36);
  moov.write("moov", 4);
  return Buffer.concat([ftyp, moov, mvhd]);
}

test(
  "Reportes HTTP: evidencias visuales autorizadas y revisión humana sin publicación, votos ni premios indebidos",
  { skip: !connection, timeout: 90000 },
  async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "civigo-evidence-"),
    );
    process.env.UPLOAD_DIR = directory;
    process.env.OPENAI_API_KEY = "fixture-openai-key-no-real-provider";
    process.env.AI_REPORT_MODEL = "gpt-4.1-mini";
    const requests = [];
    let evaluation;
    const originalFetch = global.fetch;
    t.mock.method(global, "fetch", async (target, options) => {
      const url = new URL(typeof target === "string" ? target : target.url);
      if (url.origin === "https://api.openai.com") {
        assert.equal(url.href, "https://api.openai.com/v1/responses");
        assert.equal(options.method, "POST");
        assert.equal(options.redirect, "error");
        assert.ok(
          evaluation,
          "Toda respuesta de IA debe estar simulada explícitamente.",
        );
        const payload = JSON.parse(options.body);
        requests.push(payload);
        return Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                { type: "output_text", text: JSON.stringify(evaluation) },
              ],
            },
          ],
        });
      }
      if (url.hostname !== "127.0.0.1")
        throw new Error(
          "No se permite ninguna solicitud externa en esta prueba.",
        );
      return originalFetch(target, options);
    });
    const prisma = require("../src/lib/db");
    const { hashToken } = require("../src/lib/auth");
    const { seedCatalog } = require("../src/lib/catalog");
    const app = require("../src/server");
    const run = crypto.randomBytes(6).toString("hex");
    const users = [],
      incidents = [],
      types = [];
    let sequence = 0;
    const point = { latitud: -14.06777, longitud: -75.7286 };
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(route, actor, body) {
      const response = await fetch(base + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(actor ? { Cookie: actor.cookie } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = { status: response.status, json: await response.json() };
      if (
        result.json.incidente?.id &&
        !incidents.includes(result.json.incidente.id)
      )
        incidents.push(result.json.incidente.id);
      return result;
    }
    async function actor(label, verified = true, role = "USUARIO") {
      const user = await prisma.user.create({
        data: {
          nombreUsuario: run + "_" + label,
          nombres: "Prueba",
          apellidos: "Evidencias",
          correo: run + "_" + label + "@gmail.com",
          telefono: "+999" + crypto.randomInt(10000000000, 100000000000),
          password: "scrypt$fixture_sin_login",
          correoVerificado: verified,
          rol: role,
        },
      });
      users.push(user.id);
      const token = crypto.randomBytes(32).toString("hex");
      await prisma.session.create({
        data: {
          id: hashToken(token),
          usuarioId: user.id,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return { ...user, cookie: "civigo_session=" + token };
    }
    async function type(label, options = {}) {
      const category = await prisma.category.findUnique({
        where: { slug: "seguridad" },
      });
      const row = await prisma.incidentType.create({
        data: {
          nombre: "Prueba de evidencia " + label,
          slug: "evidence-" + run + "-" + ++sequence,
          categoriaId: category.id,
          fotoObligatoria: true,
          ...options,
        },
      });
      types.push(row.id);
      return row;
    }
    async function upload(
      actor,
      bytes = photo,
      mime = "image/png",
      kind = "PUBLICO",
    ) {
      const form = new FormData();
      form.append(
        "archivo",
        new Blob([bytes], { type: mime }),
        mime === "video/mp4" ? "corto.mp4" : "foto.png",
      );
      form.append("tipo", kind);
      const response = await fetch(base + "/uploads", {
        method: "POST",
        headers: { Cookie: actor.cookie },
        body: form,
      });
      const json = await response.json();
      assert.equal(response.status, 201, JSON.stringify(json));
      return json;
    }
    function simulated(files, extra = {}, result = "COMPATIBLE") {
      evaluation = {
        gravedad: 4,
        posibleFalso: false,
        requiereRevision: false,
        motivo: "Evaluación simulada, sin proveedor externo.",
        emergenciaActiva: false,
        tipoPropuesto: null,
        // The provider sees readable images only; the real adapter must add
        // inconclusive results for videos and other unsupported attachments.
        evidencias: files
          .filter((file) => file.mimeType.startsWith("image/"))
          .map((file) => ({
            id: file.id,
            resultado: result,
            motivo: "Resultado visual simulado.",
          })),
        ...extra,
      };
    }
    async function submit(
      actor,
      selectedType,
      files,
      description = "Incidente de prueba con evidencia; no representa un hecho real.",
    ) {
      const result = await request("/reports", actor, {
        tipo: selectedType.slug,
        descripcion: description,
        ...point,
        gpsLatitud: point.latitud,
        gpsLongitud: point.longitud,
        adjuntosIds: files.map((file) => file.id),
      });
      assert.equal(result.status, 201, JSON.stringify(result.json));
      return result.json;
    }
    async function assertNoSanction(actor) {
      const user = await prisma.user.findUnique({ where: { id: actor.id } });
      assert.equal(user.faltas, 0);
      assert.equal(user.bloqueado, false);
      assert.equal(user.reputacion, null);
    }
    async function assertNoRewards(actor) {
      assert.equal(
        await prisma.pointEvent.count({ where: { usuarioId: actor.id } }),
        0,
      );
    }
    async function assertReviewAlert(incidentId, admin) {
      assert.ok(
        await prisma.notification.count({
          where: {
            incidenteId: incidentId,
            usuarioId: admin.id,
            tipo: "REVISION",
          },
        }),
        "El administrador debe recibir una alerta de revisión.",
      );
    }
    async function review(admin, row) {
      return request(`/admin/incidents/${row.id}/review`, admin, {
        accion: "VALIDAR",
        nivelRiesgo: 2,
        motivo:
          "Evaluación humana explícita de las pruebas de este incidente de ensayo.",
      });
    }
    try {
      await seedCatalog();
      const admin = await actor("admin", true, "ADMIN");
      await t.test(
        "La imagen subida viaja como bytes y sólo el adjunto propio autorizado llega a IA",
        async () => {
          const author = await actor("compatible");
          const selected = await type("compatible");
          const file = await upload(author);
          simulated([file]);
          const before = requests.length;
          const result = await submit(author, selected, [file]);
          assert.equal(requests.length, before + 1);
          const payload = requests.at(-1);
          const parts = payload.input.flatMap((item) =>
            Array.isArray(item.content) ? item.content : [],
          );
          const images = parts.filter((item) => item.type === "input_image");
          assert.equal(images.length, 1);
          assert.equal(
            images[0].image_url,
            "data:image/png;base64," + photo.toString("base64"),
          );
          assert.equal(payload.store, false);
          assert.ok(JSON.stringify(payload.input).includes(file.id));
          assert.ok(!JSON.stringify(payload).includes(author.correo));
          assert.ok(!JSON.stringify(payload).includes(directory));
          assert.equal(result.incidente.publicado, true);
          assert.equal(result.incidente.evaluacion, "IA");
          assert.equal(result.incidente.nivelRiesgo, 4);
          const foreign = await actor("foreign");
          const attempts = requests.length;
          const rejected = await request("/reports", foreign, {
            tipo: selected.slug,
            ...point,
            gpsLatitud: point.latitud,
            gpsLongitud: point.longitud,
            adjuntosIds: [file.id],
          });
          assert.equal(rejected.status, 400);
          assert.equal(requests.length, attempts);
          const unverified = await actor("unverified", false);
          assert.equal(
            (
              await request("/reports", unverified, {
                tipo: selected.slug,
                ...point,
              })
            ).status,
            403,
          );
          assert.equal(requests.length, attempts);
        },
      );
      await t.test(
        "Una foto no relacionada no publica un incidente ordinario ni castiga al autor",
        async () => {
          const author = await actor("irrelevant");
          const selected = await type("irrelevante");
          const file = await upload(author);
          simulated([file], { requiereRevision: true }, "NO_RELACIONADA");
          const result = await submit(author, selected, [file]);
          assert.equal(result.incidente.publicado, false);
          assert.equal(result.incidente.estado, "PENDIENTE");
          assert.equal(result.incidente.evaluacion, "PENDIENTE");
          assert.equal(result.reporte.estado, "EN_REVISION");
          const visible = await request("/incidents");
          assert.equal(
            visible.json.some((row) => row.id === result.incidente.id),
            false,
          );
          await assertNoSanction(author);
          await assertNoRewards(author);
          await assertReviewAlert(result.incidente.id, admin);
        },
      );
      await t.test(
        "Una foto inconcluyente fuerza revisión aunque el proveedor no marque la bandera",
        async () => {
          const author = await actor("inconclusive");
          const selected = await type("inconcluyente");
          const file = await upload(author);
          simulated([file], {}, "NO_CONCLUYENTE");
          const result = await submit(author, selected, [file]);
          assert.equal(result.incidente.publicado, false);
          assert.equal(result.reporte.estado, "EN_REVISION");
          await assertNoSanction(author);
          await assertReviewAlert(result.incidente.id, admin);
        },
      );
      await t.test(
        "Posible falsedad requiere revisión sin publicar ni sancionar automáticamente",
        async () => {
          const author = await actor("possible_false");
          const selected = await type("posible falsedad");
          const file = await upload(author);
          simulated([file], { posibleFalso: true, requiereRevision: false });
          const result = await submit(author, selected, [file]);
          assert.equal(result.incidente.publicado, false);
          assert.equal(result.reporte.estado, "EN_REVISION");
          await assertNoSanction(author);
          await assertNoRewards(author);
          await assertReviewAlert(result.incidente.id, admin);
        },
      );
      await t.test(
        "Una emergencia dudosa permanece visible por evaluar y sin sanción automática",
        async () => {
          const author = await actor("emergency");
          const selected = await type("emergencia", { emergencia: true });
          const file = await upload(author);
          simulated(
            [file],
            { posibleFalso: true, requiereRevision: true },
            "NO_RELACIONADA",
          );
          const result = await submit(author, selected, [file]);
          assert.equal(result.incidente.publicado, true);
          assert.equal(result.incidente.estado, "ACTIVO");
          assert.equal(result.incidente.evaluacion, "PENDIENTE");
          assert.equal(result.reporte.estado, "EN_REVISION");
          const visible = await request("/incidents");
          assert.equal(
            visible.json.some((row) => row.id === result.incidente.id),
            true,
          );
          await assertNoSanction(author);
          await assertNoRewards(author);
          await assertReviewAlert(result.incidente.id, admin);
        },
      );
      await t.test(
        "Un vídeo adjunto no recibe aprobación automática por una foto compatible",
        async () => {
          const author = await actor("video");
          const selected = await type("video");
          const image = await upload(author);
          const video = await upload(author, shortVideo(), "video/mp4");
          simulated([image, video]);
          const result = await submit(author, selected, [image, video]);
          assert.equal(result.incidente.publicado, false);
          assert.equal(result.reporte.estado, "EN_REVISION");
          await assertNoRewards(author);
          await assertReviewAlert(result.incidente.id, admin);
        },
      );
      await t.test(
        "Una imagen que desapareció del almacenamiento no permite aprobar por descripción",
        async () => {
          const author = await actor("missing");
          const selected = await type("archivo ausente");
          const file = await upload(author);
          const stored = await prisma.attachment.findUnique({
            where: { id: file.id },
          });
          assert.equal(path.dirname(stored.path), directory);
          await fs.unlink(stored.path);
          simulated([file]);
          const result = await submit(author, selected, [file]);
          assert.equal(result.incidente.publicado, false);
          assert.ok(
            ["PENDIENTE", "EN_REVISION"].includes(result.reporte.estado),
          );
          await assertNoRewards(author);
          await assertReviewAlert(result.incidente.id, admin);
        },
      );
      await t.test(
        "Aporte dudoso agrupado no hereda validación, voto o premios; sólo revisión humana lo libera",
        async () => {
          const original = await actor("group_original");
          const doubtful = await actor("group_doubtful");
          const selected = await type("agrupado");
          const originalFile = await upload(original);
          simulated([originalFile]);
          const first = await submit(original, selected, [originalFile]);
          assert.equal((await review(admin, first.incidente)).status, 200);
          const badFile = await upload(doubtful);
          simulated([badFile], { requiereRevision: true }, "NO_RELACIONADA");
          const bad = await submit(doubtful, selected, [badFile]);
          assert.equal(bad.incidente.id, first.incidente.id);
          assert.equal(bad.incidente.estado, "VALIDADO");
          assert.equal(bad.incidente.evaluacion, "AGENTE");
          assert.equal(bad.incidente.nivelRiesgo, 2);
          assert.equal(bad.incidente.validacion, 1);
          assert.equal(bad.reporte.estado, "EN_REVISION");
          assert.equal(bad.reporte.adjuntos[0].privado, true);
          const publicDetail = await request(
            `/incidents/${first.incidente.id}`,
          );
          assert.equal(
            publicDetail.json.reportes.some((row) => row.id === bad.reporte.id),
            false,
          );
          assert.equal(
            publicDetail.json.adjuntos.some((file) => file.id === badFile.id),
            false,
          );
          assert.equal((await request(`/uploads/${badFile.id}`)).status, 403);
          assert.equal(
            await prisma.vote.count({
              where: {
                incidenteId: first.incidente.id,
                usuarioId: doubtful.id,
              },
            }),
            0,
          );
          await assertNoRewards(doubtful);
          for (let n = 0; n < 3; n++) {
            const voter = await actor("group_voter" + n);
            const confirmed = await request(
              `/incidents/${first.incidente.id}/confirmar`,
              voter,
              point,
            );
            assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
          }
          const compatible = await actor("group_compatible");
          const compatibleFile = await upload(compatible);
          simulated([compatibleFile]);
          const next = await submit(compatible, selected, [compatibleFile]);
          assert.equal(next.incidente.evaluacion, "AGENTE");
          assert.equal(next.incidente.nivelRiesgo, 2);
          assert.equal(next.reporte.estado, "VALIDADO");
          assert.equal(
            (await prisma.report.findUnique({ where: { id: bad.reporte.id } }))
              .estado,
            "EN_REVISION",
          );
          await assertNoSanction(doubtful);
          await assertNoRewards(doubtful);
          await assertReviewAlert(first.incidente.id, admin);
          const accepted = await review(admin, first.incidente);
          assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
          assert.equal(
            (await prisma.report.findUnique({ where: { id: bad.reporte.id } }))
              .estado,
            "VALIDADO",
          );
          assert.ok(
            await prisma.pointEvent.count({
              where: {
                usuarioId: doubtful.id,
                clave: "reporte:" + bad.reporte.id,
              },
            }),
          );
        },
      );
      await t.test(
        "Publicar un grupo por otro aporte no expone la descripción del reporte retenido",
        async () => {
          const firstAuthor = await actor("held_first");
          const nextAuthor = await actor("accepted_second");
          const selected = await type("descripcion");
          const badImage = await upload(firstAuthor);
          simulated([badImage], { requiereRevision: true }, "NO_RELACIONADA");
          const held = await submit(
            firstAuthor,
            selected,
            [badImage],
            "Descripción retenida pendiente de revisión.",
          );
          const goodImage = await upload(nextAuthor);
          simulated([goodImage]);
          const accepted = await submit(
            nextAuthor,
            selected,
            [goodImage],
            "Descripción del aporte compatible.",
          );
          assert.equal(held.incidente.id, accepted.incidente.id);
          const detail = await request(`/incidents/${held.incidente.id}`);
          assert.equal(detail.status, 200);
          assert.equal(
            detail.json.descripcion,
            "Descripción del aporte compatible.",
          );
          assert.equal(
            JSON.stringify(detail.json).includes("Descripción retenida"),
            false,
          );
          assert.equal(detail.json.reportes.length, 1);
          const staff = await request("/admin/incidents", admin);
          const privateDetail = staff.json.find(
            (row) => row.id === held.incidente.id,
          );
          assert.equal(privateDetail.reportes.length, 2);
        },
      );
      await t.test(
        "Una prueba privada añadida después de validar necesita nueva revisión antes de premiarse",
        async () => {
          const author = await actor("late_proof");
          const selected = await type("prueba posterior", {
            fotoObligatoria: false,
          });
          simulated([]);
          const original = await submit(author, selected, []);
          assert.equal((await review(admin, original.incidente)).status, 200);
          const countProof = () =>
            prisma.pointEvent.count({
              where: { clave: "prueba:" + original.reporte.id },
            });
          assert.equal(await countProof(), 0);
          const file = await upload(author, photo, "image/png", "EVIDENCIA");
          const updated = await request(
            `/reports/${original.reporte.id}/evidence`,
            author,
            { adjuntosIds: [file.id] },
          );
          assert.equal(updated.status, 200, JSON.stringify(updated.json));
          assert.equal(updated.json.estado, "EN_REVISION");
          assert.equal(await countProof(), 0);
          await assertReviewAlert(original.incidente.id, admin);
          assert.equal((await request(`/uploads/${file.id}`)).status, 403);
          assert.equal((await review(admin, original.incidente)).status, 200);
          assert.equal(await countProof(), 1);
          assert.equal(
            (
              await prisma.report.findUnique({
                where: { id: original.reporte.id },
              })
            ).estado,
            "VALIDADO",
          );
        },
      );
    } finally {
      try {
        // A response serialization failure can happen after committing a
        // report. Collect only this fixture's unique types before cleaning up.
        const owned = await prisma.incident.findMany({
          where: { tipoId: { in: types } },
          select: { id: true },
        });
        for (const row of owned)
          if (!incidents.includes(row.id)) incidents.push(row.id);
        const userWhere = { usuarioId: { in: users } };
        const incidentWhere = { incidenteId: { in: incidents } };
        await prisma.attachment.deleteMany({ where: userWhere });
        await prisma.appeal.deleteMany({ where: userWhere });
        await prisma.vote.deleteMany({ where: incidentWhere });
        await prisma.chatMessage.deleteMany({ where: incidentWhere });
        await prisma.review.deleteMany({ where: incidentWhere });
        await prisma.flag.deleteMany({ where: incidentWhere });
        await prisma.notification.deleteMany({
          where: { OR: [userWhere, incidentWhere] },
        });
        await prisma.pointEvent.deleteMany({ where: userWhere });
        await prisma.auditLog.deleteMany({ where: userWhere });
        await prisma.report.deleteMany({ where: userWhere });
        await prisma.incident.deleteMany({ where: { id: { in: incidents } } });
        await prisma.incidentType.deleteMany({ where: { id: { in: types } } });
        await prisma.user.deleteMany({ where: { id: { in: users } } });
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await prisma.$disconnect();
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  },
);
