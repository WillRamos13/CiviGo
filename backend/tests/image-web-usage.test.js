const test = require("node:test");
const assert = require("node:assert/strict");
const {
  imageWebUsageLimits,
  reserveImageWebRequest,
} = require("../src/lib/image-web-usage");

function transactionalFixture() {
  let rows = new Map();
  const db = {
    $transaction: async (work, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      const pending = structuredClone(rows);
      const result = await work({
        usageCounter: {
          upsert: async ({ where, create, update }) => {
            const previous = pending.get(where.clave);
            const row = previous
              ? {
                  ...previous,
                  cantidad: previous.cantidad + update.cantidad.increment,
                }
              : create;
            pending.set(where.clave, row);
            return row;
          },
        },
      });
      rows = pending;
      return result;
    },
  };
  return { db, rows: () => rows };
}

test("Web Detection tiene límites propios y configuraciones inválidas pausan las llamadas", async () => {
  assert.deepEqual(imageWebUsageLimits({}), { daily: 100, monthly: 1000 });
  assert.deepEqual(
    imageWebUsageLimits({
      IMAGE_WEB_DAILY_LIMIT: "12",
      IMAGE_WEB_MONTHLY_LIMIT: "300",
    }),
    { daily: 12, monthly: 300 },
  );
  for (const invalid of ["broken", "-1", "2.5", "Infinity", "1000001"])
    assert.deepEqual(
      imageWebUsageLimits({
        IMAGE_WEB_DAILY_LIMIT: invalid,
        IMAGE_WEB_MONTHLY_LIMIT: invalid,
      }),
      { daily: 0, monthly: 0 },
    );
  assert.equal(
    await reserveImageWebRequest(null, new Date(), { daily: 0, monthly: 10 }),
    false,
  );
  assert.equal(
    await reserveImageWebRequest(null, new Date(), { daily: 10, monthly: 0 }),
    false,
  );
  await assert.rejects(
    reserveImageWebRequest(null, new Date("invalid")),
    TypeError,
  );
  await assert.rejects(
    reserveImageWebRequest(null, new Date(), { daily: -1, monthly: 10 }),
    TypeError,
  );
});

test("La cuota usa el calendario UTC y devuelve ambas reservas al exceder un límite", async () => {
  const fixture = transactionalFixture();
  const now = new Date("2094-03-31T21:00:00-05:00");
  const limits = { daily: 1, monthly: 2 };
  assert.equal(await reserveImageWebRequest(fixture.db, now, limits), true);
  assert.deepEqual(
    [...fixture.rows().keys()],
    ["vision:web:month:2094-04", "vision:web:day:2094-04-01"],
  );
  assert.equal(await reserveImageWebRequest(fixture.db, now, limits), false);
  assert.equal(fixture.rows().get("vision:web:month:2094-04").cantidad, 1);
  assert.equal(fixture.rows().get("vision:web:day:2094-04-01").cantidad, 1);
  assert.equal(
    await reserveImageWebRequest(
      fixture.db,
      new Date("2094-04-02T00:00:00Z"),
      limits,
    ),
    true,
  );
  assert.equal(
    await reserveImageWebRequest(
      fixture.db,
      new Date("2094-04-03T00:00:00Z"),
      limits,
    ),
    false,
  );
  assert.equal(fixture.rows().has("vision:web:day:2094-04-03"), false);
  assert.equal(fixture.rows().get("vision:web:month:2094-04").cantidad, 2);
  assert.equal(
    await reserveImageWebRequest(
      fixture.db,
      new Date("2094-05-01T00:00:00Z"),
      limits,
    ),
    true,
  );
});

test("Los conflictos serializables se reintentan y errores de base no autorizan una llamada", async () => {
  let attempts = 0;
  const db = {
    $transaction: async (work) => {
      if (++attempts < 3)
        throw Object.assign(new Error("Serialization conflict"), {
          code: "P2034",
        });
      return work({ usageCounter: { upsert: async () => ({ cantidad: 1 }) } });
    },
  };
  assert.equal(await reserveImageWebRequest(db), true);
  assert.equal(attempts, 3);
  await assert.rejects(
    reserveImageWebRequest({
      $transaction: async () => {
        throw new Error("unavailable");
      },
    }),
    /unavailable/,
  );
});

const connection = process.env.TEST_DATABASE_URL;
if (
  connection &&
  !["localhost", "127.0.0.1"].includes(new URL(connection).hostname)
)
  throw new Error("Web Detection quota tests require a local test database");

test(
  "Cuota PostgreSQL concurrente y persistente entre instancias sin consumir la cuota de IA",
  {
    skip: !connection,
    timeout: 60000,
  },
  async (t) => {
    const { PrismaClient } = require("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url: connection } } });
    const limits = { daily: 2, monthly: 3 };
    const first = new Date("2094-07-30T12:00:00Z");
    const nextDay = new Date("2094-07-31T12:00:00Z");
    const nextMonth = new Date("2094-08-01T00:00:00Z");
    const where = { clave: { startsWith: "vision:web:" } };
    const scopedWhere = { AND: [where, { clave: { contains: ":2094-" } }] };
    try {
      await db.usageCounter.deleteMany({ where: scopedWhere });
      await t.test(
        "Las reservas simultáneas no exceden el día ni inflan el mes",
        async () => {
          const reservations = await Promise.all(
            Array.from({ length: 8 }, () =>
              reserveImageWebRequest(db, first, limits),
            ),
          );
          assert.equal(reservations.filter(Boolean).length, 2);
          assert.equal(
            (
              await db.usageCounter.findUnique({
                where: { clave: "vision:web:day:2094-07-30" },
              })
            ).cantidad,
            2,
          );
          assert.equal(
            (
              await db.usageCounter.findUnique({
                where: { clave: "vision:web:month:2094-07" },
              })
            ).cantidad,
            2,
          );
        },
      );
      await t.test(
        "Una nueva instancia hereda el mes y las ventanas UTC se reinician",
        async () => {
          await db.$disconnect();
          const replica = new PrismaClient({
            datasources: { db: { url: connection } },
          });
          try {
            assert.equal(
              await reserveImageWebRequest(replica, nextDay, limits),
              true,
            );
            assert.equal(
              await reserveImageWebRequest(replica, nextDay, limits),
              false,
            );
            assert.equal(
              (
                await replica.usageCounter.findUnique({
                  where: { clave: "vision:web:day:2094-07-31" },
                })
              ).cantidad,
              1,
            );
            assert.equal(
              await reserveImageWebRequest(replica, nextMonth, limits),
              true,
            );
            assert.equal(
              await replica.usageCounter.count({
                where: { clave: { startsWith: "ai:", contains: ":2094-" } },
              }),
              0,
            );
          } finally {
            await replica.$disconnect();
          }
        },
      );
    } finally {
      await db.usageCounter.deleteMany({ where: scopedWhere });
      await db.$disconnect();
    }
  },
);
