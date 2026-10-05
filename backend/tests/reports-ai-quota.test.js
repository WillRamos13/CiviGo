const test = require("node:test");
const assert = require("node:assert/strict");

test("Los reportes reservan cuota antes de la IA incluso con solicitudes concurrentes", async (t) => {
  const previousPrisma = globalThis.__civigoPrisma;
  const previousEnvironment = process.env.NODE_ENV;
  const nativeFetch = global.fetch;
  let server;
  let releaseProvider;
  let requests = [];
  try {
    process.env.NODE_ENV = "test";
    const type = {
      id: 1,
      nombre: "Incendio",
      slug: "incendio",
      activo: true,
      emergencia: true,
      individual: false,
      ubicacionRemota: true,
      fotoObligatoria: false,
    };
    globalThis.__civigoPrisma = {
      incidentType: {
        findFirst: async (query) =>
          query.where.OR[0].slug === type.slug ? type : null,
      },
      appConfig: { findUnique: async () => ({ valor: {} }) },
      attachment: { findMany: async () => [] },
      // No se guarda nada mientras el proveedor está esperando. El conteo
      // persistido, por sí solo, permitiría pasar a las cuatro peticiones.
      report: { count: async (query) => (query.where.usuarioId === 3 ? 3 : 0) },
    };
    const { HttpError } = require("../src/lib/http");
    const roads = require("../src/lib/roads");
    t.mock.method(roads, "inProvince", () => true);
    t.mock.method(roads, "districtFor", () => "Ica");
    const providers = require("../src/lib/providers");
    const providerGate = new Promise((resolve) => {
      releaseProvider = resolve;
    });
    let providerCalls = 0;
    const listeners = [];
    function providerEntered(count) {
      if (providerCalls >= count) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error("No entraron las solicitudes esperadas al proveedor."),
            ),
          5000,
        );
        listeners.push({
          count,
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
        });
      });
    }
    t.mock.method(providers, "evaluateReport", async (report, selectedType) => {
      assert.equal(report.descripcion, "Solicitud de prueba");
      assert.equal(selectedType.slug, "incendio");
      providerCalls++;
      for (const listener of listeners)
        if (providerCalls >= listener.count) listener.resolve();
      await providerGate;
      // Finaliza las solicitudes sin pasar a persistencia ni conectar una BD.
      throw new HttpError(503, "Fin de la evaluación simulada.");
    });
    t.mock.method(global, "fetch", async () => {
      throw new Error("Esta prueba no debe invocar una API externa.");
    });
    const express = require("express");
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.authLoaded = true;
      req.user = {
        id: Number(req.headers["x-fixture-user"]),
        telefonoVerificado: false,
        correoVerificado: true,
        bloqueado: false,
      };
      next();
    });
    app.use("/api/reports", require("../src/routes/reports"));
    app.use((error, req, res, next) =>
      res.status(error.status || 500).json({ error: error.message }),
    );
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = "http://127.0.0.1:" + server.address().port;
    const validReport = {
      tipo: type.slug,
      descripcion: "Solicitud de prueba",
      latitud: -14.0677,
      longitud: -75.7286,
      distrito: "Ica",
    };
    async function submit(userId, body = validReport) {
      const response = await nativeFetch(base + "/api/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fixture-user": String(userId),
          Connection: "close",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      return {
        status: response.status,
        headers: response.headers,
        body: await response.json(),
      };
    }

    // Los errores de validación se resuelven antes de reservar cuota de IA.
    for (let n = 0; n < 4; n++) {
      const invalid = await submit(1, { ...validReport, tipo: "desconocido" });
      assert.equal(invalid.status, 400);
    }
    assert.equal(providerCalls, 0);

    requests = Array.from({ length: 3 }, () =>
      submit(1).catch((error) => ({ status: 0, error })),
    );
    await providerEntered(3);
    const fourth = await submit(1);
    assert.equal(fourth.status, 429);
    assert.ok(Number(fourth.headers.get("retry-after")) >= 1);
    assert.equal(providerCalls, 3);

    // La cuota pertenece al usuario, aunque las solicitudes compartan IP.
    requests.push(submit(2).catch((error) => ({ status: 0, error })));
    await providerEntered(4);
    assert.equal(providerCalls, 4);

    // El respaldo persistido sigue protegiendo tras reiniciar el servidor.
    const persistedLimit = await submit(3);
    assert.equal(persistedLimit.status, 429);
    assert.equal(providerCalls, 4);
    releaseProvider();
    const completed = await Promise.all(requests);
    assert.deepEqual(
      completed.map((result) => result.status),
      [503, 503, 503, 503],
    );
  } finally {
    releaseProvider?.();
    await Promise.allSettled(requests);
    if (server) await new Promise((resolve) => server.close(resolve));
    globalThis.__civigoPrisma = previousPrisma;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});
