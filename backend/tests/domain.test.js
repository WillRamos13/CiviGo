const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword } = require("../src/lib/password");
const { credibility, chatOpen } = require("../src/lib/workflows");
const { monthRange, calculateRanking } = require("../src/lib/ranking");
const { ownUser, incident } = require("../src/lib/projections");
const { validateConfig, CATALOG, DISTRICTS } = require("../src/lib/catalog");
const { signature } = require("../src/routes/uploads");
const { birthDate, phone } = require("../src/routes/users");
test("Las contraseñas usan scrypt con sal distinta y rechazan texto plano", async () => {
  const a = await hashPassword("contraseña de prueba larga"),
    b = await hashPassword("contraseña de prueba larga");
  assert.notEqual(a, b);
  assert(await verifyPassword("contraseña de prueba larga", a));
  assert.equal(await verifyPassword("incorrecta", a), false);
  assert.equal(await verifyPassword("original", "original"), false);
  assert.equal(await verifyPassword("a", "scrypt$malformado"), false);
});
test("La credibilidad comienza sin definir y la cuarta falta bloquea", () => {
  assert.equal(credibility(0, 0), null);
  assert.equal(credibility(2, 0), null);
  assert.equal(credibility(3, 0), 100);
  assert.equal(credibility(3, 1), 70);
  assert.equal(credibility(3, 2), 40);
  assert.equal(credibility(3, 3), 20);
  assert.equal(credibility(3, 4), 0);
  assert.equal(credibility(1, 1), 70);
});
test("El cierre del chat respeta siete días y finalización comunitaria", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  assert(
    chatOpen(
      {
        individual: true,
        fechaCreacion: new Date(+now - 6 * 86400000),
        estado: "ACTIVO",
      },
      now,
    ),
  );
  assert.equal(
    chatOpen(
      {
        individual: true,
        fechaCreacion: new Date(+now - 7 * 86400000),
        estado: "ACTIVO",
      },
      now,
    ),
    false,
  );
  assert.equal(chatOpen({ individual: false, estado: "RESUELTO" }, now), false);
  assert(chatOpen({ individual: false, estado: "VALIDADO" }, now));
});
test("Un reporte individual pendiente de publicación conserva su chat y un histórico resuelto lo cierra", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const old = new Date(+now - 20 * 86400000);
  assert(
    chatOpen(
      {
        individual: true,
        publicado: false,
        fechaPublicacion: null,
        fechaCreacion: old,
        estado: "PENDIENTE",
      },
      now,
    ),
  );
  assert.equal(
    chatOpen(
      {
        individual: true,
        publicado: true,
        fechaPublicacion: old,
        fechaCreacion: old,
        estado: "ACTIVO",
      },
      now,
    ),
    false,
  );
  assert.equal(
    chatOpen(
      {
        individual: true,
        historico: true,
        fuente: "IMPORTACION",
        publicado: true,
        fechaCreacion: now,
        estado: "RESUELTO",
      },
      now,
    ),
    false,
  );
});
test("El ranking usa meses de Lima y reparte premios de posiciones empatadas", () => {
  const bounds = monthRange("2026-09");
  assert.equal(bounds.gte.toISOString(), "2026-09-01T05:00:00.000Z");
  assert.equal(bounds.lt.toISOString(), "2026-10-01T05:00:00.000Z");
  const ranking = calculateRanking(
    [
      { puntos: 20, nickname: "a" },
      { puntos: 20, nickname: "b" },
      { puntos: 10, nickname: "c" },
    ],
    [100, 80, 60],
  );
  assert.equal(ranking[0].monedasEstimadas, 90);
  assert.equal(ranking[1].monedasEstimadas, 90);
  assert.equal(ranking[2].position, 3);
  assert.throws(() => monthRange("2026-13"));
});
test("No se filtran contraseña, sesiones ni evidencia privada en proyecciones públicas", () => {
  const u = ownUser({
    id: 1,
    nombreUsuario: "nick",
    password: "secreto",
    sesiones: ["secreto"],
  });
  assert.equal(u.password, undefined);
  assert.equal(u.sesiones, undefined);
  const data = incident({
    id: 1,
    reportes: [
      {
        usuario: { id: 1, nombreUsuario: "nick", correo: "privado" },
        adjuntos: [
          { id: "publico", privado: false },
          { id: "privado", privado: true, path: "privado" },
        ],
      },
    ],
  });
  assert.equal(data.adjuntos.length, 1);
  assert.equal(data.reportes[0].usuario.correo, undefined);
  assert.equal(data.adjuntos[0].path, undefined);
});
test("El catálogo separa delitos individuales y urgencias; configura solo parámetros conocidos", () => {
  assert.equal(CATALOG.flatMap((c) => c[2]).length, 22);
  assert.equal(DISTRICTS.length, 14);
  assert.equal(CATALOG.flatMap((c) => c[2]).filter((t) => t[5]).length, 5);
  assert.throws(() => validateConfig({ confirmaciones: 1.5 }));
  assert.throws(() => validateConfig({ __unknown: 5 }));
  assert.throws(() => validateConfig({ influenciaVecina: 2 }));
});
test("Valida formato real de archivos, teléfono peruano y edad mínima", () => {
  assert(
    signature(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"),
  );
  assert.equal(
    signature(Buffer.from("<script>alert(1)</script>"), "image/png"),
    false,
  );
  assert.equal(phone("912345678"), "+51912345678");
  assert.throws(() => phone("123"));
  assert.throws(() => birthDate(new Date().toISOString()));
  assert.equal(
    birthDate("2000-01-01").toISOString(),
    "2000-01-01T00:00:00.000Z",
  );
  assert.throws(() => birthDate("2000-02-31"));
});
