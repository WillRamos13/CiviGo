const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error(
      "Las pruebas de reportes cercanos requieren una base local aislada.",
    );
  require("./helpers/provider-environment").disableExternalProviders();
  process.env.DATABASE_URL = connection;
  process.env.NODE_ENV = "test";
}

test(
  "HTTP: latest ten nearby reports ignore the global cap and preserve public visibility and type filters",
  { skip: !connection },
  async () => {
    const db = require("../src/lib/db");
    const app = require("../src/server");
    const run = crypto.randomBytes(6).toString("hex");
    const source = "fixture_nearby_" + run;
    const name = "Incidente cercano " + run;
    const key = "incidente-cercano-" + run;
    const position = { latitud: -14.0678, longitud: -75.7286 };
    const now = new Date();
    const base = {
      tipo: name,
      ...position,
      fuente: source,
      publicado: true,
      estado: "ACTIVO",
      nivelRiesgo: 2,
      evaluacion: "AGENTE",
      validacion: 1,
      fechaEvento: new Date(+now - 60000),
    };
    let category, type, unverified, server;
    const north = (meters) => ({
      ...position,
      latitud: position.latitud + ((meters / 6371000) * 180) / Math.PI,
    });
    try {
      category = await db.category.create({
        data: { nombre: "Fixture de cercanía", slug: "fixture-nearby-" + run },
      });
      type = await db.incidentType.create({
        data: { nombre: name, slug: key, categoriaId: category.id },
      });
      const oldCreation = await db.incident.create({
        data: {
          ...base,
          fechaCreacion: new Date(+now - 90 * 86400000),
          fechaPublicacion: new Date(+now - 1000),
        },
      });
      await db.incident.createMany({
        data: Array.from({ length: 525 }, (_, index) => ({
          ...base,
          descripcion: "Fila mínima de prueba " + index,
          fechaCreacion: new Date(+now - index * 1000),
          fechaPublicacion:
            index < 515
              ? new Date(+now - 86400000 - index * 1000)
              : new Date(+now - (525 - index) * 2000),
        })),
      });
      const typed = await db.incident.create({
        data: {
          ...base,
          tipo: "Nombre legado distinto",
          tipoId: type.id,
          fechaPublicacion: now,
        },
      });
      await db.incident.createMany({
        data: [
          { ...base, ...north(1000.1), fechaPublicacion: now },
          {
            ...base,
            ...north(900),
            longitud:
              position.longitud +
              ((900 /
                (6371000 * Math.cos((position.latitud * Math.PI) / 180))) *
                180) /
                Math.PI,
            fechaPublicacion: now,
          },
          { ...base, tipo: "Otra categoría " + run, fechaPublicacion: now },
          { ...base, publicado: false, fechaPublicacion: now },
          { ...base, estado: "FALSO", fechaPublicacion: now },
          {
            ...base,
            estado: "RESUELTO",
            historico: false,
            fechaPublicacion: now,
          },
          {
            ...base,
            historico: true,
            fechaEvento: new Date(+now + 86400000),
            fechaPublicacion: now,
          },
          {
            ...base,
            estado: "RESUELTO",
            historico: true,
            fechaEvento: new Date(+now - 4 * 365 * 86400000),
            fechaPublicacion: now,
          },
        ],
      });
      unverified = await db.user.create({
        data: {
          nombreUsuario: "nearby_" + run,
          correo: "nearby_" + run + "@gmail.com",
          telefono: "+519" + crypto.randomInt(10000000, 99999999),
          password: "scrypt$fixture_no_login",
          correoVerificado: false,
          telefonoVerificado: true,
        },
      });
      const privateIncident = await db.incident.create({
        data: { ...base, fechaPublicacion: now },
      });
      await db.report.create({
        data: {
          usuarioId: unverified.id,
          incidenteId: privateIncident.id,
          tipo: name,
          descripcion: "Texto privado del autor sin correo verificado",
          ...position,
        },
      });
      const historicalName = "Antecedente cercano " + run;
      const historicalKey = "antecedente-cercano-" + run;
      const historical = await db.incident.create({
        data: {
          ...base,
          tipo: historicalName,
          estado: "RESUELTO",
          historico: true,
          fechaEvento: new Date(+now - 180 * 86400000),
          fechaPublicacion: now,
        },
      });

      server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      const root = `http://127.0.0.1:${server.address().port}/api/incidents`;
      const request = async (query) => {
        const response = await fetch(root + query);
        return {
          status: response.status,
          json: await response.json(),
          cache: response.headers.get("cache-control"),
        };
      };
      const gpsQuery = `?latitud=${position.latitud}&longitud=${position.longitud}`;
      const global = await request("");
      assert.equal(global.status, 200);
      assert.equal(
        global.json.some((row) => row.id === oldCreation.id),
        false,
        "Fixture demonstrates the existing global cap",
      );
      const response = await request(gpsQuery + "&tipo=" + key);
      assert.equal(response.status, 200, JSON.stringify(response.json));
      assert.equal(response.cache, "no-store");
      assert.equal(response.json.length, 10);
      assert.equal(
        response.json[0].id,
        typed.id,
        "Catalog slug wins over legacy name",
      );
      assert.equal(
        response.json[1].id,
        oldCreation.id,
        "Publication determines recency, even beyond global cap",
      );
      assert.equal(
        response.json.some((row) => row.id === privateIncident.id),
        false,
      );
      assert.ok(
        response.json
          .slice(2)
          .every((row) => row.descripcion.startsWith("Fila mínima de prueba")),
      );
      assert.equal(
        JSON.stringify(response.json).includes("scrypt$fixture_no_login"),
        false,
      );
      assert.equal(
        JSON.stringify(response.json).includes("Texto privado del autor"),
        false,
      );
      const history = await request(gpsQuery + "&tipo=" + historicalKey);
      assert.deepEqual(
        history.json.map((row) => row.id),
        [historical.id],
      );
      assert.equal((await request("?latitud=-14")).status, 400);
      assert.equal((await request("?latitud=&longitud=-75")).status, 400);
      assert.equal(
        (await request(gpsQuery + "&tipo=robo&tipo=hurto")).status,
        400,
      );
      assert.equal((await request("?latitud=-90&longitud=180")).status, 200);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      try {
        if (unverified)
          await db.report.deleteMany({ where: { usuarioId: unverified.id } });
        await db.incident.deleteMany({ where: { fuente: source } });
        if (unverified) await db.user.delete({ where: { id: unverified.id } });
        if (type) await db.incidentType.delete({ where: { id: type.id } });
        if (category) await db.category.delete({ where: { id: category.id } });
      } finally {
        await db.$disconnect();
      }
    }
  },
);
