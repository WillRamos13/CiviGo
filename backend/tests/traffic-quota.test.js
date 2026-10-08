"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createDatabaseQuota } = require("../src/lib/traffic-quota");
test("PostgreSQL cuota es persistente, atómica entre clientes y se reinicia por mes", async () => {
  const { PGlite } = require("@electric-sql/pglite");
  const pg = new PGlite();
  try {
    await pg.exec(
      'CREATE TABLE "ExternalApiUsage" ("id" SERIAL PRIMARY KEY,"proveedor" TEXT,"producto" TEXT,"mes" TEXT,"usadas" INTEGER,"actualizadoEn" TIMESTAMP,UNIQUE("proveedor","producto","mes"));',
    );
    const db = {
      $queryRaw: async (parts, ...values) => {
        let sql = parts[0];
        values.forEach((value, index) => {
          sql += `$${index + 1}${parts[index + 1]}`;
        });
        return (await pg.query(sql, values)).rows;
      },
      externalApiUsage: {
        findMany: async ({ where }) =>
          (
            await pg.query(
              'SELECT * FROM "ExternalApiUsage" WHERE "proveedor"=$1 AND "mes"=$2',
              [where.proveedor, where.mes],
            )
          ).rows,
      },
    };
    const env = { TOMTOM_MONTHLY_ROUTING_LIMIT: "5" };
    const first = createDatabaseQuota(db, env),
      second = createDatabaseQuota(db, env);
    const october = new Date("2026-10-08");
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? first : second).reserve("routing", october),
      ),
    );
    assert.equal(attempts.filter(Boolean).length, 5);
    assert.equal((await first.status(october)).routing.usadas, 5);
    assert.equal(
      await createDatabaseQuota(db, env).reserve("routing", october),
      false,
    );
    assert.equal(await second.reserve("routing", new Date("2026-11-01")), true);
    assert.equal(
      (await first.status(new Date("2026-11-01"))).routing.usadas,
      1,
    );
  } finally {
    await pg.close();
  }
});
