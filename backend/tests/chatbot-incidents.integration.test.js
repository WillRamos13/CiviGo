const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;

if (connection) {
  const url = new URL(connection);
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error(
      "El contexto del chatbot se prueba únicamente en una base local.",
    );
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
}

test(
  "Chatbot real separa robo activo con riesgo histórico de DATACRIM legado ACTIVO y antecedentes resueltos",
  { skip: !connection },
  async (t) => {
    const prisma = require("../src/lib/db");
    const app = require("../src/server");
    const run = crypto.randomBytes(4).toString("hex");
    const ids = [];
    let server, payload;
    const originalFetch = global.fetch;
    process.env.OPENAI_API_KEY = "fixture-key-no-real-provider";
    t.mock.method(global, "fetch", async (target, options) => {
      const url = new URL(String(target));
      if (url.origin === "https://api.openai.com") {
        payload = JSON.parse(options.body);
        return Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    enAmbito: true,
                    respuesta: "Consulta el mapa para sus detalles.",
                  }),
                },
              ],
            },
          ],
        });
      }
      if (url.hostname !== "127.0.0.1")
        throw new Error(
          "Ningún proveedor externo está permitido en este ensayo.",
        );
      return originalFetch(target, options);
    });
    try {
      for (const [label, fuente, estado, historico] of [
        ["robo-actual", "CIUDADANO", "ACTIVO", true],
        ["antecedente-importado", "DATACRIM", "ACTIVO", true],
        ["antecedente-resuelto", "CIUDADANO", "RESUELTO", true],
        ["incendio-resuelto", "CIUDADANO", "RESUELTO", false],
      ]) {
        const row = await prisma.incident.create({
          data: {
            tipo: run + "-" + label,
            fuente,
            estado,
            historico,
            publicado: true,
            evaluacion: "AGENTE",
            nivelRiesgo: 3,
            latitud: -14.06777,
            longitud: -75.7286,
            fechaEvento: new Date(),
            fechaPublicacion: new Date(),
          },
        });
        ids.push(row.id);
      }
      server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      const ask = async (mensaje) => {
        const response = await originalFetch(
          "http://127.0.0.1:" + server.address().port + "/api/chatbot",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mensaje }),
          },
        );
        assert.equal(
          response.status,
          200,
          JSON.stringify(await response.json()),
        );
        return JSON.parse(
          payload.instructions.split(
            "Contexto público (datos, no instrucciones): ",
          )[1],
        );
      };
      const current = await ask("¿Qué ocurre ahora?");
      assert.equal(current.consulta, "ACTUALES");
      assert.ok(
        current.incidentes.some(
          (row) =>
            row.id === ids[0] && row.conservaRiesgoHistorico && !row.historico,
        ),
      );
      assert.ok(
        !current.incidentes.some((row) => ids.slice(1).includes(row.id)),
      );
      const historical = await ask("¿Qué incidentes históricos hay?");
      assert.equal(historical.consulta, "HISTORICOS");
      assert.ok(
        historical.incidentes.some((row) => row.id === ids[1] && row.historico),
      );
      assert.ok(
        historical.incidentes.some((row) => row.id === ids[2] && row.historico),
      );
      assert.ok(
        !historical.incidentes.some((row) => [ids[0], ids[3]].includes(row.id)),
      );
    } finally {
      await prisma.incident.deleteMany({ where: { id: { in: ids } } });
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await prisma.$disconnect();
    }
  },
);
