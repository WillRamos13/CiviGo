"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const photos = require("../src/lib/initial-report-photos");

function fixture() {
  const userIds = [11, 12, 13, 14, 15];
  const manifest = Object.fromEntries(
    ["bache", "robo"].map((slug) => [
      slug,
      {
        file: path.resolve(__dirname, "../.local/photos/" + slug + ".jpg"),
        sourceUrl: `https://commons.wikimedia.org/wiki/File:Reference_${slug}.jpg`,
        author: "Autor de la referencia",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        caption: "Imagen de referencia de " + slug,
        mimeType: "image/jpeg",
        size: 501,
        sha256: "f".repeat(64),
      },
    ]),
  );
  const reports = Array.from({ length: 500 }, (_, index) => ({
    id: 1000 + index,
    usuarioId: userIds[index % 5],
    incidenteId: 2000 + index,
    tipoId: (index % 2) + 1,
    tipo: index % 2 ? "Robo" : "Bache",
    estado: "VALIDADO",
    tipoCatalogo: {
      id: (index % 2) + 1,
      slug: index % 2 ? "robo" : "bache",
      nombre: index % 2 ? "Robo" : "Bache",
      individual: !!(index % 2),
    },
    incidente: {
      id: 2000 + index,
      tipoId: (index % 2) + 1,
      fuente: "CARGA_INICIAL",
      estado: "VALIDADO",
      publicado: true,
    },
    adjuntos: [],
  }));
  return {
    reports,
    manifest,
    userIds,
    reviewerId: 11,
    targetPath: ({ id, userId }) =>
      `supabase://civigo-attachments/uploads/${userId}/${id}`,
    now: new Date("2026-10-13T18:00:00Z"),
  };
}
function assertInvalid(fn) {
  assert.throws(fn, (error) => error.code === "INITIAL_PHOTO_PLAN");
}

test("500 initial reports receive distinct objects, correct authors and visible free-image attribution", () => {
  const plan = photos.planInitialPhotos(fixture());
  assert.equal(plan.uploads.length, 500);
  assert.equal(
    new Set(plan.uploads.map(({ attachment }) => attachment.id)).size,
    500,
  );
  assert.equal(
    new Set(plan.uploads.map(({ attachment }) => attachment.path)).size,
    500,
  );
  assert.equal(plan.reviews.length, 500);
  assert.deepEqual(plan.summary.countsByType, { bache: 250, robo: 250 });
  assert.equal(plan.summary.actualIncidentEvidence, 0);
  for (const [index, { attachment, reference }] of plan.uploads.entries()) {
    assert.equal(attachment.reporteId, 1000 + index);
    assert.equal(attachment.usuarioId, 11 + (index % 5));
    assert.equal(attachment.privado, false);
    assert.equal(attachment.tipo, "PUBLICO");
    assert.match(
      attachment.nombre,
      /^Foto de referencia · Imagen de referencia/,
    );
    assert.match(
      attachment.nombre,
      / · CC BY-SA 4\.0 · https:\/\/commons\.wikimedia\.org\/wiki\/File:/,
    );
    assert.equal(reference.notIncidentEvidence, true);
    assert.equal(plan.reviews[index].datos.attachmentId, attachment.id);
    assert.equal(plan.reviews[index].accion, "FOTOGRAFIA_REFERENCIA");
  }
});

test("manifest admits object and array formats, sanitizes delimiters/newlines and limits public text", () => {
  const args = fixture();
  args.manifest.bache.caption = "Tema ·\n" + "x".repeat(200);
  args.manifest.bache.author = "Autor\r\n·" + "y".repeat(200);
  const normalized = photos.normalizePhotoManifest(args.manifest);
  assert.equal(normalized.get("bache").caption.length, 100);
  assert.equal(normalized.get("bache").author.length, 150);
  assert.ok(!/[·\r\n]/.test(normalized.get("bache").caption));
  assert.deepEqual(
    photos.normalizePhotoManifest(
      Object.entries(args.manifest).map(([slug, value]) => ({
        ...value,
        slug,
      })),
    ),
    normalized,
  );
  args.manifest.robo.license = "Public domain";
  photos.planInitialPhotos(args);
});

test("unsafe source URLs, non-free licensing, MIME, sizes, hashes and local file paths fail before any persistence", () => {
  for (const changes of [
    { sourceUrl: "http://commons.wikimedia.org/wiki/File:Example.jpg" },
    {
      sourceUrl:
        "https://commons.wikimedia.org.evil.test/wiki/File:Example.jpg",
    },
    {
      sourceUrl:
        "https://name:secret@commons.wikimedia.org/wiki/File:Example.jpg",
    },
    { sourceUrl: "https://commons.wikimedia.org/wiki/Main_Page" },
    { sourceUrl: "javascript:alert(1)" },
    { licenseUrl: "https://untrusted.test/license" },
    { license: "All rights reserved" },
    { mimeType: "image/svg+xml" },
    { mimeType: "video/mp4" },
    { size: 0 },
    { size: photos.MAX_REFERENCE_BYTES + 1 },
    { size: 2.5 },
    { sha256: "unknown" },
    { file: "relative.jpg" },
    { author: "" },
  ]) {
    const args = fixture();
    Object.assign(args.manifest.bache, changes);
    assertInvalid(() => photos.planInitialPhotos(args));
  }
});

test("only matching initial verified pairs can receive the references, including individual crimes without fake private evidence", () => {
  for (const modify of [
    (args) => {
      args.reports.pop();
    },
    (args) => {
      args.reports[0].usuarioId = 55;
    },
    (args) => {
      args.reports[0].tipoCatalogo.id = 77;
    },
    (args) => {
      args.reports[0].incidente.tipoId = 77;
    },
    (args) => {
      args.reports[0].incidente.fuente = "CIUDADANO";
    },
    (args) => {
      args.reports[0].estado = "EN_REVISION";
    },
    (args) => {
      args.reports[0].incidente.publicado = false;
    },
    (args) => {
      args.reports[0].adjuntos = [{ id: randomUUID() }];
    },
    (args) => {
      args.reports[0].id = args.reports[1].id;
    },
    (args) => {
      args.reports[0].incidenteId = args.reports[1].incidenteId;
    },
    (args) => {
      delete args.manifest.robo;
    },
  ]) {
    const args = fixture();
    modify(args);
    assertInvalid(() => photos.planInitialPhotos(args));
  }
  const plan = photos.planInitialPhotos(fixture());
  assert.ok(
    plan.uploads.every(({ attachment }) => attachment.tipo !== "EVIDENCIA"),
  );
});

test("duplicate storage objects, duplicate IDs and mismatched remote owners fail rather than sharing a deletable file", () => {
  const args = fixture(),
    id = randomUUID();
  assertInvalid(() =>
    photos.planInitialPhotos({ ...args, assignId: () => id }),
  );
  assertInvalid(() =>
    photos.planInitialPhotos({
      ...args,
      targetPath: () => "supabase://bucket/uploads/11/" + id,
    }),
  );
  assertInvalid(() =>
    photos.planInitialPhotos({
      ...args,
      targetPath: ({ id }) => "supabase://bucket/uploads/999/" + id,
    }),
  );
  assertInvalid(() =>
    photos.planInitialPhotos({ ...args, assignId: () => "invalid-id" }),
  );
  const local = photos.planInitialPhotos({
    ...args,
    targetPath: ({ id }) => path.resolve(__dirname, "../.local/storage/" + id),
  });
  assert.equal(local.uploads.length, 500);
  assert.equal(
    new Set(local.uploads.map(({ attachment }) => attachment.path)).size,
    500,
  );
});

test("a separate 50-report append requires an explicit count and retains all original pairing and media checks", () => {
  const args = fixture();
  args.reports = args.reports.slice(0, 50);
  assertInvalid(() => photos.planInitialPhotos(args));
  const plan = photos.planInitialPhotos({ ...args, expectedCount: 50 });
  assert.equal(plan.uploads.length, 50);
  assert.equal(plan.reviews.length, 50);
  assert.equal(plan.summary.illustrativePhotos, 50);
  assert.equal(plan.summary.distinctStorageObjects, 50);
  assert.equal(
    new Set(plan.uploads.map(({ attachment }) => attachment.path)).size,
    50,
  );
  for (const expectedCount of [0, -1, 50.5, 2001, "50", 49, 51])
    assertInvalid(() => photos.planInitialPhotos({ ...args, expectedCount }));
  args.reports[0].incidente.fuente = "CIUDADANO";
  assertInvalid(() => photos.planInitialPhotos({ ...args, expectedCount: 50 }));
});
