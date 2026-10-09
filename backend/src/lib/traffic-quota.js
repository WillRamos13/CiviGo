"use strict";
// These are application ceilings, not a claim about account-wide remaining
// credit. Lower them when the same TomTom account is used by another app/key.
// https://docs.tomtom.com/pricing (verified 2026-10-08)
const FREE_LIMITS = Object.freeze({
  routing: 20000,
  incidents: 2500,
  tiles: 200000,
  search: 2500,
});
const ENV_LIMITS = {
  routing: "TOMTOM_MONTHLY_ROUTING_LIMIT",
  incidents: "TOMTOM_MONTHLY_INCIDENTS_LIMIT",
  tiles: "TOMTOM_MONTHLY_TILES_LIMIT",
  search: "TOMTOM_MONTHLY_SEARCH_LIMIT",
};
function limits(env = process.env) {
  return Object.fromEntries(
    Object.entries(FREE_LIMITS).map(([product, maximum]) => {
      const raw = env[ENV_LIMITS[product]];
      const value = raw === undefined ? maximum : Number(raw);
      return [
        product,
        Number.isInteger(value) && value >= 0 ? Math.min(value, maximum) : 0,
      ];
    }),
  );
}
function createDatabaseQuota(db, env = process.env) {
  return {
    async reserve(product, now = new Date()) {
      const maximum = limits(env)[product];
      if (!maximum) return false;
      const month = now.toISOString().slice(0, 7);
      // One atomic reservation shared by workers and surviving restarts.
      // Failed provider requests remain counted; they may have been billed.
      const result = await db.$queryRaw`
        INSERT INTO "ExternalApiUsage" ("proveedor","producto","mes","usadas","actualizadoEn")
        VALUES ('TOMTOM',${product},${month},1,${now})
        ON CONFLICT ("proveedor","producto","mes") DO UPDATE
        SET "usadas" = "ExternalApiUsage"."usadas" + 1, "actualizadoEn" = ${now}
        WHERE "ExternalApiUsage"."usadas" < ${maximum}
        RETURNING "usadas"`;
      return result.length === 1;
    },
    async status(now = new Date()) {
      const rows = await db.externalApiUsage.findMany({
        where: { proveedor: "TOMTOM", mes: now.toISOString().slice(0, 7) },
      });
      const ceilings = limits(env);
      return Object.fromEntries(
        Object.entries(ceilings).map(([product, maximum]) => {
          const used =
            rows.find((row) => row.producto === product)?.usadas || 0;
          return [
            product,
            {
              limite: maximum,
              usadas: used,
              restantes: Math.max(0, maximum - used),
            },
          ];
        }),
      );
    },
  };
}
module.exports = { FREE_LIMITS, limits, createDatabaseQuota };
