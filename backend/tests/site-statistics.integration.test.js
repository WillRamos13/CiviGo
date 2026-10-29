const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const connection = process.env.TEST_DATABASE_URL;
test(
  "global dashboards use real historical dates, comparable months and production-only revenue without exporting personal data",
  { skip: !connection },
  async () => {
    assert.ok(
      ["localhost", "127.0.0.1"].includes(new URL(connection).hostname),
    );
    const { PrismaClient } = require("@prisma/client"),
      db = new PrismaClient({ datasourceUrl: connection }),
      { siteStatistics } = require("../src/lib/site-statistics");
    const id = randomUUID(),
      ids = [],
      keys = [];
    let user;
    try {
      user = await db.user.create({
        data: {
          nombreUsuario: id,
          correo: id + "@private.invalid",
          telefono: id,
          password: "DO_NOT_EXPOSE_PASSWORD",
          rol: "ADMIN",
        },
      });
      for (const fecha of [
        "2000-02-01T18:00:00Z",
        "2026-10-10T18:00:00Z",
        "2026-09-10T18:00:00Z",
      ])
        ids.push(
          (
            await db.incident.create({
              data: {
                tipo: id,
                descripcion: "Descripción privada",
                latitud: -14.07,
                longitud: -75.73,
                distrito: "Ica",
                fechaEvento: new Date(fecha),
                historico: fecha.startsWith("2000"),
              },
            })
          ).id,
        );
      for (const [mode, state, amount] of [
        ["production", "approved", 590],
        ["test", "approved", 590],
        ["production", "refunded", 590],
      ]) {
        const clave = "payments:order:" + id + ":" + keys.length;
        keys.push(clave);
        await db.appConfig.create({
          data: {
            clave,
            valor: { modo: mode, estado: state, centimos: amount },
          },
        });
      }
      const d = await siteStatistics(db, new Date("2026-10-15T12:00:00Z"));
      assert.ok(d.totals.historical >= 1);
      assert.ok(d.charts.years.some((row) => row.label === "2000"));
      const comparison = d.typeComparison.find((row) => row.label === id);
      assert.deepEqual(comparison, {
        label: id,
        current: 1,
        previous: 1,
        deltaPercent: 0,
      });
      assert.ok(d.totals.productionRevenueCents >= 590);
      assert.ok(!JSON.stringify(d).includes("DO_NOT_EXPOSE_PASSWORD"));
      assert.ok(!JSON.stringify(d).includes("@private.invalid"));
      assert.ok(!JSON.stringify(d).includes("Descripción privada"));
    } finally {
      await db.incident.deleteMany({ where: { id: { in: ids } } });
      await db.appConfig.deleteMany({ where: { clave: { in: keys } } });
      if (user) await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  },
);
