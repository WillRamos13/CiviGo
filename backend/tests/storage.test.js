const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const express = require("express");
const { createStorage, storageStatus } = require("../src/lib/storage");
const { createUploadRouter } = require("../src/routes/uploads");

const env = {
  STORAGE_PROVIDER: "supabase",
  SUPABASE_URL: "https://storage-contract.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_contract_test_only",
  SUPABASE_STORAGE_BUCKET: "civigo-attachments",
};
const photo = Buffer.from([255, 216, 255, 224, 0, 0, 0, 0]);

function provider({ publicBucket = false, failure = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/bucket/"))
      return Response.json({
        id: env.SUPABASE_STORAGE_BUCKET,
        public: publicBucket,
      });
    if (options.method === "POST")
      return failure
        ? new Response("sensitive provider message", { status: 500 })
        : Response.json({ Key: "stored" });
    if (options.method === "DELETE") return Response.json([]);
    const range = options.headers.Range;
    return new Response(range ? photo.subarray(0, 3) : photo, {
      status: range ? 206 : 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Accept-Ranges": "bytes",
        ...(range
          ? { "Content-Range": "bytes 0-2/8", "Content-Length": "3" }
          : {}),
      },
    });
  };
  return { calls, fetchImpl };
}

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "civigo-storage-"));
  const remote = provider(options);
  const records = new Map();
  const db = {
    attachment: {
      create: async ({ data }) => {
        if (options.failDatabase) throw new Error("database unavailable");
        records.set(data.id, data);
        return data;
      },
      findUnique: async ({ where }) => records.get(where.id) || null,
    },
  };
  const app = express();
  const authenticate = (req, res, next) => {
    req.user = req.headers["x-test-user"]
      ? JSON.parse(req.headers["x-test-user"])
      : null;
    next();
  };
  app.use(
    "/uploads",
    createUploadRouter({
      directory,
      db,
      storage: createStorage({
        env: options.storageEnv || env,
        directory,
        fetchImpl: remote.fetchImpl,
      }),
      authenticate: (req, res, next) =>
        authenticate(req, res, () => (req.user ? next() : res.sendStatus(401))),
      authenticateOptional: authenticate,
    }),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({
      error: error.status ? error.message : "Error interno.",
      code: error.code,
    });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port + "/uploads";
  const owner = {
    id: 7,
    rol: "USUARIO",
    telefonoVerificado: false,
    correoVerificado: true,
    bloqueado: false,
    permisos: [],
  };
  async function upload({
    mime = "image/jpeg",
    data = photo,
    type = "PUBLICO",
    privateFile = false,
    user = owner,
  } = {}) {
    const form = new FormData();
    form.append("archivo", new Blob([data], { type: mime }), "camera-file.jpg");
    form.append("tipo", type);
    if (privateFile) form.append("privado", "true");
    const response = await fetch(base, {
      method: "POST",
      headers: user ? { "x-test-user": JSON.stringify(user) } : {},
      body: form,
    });
    return { response, json: await response.json() };
  }
  async function download(id, user, range) {
    return fetch(base + "/" + id, {
      headers: {
        ...(user ? { "x-test-user": JSON.stringify(user) } : {}),
        ...(range ? { Range: range } : {}),
      },
    });
  }
  return { directory, remote, records, owner, upload, download };
}

test("Storage status exposes requirements, never backend keys", () => {
  assert.deepEqual(storageStatus({}), {
    tipo: "local",
    configurado: true,
    requiereVolumenPersistente: true,
  });
  const incomplete = storageStatus({ STORAGE_PROVIDER: "supabase" });
  assert.equal(incomplete.configurado, false);
  assert.deepEqual(incomplete.faltan, ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  assert.equal(
    storageStatus({ STORAGE_PROVIDER: "invalid" }).configurado,
    false,
  );
  assert.equal(
    storageStatus({ STORAGE_PROVIDER: "invalid" }).tipo,
    "desconocido",
  );
  assert.equal(
    storageStatus({ ...env, SUPABASE_URL: "http://example.test" }).configurado,
    false,
  );
  assert.equal(
    storageStatus({
      ...env,
      SUPABASE_URL: "https://user:password@example.test",
    }).configurado,
    false,
  );
  assert.equal(
    storageStatus({ ...env, SUPABASE_SECRET_KEY: "sb_publishable_fake" })
      .configurado,
    false,
  );
  assert.equal(
    storageStatus({ ...env, SUPABASE_STORAGE_BUCKET: "../other" }).configurado,
    false,
  );
  assert.equal(storageStatus(env).requiereVolumenPersistente, false);
  assert.equal(
    JSON.stringify(storageStatus(env)).includes(env.SUPABASE_SECRET_KEY),
    false,
  );
});

test("Supabase uploads persist opaque paths and public attachments retain backend publication control", async (t) => {
  const f = await fixture(t);
  const { response, json } = await f.upload();
  assert.equal(response.status, 201);
  assert.equal(json.url, "/api/uploads/" + json.id);
  assert.equal("path" in json, false);
  const record = f.records.get(json.id);
  assert.equal(
    record.path,
    "supabase://civigo-attachments/uploads/7/" + json.id,
  );
  assert.deepEqual(await fs.readdir(f.directory), []);
  assert.equal((await f.download(json.id)).status, 403);
  assert.equal(
    f.remote.calls.length,
    2,
    "unauthorized requests never reach provider",
  );
  const ownerFile = await f.download(json.id, f.owner);
  assert.equal(ownerFile.status, 200);
  assert.equal(
    ownerFile.headers.get("cache-control"),
    "private, no-store",
    "unpublished public media must not be cached as public",
  );
  assert.deepEqual(Buffer.from(await ownerFile.arrayBuffer()), photo);
  record.reporte = {
    incidente: { publicado: true, distrito: "Ica" },
    usuario: { correoVerificado: true },
  };
  const publicFile = await f.download(json.id);
  assert.equal(publicFile.status, 200);
  assert.equal(publicFile.headers.get("cache-control"), "public, max-age=300");
  assert.equal(publicFile.headers.get("apikey"), null);
  record.reporte.usuario.correoVerificado = false;
  assert.equal((await f.download(json.id)).status, 403);
  assert.equal((await f.download(json.id, f.owner)).status, 200);
  const posted = f.remote.calls.find((c) => c.options.method === "POST");
  assert.equal(posted.options.headers.apikey, env.SUPABASE_SECRET_KEY);
  assert.equal(
    posted.options.headers.Authorization,
    undefined,
    "new secret keys are not sent as JWTs",
  );
  assert.equal(posted.options.headers["x-upsert"], "false");
  assert.equal(posted.options.redirect, "error");
  assert.deepEqual(posted.options.body, photo);
});

test("Private evidence and identity preserve owner, district and administrator permissions", async (t) => {
  const f = await fixture(t);
  const evidence = await f.upload({ type: "EVIDENCIA" });
  const record = f.records.get(evidence.json.id);
  record.reporte = {
    incidente: { publicado: true, distrito: "Ica" },
    usuario: { correoVerificado: true },
  };
  assert.equal(record.privado, true);
  assert.equal((await f.download(record.id)).status, 403);
  assert.equal(
    (await f.download(record.id, { ...f.owner, id: 8 })).status,
    403,
  );
  const agent = {
    id: 9,
    rol: "AGENTE",
    permisos: ["evidencia"],
    distrito: "Ica",
    bloqueado: false,
  };
  assert.equal(
    (await f.download(record.id, { ...agent, distrito: "Parcona" })).status,
    403,
  );
  assert.equal(
    (await f.download(record.id, { ...agent, permisos: [] })).status,
    403,
  );
  const agentFile = await f.download(record.id, agent);
  assert.equal(agentFile.status, 200);
  assert.equal(agentFile.headers.get("cache-control"), "private, no-store");
  const identity = await f.upload({
    type: "IDENTIDAD",
    mime: "application/pdf",
    data: Buffer.from("%PDF-1.7 test"),
  });
  assert.equal(identity.response.status, 201);
  assert.equal((await f.download(identity.json.id, agent)).status, 403);
  const admin = { id: 10, rol: "ADMIN", bloqueado: false };
  assert.equal(
    (await f.download(identity.json.id, { ...admin, bloqueado: true })).status,
    403,
  );
  const document = await f.download(identity.json.id, admin);
  assert.equal(document.status, 200);
  assert.match(document.headers.get("content-disposition"), /^attachment/);
  assert.equal(document.headers.get("cache-control"), "private, no-store");
});

test("Signature, verified email and PDF privacy validation runs before any cloud upload", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.upload({ data: Buffer.from("HTML masquerading as a photo") }))
      .response.status,
    400,
  );
  assert.equal(
    (await f.upload({ user: { ...f.owner, correoVerificado: false } })).response
      .status,
    403,
  );
  assert.equal(
    (
      await f.upload({
        mime: "application/pdf",
        data: Buffer.from("%PDF-1.7 test"),
      })
    ).response.status,
    400,
  );
  assert.equal(f.remote.calls.length, 0);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test("Unverified users may upload only private identity for recovery; rejected participation files are cleaned", async (t) => {
  const f = await fixture(t);
  const unverified = { ...f.owner, correoVerificado: false };
  for (const type of ["PUBLICO", "EVIDENCIA"]) {
    assert.equal(
      (await f.upload({ type, user: unverified })).response.status,
      403,
    );
    assert.deepEqual(await fs.readdir(f.directory), []);
  }
  assert.equal(f.remote.calls.length, 0);
  const accepted = await f.upload({
    type: "IDENTIDAD",
    privateFile: false,
    user: unverified,
    mime: "application/pdf",
    data: Buffer.from("%PDF-1.7 identity fixture"),
  });
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.json.tipo, "IDENTIDAD");
  assert.equal(accepted.json.privado, true);
  assert.equal((await f.download(accepted.json.id)).status, 403);
  const owned = await f.download(accepted.json.id, unverified);
  assert.equal(owned.status, 200);
  assert.equal(owned.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (
      await f.download(accepted.json.id, {
        id: 9,
        rol: "AGENTE",
        permisos: ["evidencia"],
        bloqueado: false,
      })
    ).status,
    403,
  );
  const calls = f.remote.calls.length;
  assert.equal(
    (
      await f.upload({
        type: "IDENTIDAD",
        user: { ...unverified, bloqueado: true },
      })
    ).response.status,
    403,
  );
  assert.equal(f.remote.calls.length, calls);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test("A public cloud bucket is rejected before storing private data", async (t) => {
  const f = await fixture(t, { publicBucket: true });
  const { response, json } = await f.upload({ type: "IDENTIDAD" });
  assert.equal(response.status, 503);
  assert.equal(json.code, "STORAGE_PRIVATE_BUCKET_REQUIRED");
  assert.equal(f.records.size, 0);
  assert.equal(f.remote.calls.length, 1);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test("A failed attachment registration rolls back only its exact object and temporary file", async (t) => {
  const f = await fixture(t, { failDatabase: true });
  assert.equal((await f.upload()).response.status, 500);
  const removed = f.remote.calls.find((c) => c.options.method === "DELETE");
  assert.match(removed.url, /\/object\/civigo-attachments$/);
  const body = JSON.parse(removed.options.body);
  assert.equal(body.prefixes.length, 1);
  assert.match(body.prefixes[0], /^uploads\/7\/[a-f0-9-]{36}$/);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test("Provider failures do not expose errors or silently fall back to ephemeral local files", async (t) => {
  const f = await fixture(t, { failure: true });
  const { response, json } = await f.upload();
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(json).includes("sensitive provider"), false);
  assert.equal(f.records.size, 0);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test("Video byte range requests retain authorization and provider Content-Range", async (t) => {
  const f = await fixture(t);
  const { json } = await f.upload({ type: "EVIDENCIA" });
  assert.equal((await f.download(json.id, null, "bytes=0-2")).status, 403);
  const ranged = await f.download(json.id, f.owner, "bytes=0-2");
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 0-2/8");
  assert.equal(ranged.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(
    Buffer.from(await ranged.arrayBuffer()),
    photo.subarray(0, 3),
  );
  assert.equal(
    (await f.download(json.id, f.owner, "bytes=0-1,3-4")).status,
    416,
  );
});

test("Local attachments remain readable through the same protected endpoint", async (t) => {
  const f = await fixture(t, { storageEnv: {} });
  const { response, json } = await f.upload();
  assert.equal(response.status, 201);
  assert.equal(f.remote.calls.length, 0);
  assert.deepEqual(await fs.readdir(f.directory), [json.id]);
  assert.equal((await f.download(json.id)).status, 403);
  const ownFile = await f.download(json.id, f.owner);
  assert.equal(ownFile.status, 200);
  assert.equal(ownFile.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await ownFile.arrayBuffer()), photo);
  await fs.unlink(f.records.get(json.id).path);
  assert.equal((await f.download(json.id, f.owner)).status, 404);
});

test("Legacy service-role credentials remain backend-only and use bearer authorization", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "civigo-storage-legacy-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const remote = provider();
  const legacy = [
    Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from('{"role":"service_role"}').toString("base64url"),
    "test-signature",
  ].join(".");
  const storage = createStorage({
    env: { ...env, SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: legacy },
    directory,
    fetchImpl: remote.fetchImpl,
  });
  const id = crypto.randomUUID();
  const filePath = path.join(directory, id);
  await fs.writeFile(filePath, photo);
  await storage.save({ id, userId: 7, filePath, mimeType: "image/jpeg" });
  assert.equal(
    remote.calls[0].options.headers.Authorization,
    "Bearer " + legacy,
  );
  assert.equal(remote.calls[0].options.headers.apikey, legacy);
});

test("Videos over thirty seconds and oversized files never reach cloud storage", async (t) => {
  const f = await fixture(t);
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16);
  ftyp.write("ftyp", 4);
  ftyp.write("mp42", 8);
  const mvhd = Buffer.alloc(28);
  mvhd.writeUInt32BE(28);
  mvhd.write("mvhd", 4);
  mvhd.writeUInt32BE(1000, 20);
  mvhd.writeUInt32BE(31000, 24);
  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(36);
  moov.write("moov", 4);
  assert.equal(
    (
      await f.upload({
        mime: "video/mp4",
        data: Buffer.concat([ftyp, moov, mvhd]),
      })
    ).response.status,
    400,
  );
  const large = Buffer.alloc(15 * 1024 * 1024 + 1);
  photo.copy(large);
  const { json } = await f.upload({ data: large });
  assert.equal(json.code, "LIMIT_FILE_SIZE");
  assert.equal(f.remote.calls.length, 0);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test("Storage paths cannot escape the local directory or delete broad cloud prefixes", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "civigo-storage-local-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const local = createStorage({ env: {}, directory });
  const id = crypto.randomUUID();
  const filePath = path.join(directory, id);
  await fs.writeFile(filePath, photo);
  assert.equal(
    await local.save({ id, userId: 7, filePath, mimeType: "image/jpeg" }),
    filePath,
  );
  await assert.rejects(local.remove(path.join(directory, "..", "outside")), {
    status: 404,
  });
  await assert.rejects(
    local.remove("supabase://civigo-attachments/uploads/7/"),
    { status: 404 },
  );
  await local.remove(filePath);
  assert.deepEqual(await fs.readdir(directory), []);
});
