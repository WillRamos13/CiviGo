const test = require("node:test");
const assert = require("node:assert/strict");
const {
  imageWebStatus,
  createImageWebCheck,
} = require("../src/lib/image-web-check");

const env = {
  GOOGLE_VISION_API_KEY: "private-vision-fixture",
  IMAGE_WEB_CHECK_ENABLED: "true",
};
const photo = (number = 1, overrides = {}) => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  tipo: "PUBLICO",
  estado: "LISTO",
  mimeType: "image/jpeg",
  path: "supabase://private-bucket/private-file-never-publish",
  userId: 91,
  filename: "private-user-name.jpg",
  ...overrides,
});
const jpeg = Buffer.from([255, 216, 255, 0, 255, 217]);
const resultResponse = (webDetection = {}) =>
  new Response(JSON.stringify({ responses: [{ webDetection }] }), {
    headers: { "Content-Type": "application/json" },
  });

function setup(options = {}) {
  const calls = { reads: [], requests: [], reserves: 0 };
  const adapter = createImageWebCheck({
    env,
    readAttachment: async (row) => {
      calls.reads.push(row.id);
      return jpeg;
    },
    reserve: async () => {
      calls.reserves++;
      return true;
    },
    fetchImpl: async (url, request) => {
      calls.requests.push({ url, request });
      return resultResponse();
    },
    ...options,
  });
  return { ...adapter, calls };
}

function silence(t) {
  const logs = [];
  t.mock.method(console, "warn", (message) => logs.push(message));
  return logs;
}

test("estado de búsqueda web exige activación explícita y no expone la clave", () => {
  assert.deepEqual(imageWebStatus({}), {
    proveedor: "google-vision",
    habilitado: false,
    configurado: false,
    limites: { diario: 100, mensual: 1000 },
  });
  assert.equal(imageWebStatus(env).configurado, true);
  assert.equal(
    imageWebStatus({ ...env, IMAGE_WEB_CHECK_ENABLED: "TRUE" }).habilitado,
    false,
  );
  assert.equal(
    imageWebStatus({ ...env, GOOGLE_VISION_API_KEY: "bad\nsecret-key" })
      .configurado,
    false,
  );
  assert.equal(
    imageWebStatus({ ...env, IMAGE_WEB_DAILY_LIMIT: "broken" }).limites.diario,
    0,
  );
  assert.ok(
    !JSON.stringify(imageWebStatus(env)).includes(env.GOOGLE_VISION_API_KEY),
  );
});

test("desactivado no lee archivos, reserva cuota ni abre red", async () => {
  const adapter = setup({ env: { ...env, IMAGE_WEB_CHECK_ENABLED: "false" } });
  assert.deepEqual(await adapter.checkReportImages([photo()]), {
    habilitado: false,
    requiereRevision: false,
    evidencias: [],
  });
  assert.deepEqual(adapter.calls, { reads: [], requests: [], reserves: 0 });
});

test("sin clave las fotos pasan a revisión y los vídeos no generan búsquedas", async () => {
  const adapter = setup({ env: { IMAGE_WEB_CHECK_ENABLED: "true" } });
  const result = await adapter.checkReportImages([photo()]);
  assert.equal(result.requiereRevision, true);
  assert.equal(result.evidencias[0].resultado, "NO_COMPROBADA");
  assert.deepEqual(
    await adapter.checkReportImages([photo(2, { mimeType: "video/mp4" })]),
    {
      habilitado: true,
      requiereRevision: false,
      evidencias: [],
    },
  );
  assert.deepEqual(adapter.calls, { reads: [], requests: [], reserves: 0 });
});

test("envía solo bytes de la foto y WEB_DETECTION al endpoint fijo sin URLs privadas", async () => {
  const adapter = setup();
  const result = await adapter.checkReportImages([photo()]);
  assert.equal(result.requiereRevision, false);
  assert.equal(result.evidencias[0].resultado, "SIN_COINCIDENCIAS");
  assert.match(
    result.evidencias[0].motivo,
    /no demuestra autoría, fecha ni ubicación/,
  );
  assert.equal(adapter.calls.reserves, 1);
  const { url, request } = adapter.calls.requests[0];
  assert.equal(url, "https://vision.googleapis.com/v1/images:annotate");
  assert.equal(request.method, "POST");
  assert.equal(request.redirect, "error");
  assert.equal(request.headers["x-goog-api-key"], env.GOOGLE_VISION_API_KEY);
  assert.ok(request.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(request.body), {
    requests: [
      {
        image: { content: jpeg.toString("base64") },
        features: [{ type: "WEB_DETECTION", maxResults: 10 }],
      },
    ],
  });
  for (const forbidden of [
    "private-bucket",
    "private-file",
    "userId",
    "private-user-name",
    env.GOOGLE_VISION_API_KEY,
  ]) {
    assert.ok(!request.body.includes(forbidden));
  }
});

test("coincidencias completas, parciales y dentro de páginas requieren revisión sin declarar falsedad", async () => {
  const detections = [
    { fullMatchingImages: [{ url: "https://images.example.com/photo.jpg" }] },
    { partialMatchingImages: [{ url: "https://images.example.com/crop.jpg" }] },
    {
      pagesWithMatchingImages: [
        {
          url: "https://news.example.com/story",
          fullMatchingImages: [{ url: "https://images.example.com/photo.jpg" }],
          partialMatchingImages: [
            { url: "https://images.example.com/crop.jpg" },
          ],
        },
      ],
    },
  ];
  for (const detection of detections) {
    const adapter = setup({ fetchImpl: async () => resultResponse(detection) });
    const result = await adapter.checkReportImages([photo()]);
    assert.equal(result.requiereRevision, true);
    assert.equal(result.evidencias[0].resultado, "COINCIDENCIA_WEB");
    assert.match(result.evidencias[0].motivo, /no declara falso/);
    assert.equal("posibleFalso" in result, false);
    assert.equal("posibleFalso" in result.evidencias[0], false);
  }
  const adapter = setup({
    fetchImpl: async () => resultResponse(detections[2]),
  });
  const detail = (await adapter.checkReportImages([photo()])).evidencias[0];
  assert.deepEqual(
    detail.coincidencias.map((item) => item.tipo),
    ["COMPLETA", "PARCIAL"],
  );
  assert.deepEqual(detail.paginas, ["https://news.example.com/story"]);
});

test("similitud visual, entidades y etiquetas no se confunden con una foto reutilizada", async () => {
  const adapter = setup({
    fetchImpl: async () =>
      resultResponse({
        visuallySimilarImages: [
          { url: "https://images.example.com/another-hole.jpg" },
        ],
        webEntities: [{ description: "Pothole", score: 0.9 }],
        bestGuessLabels: [{ label: "bache" }],
        pagesWithMatchingImages: [{ url: "https://news.example.com/story" }],
      }),
  });
  const result = await adapter.checkReportImages([photo()]);
  assert.equal(result.requiereRevision, false);
  assert.equal(result.evidencias[0].resultado, "SIN_COINCIDENCIAS");
  assert.equal(result.evidencias[0].coincidencias, undefined);
});

test("referencias web se limitan, deduplican y descartan destinos privados o peligrosos", async () => {
  const unsafe = [
    "javascript:alert(1)",
    "ftp://images.example.com/photo.jpg",
    "https://name:secret@images.example.com/photo.jpg",
    "http://127.0.0.1/photo.jpg",
    "http://2130706433/photo.jpg",
    "http://10.0.0.1/photo.jpg",
    "http://192.168.1.1/photo.jpg",
    "http://169.254.169.254/photo.jpg",
    "http://172.16.0.1/photo.jpg",
    "http://100.64.0.1/photo.jpg",
    "http://[::1]/photo.jpg",
    "http://localhost/photo.jpg",
    "http://storage.internal/photo.jpg",
  ];
  const publicImages = Array.from({ length: 9 }, (_, i) => ({
    url: `https://images.example.com/${i}.jpg`,
  }));
  const adapter = setup({
    fetchImpl: async () =>
      resultResponse({
        fullMatchingImages: [
          ...unsafe.map((url) => ({ url })),
          ...publicImages,
          publicImages[0],
        ],
        pagesWithMatchingImages: Array.from({ length: 8 }, (_, i) => ({
          url: `https://news.example.com/${i}`,
          fullMatchingImages: [publicImages[0]],
        })),
      }),
  });
  const detail = (await adapter.checkReportImages([photo()])).evidencias[0];
  assert.equal(detail.resultado, "COINCIDENCIA_WEB");
  assert.equal(detail.coincidencias.length, 5);
  assert.equal(detail.paginas.length, 5);
  assert.equal(new Set(detail.coincidencias.map((item) => item.url)).size, 5);
  assert.ok(
    detail.coincidencias.every((item) =>
      item.url.startsWith("https://images.example.com/"),
    ),
  );
});

test("filas no autorizadas, documentos, IDs inválidos, duplicados y más de tres archivos no se envían", async () => {
  for (const rows of [
    null,
    [null],
    [photo(1, { id: "invalid" })],
    [photo(1, { tipo: "IDENTIDAD" })],
    [photo(1, { estado: "PENDIENTE" })],
    [photo(), photo()],
    [photo(1), photo(2), photo(3), photo(4)],
  ]) {
    const adapter = setup();
    const result = await adapter.checkReportImages(rows);
    assert.equal(result.requiereRevision, true);
    assert.deepEqual(adapter.calls, { reads: [], requests: [], reserves: 0 });
  }
  const adapter = setup();
  const result = await adapter.checkReportImages([
    photo(1, { mimeType: "application/pdf" }),
    photo(2, { mimeType: "image/heic" }),
  ]);
  assert.equal(result.evidencias.length, 1);
  assert.equal(result.evidencias[0].adjuntoId, photo(2).id);
  assert.equal(result.evidencias[0].resultado, "NO_COMPROBADA");
  assert.deepEqual(adapter.calls, { reads: [], requests: [], reserves: 0 });
});

test("fotos de evidencia son admisibles sin usar el nombre ni la ruta como prueba de autoría", async () => {
  const adapter = setup();
  const result = await adapter.checkReportImages([
    photo(1, { tipo: "EVIDENCIA", privado: true }),
  ]);
  assert.equal(result.evidencias[0].resultado, "SIN_COINCIDENCIAS");
  assert.equal(adapter.calls.requests.length, 1);
});

test("magic inválido y fotos de más de 7 MiB pasan a revisión antes de reservar cuota", async () => {
  for (const buffer of [
    Buffer.from("not a jpeg"),
    Buffer.alloc(7 * 1024 * 1024 + 1),
  ]) {
    const adapter = setup({ readAttachment: async () => buffer });
    const result = await adapter.checkReportImages([photo()]);
    assert.equal(result.requiereRevision, true);
    assert.equal(result.evidencias[0].resultado, "NO_COMPROBADA");
    assert.equal(adapter.calls.reserves, 0);
    assert.equal(adapter.calls.requests.length, 0);
  }
  const buffer = Buffer.alloc(7 * 1024 * 1024);
  jpeg.copy(buffer, 0, 0, 3);
  buffer[buffer.length - 2] = 255;
  buffer[buffer.length - 1] = 217;
  const adapter = setup({ readAttachment: async () => buffer });
  await adapter.checkReportImages([photo()]);
  assert.ok(
    Buffer.byteLength(adapter.calls.requests[0].request.body) <
      10 * 1024 * 1024,
  );
});

test("lectura fallida, cuota agotada y error de cuota nunca se convierten en ausencia de coincidencias", async (t) => {
  silence(t);
  for (const options of [
    {
      readAttachment: async () => {
        throw new Error("private file path");
      },
    },
    { reserve: async () => false },
    {
      reserve: async () => {
        throw new Error("private database connection");
      },
    },
  ]) {
    const adapter = setup(options);
    const result = await adapter.checkReportImages([photo()]);
    assert.equal(result.evidencias[0].resultado, "NO_COMPROBADA");
    assert.equal(result.requiereRevision, true);
    assert.equal(adapter.calls.requests.length, 0);
  }
});

test("errores HTTP y redirecciones pasan a revisión y los logs no incluyen cuerpo ni claves", async (t) => {
  const logs = silence(t);
  for (const status of [301, 401, 403, 429, 500]) {
    const adapter = setup({
      fetchImpl: async () =>
        new Response("private-provider-body-and-key", { status }),
    });
    const result = await adapter.checkReportImages([photo()]);
    assert.equal(result.evidencias[0].resultado, "NO_COMPROBADA");
    assert.equal(result.requiereRevision, true);
    assert.equal(adapter.calls.reserves, 1);
  }
  const redirected = resultResponse();
  Object.defineProperty(redirected, "redirected", { value: true });
  const adapter = setup({ fetchImpl: async () => redirected });
  assert.equal(
    (await adapter.checkReportImages([photo()])).evidencias[0].resultado,
    "NO_COMPROBADA",
  );
  for (const log of logs) {
    assert.ok(!log.includes("private-provider"));
    assert.ok(!log.includes(env.GOOGLE_VISION_API_KEY));
    assert.ok(!log.includes("https://"));
  }
});

test("respuesta malformada o un error por imagen obliga a revisión humana", async (t) => {
  silence(t);
  for (const value of [
    null,
    [],
    {},
    { error: { message: "private-provider-body" } },
    { responses: [] },
    { responses: [{}, {}] },
    { responses: [{}] },
    { responses: [{ error: { code: 7 } }] },
    { responses: [{ webDetection: [] }] },
    { responses: [{ webDetection: { fullMatchingImages: "wrong" } }] },
    { responses: [{ webDetection: { partialMatchingImages: [{}] } }] },
    { responses: [{ webDetection: { pagesWithMatchingImages: [null] } }] },
  ]) {
    const adapter = setup({
      fetchImpl: async () => new Response(JSON.stringify(value)),
    });
    assert.equal(
      (await adapter.checkReportImages([photo()])).evidencias[0].resultado,
      "NO_COMPROBADA",
    );
  }
  const adapter = setup({ fetchImpl: async () => new Response("not-json") });
  assert.equal(
    (await adapter.checkReportImages([photo()])).evidencias[0].resultado,
    "NO_COMPROBADA",
  );
});

test("respuesta de más de 1 MiB se limita por header y durante el stream", async (t) => {
  silence(t);
  for (const response of [
    new Response("{}", {
      headers: { "Content-Length": String(1024 * 1024 + 1) },
    }),
    new Response("x".repeat(1024 * 1024 + 1)),
  ]) {
    const adapter = setup({ fetchImpl: async () => response });
    assert.equal(
      (await adapter.checkReportImages([photo()])).evidencias[0].resultado,
      "NO_COMPROBADA",
    );
  }
});

test("timeout total comprende lectura, cuota, fetch y stream de respuesta", async (t) => {
  silence(t);
  const never = () => new Promise(() => {});
  const hangingBody = () => new Response(new ReadableStream({ start() {} }));
  for (const options of [
    { readAttachment: never },
    { reserve: never },
    { fetchImpl: never },
    { fetchImpl: async () => hangingBody() },
  ]) {
    const adapter = setup({ ...options, timeoutMs: 5 });
    const result = await adapter.checkReportImages([photo(), photo(2)]);
    assert.equal(result.requiereRevision, true);
    assert.equal(result.evidencias.length, 2);
    assert.ok(
      result.evidencias.every((item) => item.resultado === "NO_COMPROBADA"),
    );
  }
});

test("el deadline es compartido por las tres fotos y no inicia búsquedas luego de expirar", async (t) => {
  silence(t);
  let requests = 0;
  const adapter = setup({
    timeoutMs: 10,
    fetchImpl: async () => {
      if (++requests === 1) return resultResponse();
      return new Promise(() => {});
    },
  });
  const result = await adapter.checkReportImages([photo(), photo(2), photo(3)]);
  assert.equal(result.evidencias[0].resultado, "SIN_COINCIDENCIAS");
  assert.equal(result.evidencias[1].resultado, "NO_COMPROBADA");
  assert.equal(result.evidencias[2].resultado, "NO_COMPROBADA");
  assert.equal(requests, 2);
  assert.equal(adapter.calls.reserves, 2);
});
