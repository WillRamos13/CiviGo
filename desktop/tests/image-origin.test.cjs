const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const mainPolicy = require("../electron/policy.cjs");

function source(name, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src", name), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    URL,
    require: (name) => {
      if (!(name in imports)) throw new Error("Import inesperado: " + name);
      return imports[name];
    },
    ...globals,
  });
  return exports;
}
const helper = source("lib/image-origin-audit.ts");

test("las referencias públicas se validan tanto en renderer como en main, sin abrir la política de enlaces de CiviGo", () => {
  for (const [input, expected] of [
    [
      "https://www.example.com/photos/a.jpg?width=100#fragment",
      "https://www.example.com/photos/a.jpg?width=100",
    ],
    [
      "http://photos.example.org:80/image.jpg",
      "http://photos.example.org/image.jpg",
    ],
    ["https://WWW.EXAMPLE.COM./image.jpg", "https://www.example.com/image.jpg"],
  ]) {
    assert.equal(helper.imageReferenceUrl(input).url, expected);
    assert.equal(mainPolicy.imageReferenceUrl(input), expected);
    assert.throws(() => mainPolicy.publicUrl(input));
  }
  for (const input of [
    null,
    undefined,
    {},
    "not a url",
    "/image.jpg",
    "//example.com/image.jpg",
    "javascript:alert(1)",
    "file:///secret",
    "data:image/png;base64,abc",
    "https://user:password@example.com/image",
    "https://localhost/photo",
    "https://localhost./photo",
    "https://images.local/photo",
    "https://service.railway.internal/photo",
    "https://intranet/photo",
    "https://images.home/photo",
    "https://192.168.1.5/photo",
    "http://127.0.0.1/photo",
    "https://2130706433/photo",
    "http://0x7f000001/photo",
    "https://[::1]/photo",
    "https://[::ffff:127.0.0.1]/photo",
    "https://example.com:8080/photo",
    "https://example.com\\@localhost/photo",
    "https://example.com/\nphoto",
    "https://-example.com/photo",
    "https://example.com/" + "x".repeat(2048),
  ]) {
    assert.equal(helper.imageReferenceUrl(input), null, String(input));
    assert.throws(
      () => mainPolicy.imageReferenceUrl(input),
      undefined,
      String(input),
    );
  }
});

test("la auditoría de imágenes descarta datos inválidos y referencias privadas sin acreditar originalidad", () => {
  const audit = helper.readImageOriginAudit({
    habilitado: true,
    requiereRevision: true,
    evidencias: [
      {
        adjuntoId: "photo-1",
        resultado: "COINCIDENCIA_WEB",
        motivo: "Coincidencia parcial, pendiente de revisión.",
        coincidencias: [
          { tipo: "PARCIAL", url: "https://photos.example.com/a.jpg" },
          { tipo: "COMPLETA", url: "https://user:secret@example.com/photo" },
          { tipo: "SIMILAR", url: "https://photos.example.com/similar.jpg" },
        ],
        paginas: ["https://news.example.com/article", "https://localhost/page"],
      },
      null,
      {
        adjuntoId: "photo-2",
        resultado: "SIN_COINCIDENCIAS",
        motivo: "Sin coincidencias encontradas.",
      },
    ],
  });
  assert.equal(audit.evidencias.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(audit.evidencias[0].referencias)),
    [
      {
        url: "https://photos.example.com/a.jpg",
        host: "photos.example.com",
        tipo: "PARCIAL",
      },
      {
        url: "https://news.example.com/article",
        host: "news.example.com",
        tipo: "PAGINA",
      },
    ],
  );
  assert.equal(audit.evidencias[1].resultado, "SIN_COINCIDENCIAS");
  for (const value of [
    null,
    undefined,
    [],
    {},
    { habilitado: "true", requiereRevision: false, evidencias: [] },
    { habilitado: true, requiereRevision: false, evidencias: null },
  ])
    assert.equal(helper.readImageOriginAudit(value), null);
  const disabled = helper.readImageOriginAudit({
    habilitado: false,
    requiereRevision: false,
    evidencias: [
      {
        adjuntoId: "photo-1",
        resultado: "COINCIDENCIA_WEB",
        coincidencias: [
          { tipo: "COMPLETA", url: "https://photos.example.com/a.jpg" },
        ],
      },
    ],
  });
  assert.equal(disabled.evidencias[0].resultado, "NO_COMPROBADA");
  assert.equal(disabled.evidencias[0].referencias.length, 0);
});

function renderAudit(origenImagenes, bridge = {}) {
  const react = { useState: (initial) => [initial, () => {}] };
  const runtime = {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
    Fragment: "fragment",
  };
  const common = {
    usePagedRemote: () => ({
      data: [
        {
          id: 1,
          accion: "EVALUACION_IA_REPORTE",
          entidad: "REPORTE",
          entidadId: "42",
          creadoEn: "2026-10-11T12:00:00Z",
          datos: { origenImagenes },
        },
      ],
      loading: false,
      page: 1,
      pages: 1,
      total: 1,
      setPage() {},
      reload() {},
    }),
    dateTime: (value) => value,
    Feedback: "feedback",
    Pagination: "pagination",
    RemoteStatus: "status",
    message: (reason) => reason.message,
  };
  const component = source(
    "components/management/AuditPanel.tsx",
    {
      react,
      "react/jsx-runtime": runtime,
      "./common": common,
      "@/lib/api": {
        unwrap: (value) => {
          if (!value.ok) throw new Error(value.error.message);
          return value.data;
        },
        api() {
          throw new Error("No se debe enviar ninguna petición al renderizar.");
        },
      },
      "@/lib/image-origin-audit": helper,
    },
    { window: { civigoDesktop: bridge } },
  );
  function expand(tree) {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!tree || typeof tree !== "object") return tree;
    if (typeof tree.type === "function") return expand(tree.type(tree.props));
    return {
      ...tree,
      props: { ...tree.props, children: expand(tree.props?.children) },
    };
  }
  return expand(component.default());
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree))
    return tree.flatMap((child) => nodes(child, predicate));
  return [
    ...(predicate(tree) ? [tree] : []),
    ...nodes(tree.props?.children, predicate),
  ];
}

test("Auditoría muestra coincidencias y motivos sin cargar imágenes y abre sólo el canal de referencias al hacer clic", async () => {
  const opened = [];
  const tree = renderAudit(
    {
      habilitado: true,
      requiereRevision: true,
      evidencias: [
        {
          adjuntoId: "photo-1",
          resultado: "COINCIDENCIA_WEB",
          motivo: "Una publicación previa contiene parte de la imagen.",
          coincidencias: [
            {
              tipo: "PARCIAL",
              url: "https://photos.example.com/a.jpg?reference=1",
            },
          ],
          paginas: [
            "https://localhost/private",
            "https://news.example.com/article",
          ],
        },
        {
          adjuntoId: "photo-2",
          resultado: "SIN_COINCIDENCIAS",
          motivo: "La búsqueda no encontró una publicación.",
        },
      ],
    },
    {
      openImageReference: async (url) => {
        opened.push(url);
        return { ok: true };
      },
    },
  );
  assert.equal(nodes(tree, (node) => node.type === "img").length, 0);
  assert.equal(opened.length, 0);
  const links = nodes(tree, (node) => node.type === "a");
  assert.equal(links.length, 2);
  assert.equal(links[0].props.rel, "noopener noreferrer");
  assert.equal(
    links[0].props.href,
    "https://photos.example.com/a.jpg?reference=1",
  );
  assert.match(JSON.stringify(links[0].props.children), /Coincidencia parcial/);
  assert.match(JSON.stringify(links[0].props.children), /photos.example.com/);
  assert.doesNotMatch(JSON.stringify(links[0].props.children), /reference=1/);
  assert.match(
    JSON.stringify(tree),
    /tampoco acredita que la imagen sea propia/,
  );
  let prevented = false;
  links[0].props.onClick({
    preventDefault() {
      prevented = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.deepEqual(opened, ["https://photos.example.com/a.jpg?reference=1"]);
});

test("Auditoría muestra búsqueda deshabilitada como no comprobada, sin referencias activas", () => {
  const tree = renderAudit({
    habilitado: false,
    requiereRevision: false,
    evidencias: [
      {
        adjuntoId: "photo-1",
        resultado: "COINCIDENCIA_WEB",
        coincidencias: [
          { tipo: "COMPLETA", url: "https://photos.example.com/a.jpg" },
        ],
      },
    ],
  });
  assert.match(
    JSON.stringify(tree),
    /No se comprobó el origen de las imágenes/,
  );
  assert.equal(nodes(tree, (node) => node.type === "a").length, 0);
});
