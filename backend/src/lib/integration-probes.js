"use strict";
const { settings } = require("./payments");
function createIntegrationProbes({
  db,
  env = process.env,
  request = fetch,
  now = Date.now,
}) {
  let cache = null,
    pending = null;
  async function run() {
    if (cache && cache.until > now()) return cache.data;
    if (pending) return pending;
    pending = (async () => {
      const rows = [];
      if (env.MERCADOPAGO_ACCESS_TOKEN) {
        try {
          const r = await request("https://api.mercadopago.com/users/me", {
            headers: {
              Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
            },
            signal: AbortSignal.timeout(10000),
          });
          if (!r.ok)
            rows.push({
              provider: "Mercado Pago",
              ok: false,
              message: `Credencial rechazada (HTTP ${r.status}).`,
            });
          else {
            const seller = await r.json(),
              test =
                Array.isArray(seller.tags) && seller.tags.includes("test_user"),
              mode = settings(env).mode;
            rows.push({
              provider: "Mercado Pago",
              ok: mode === "test" ? test : !test,
              message:
                mode === "test"
                  ? test
                    ? "Vendedor de prueba confirmado."
                    : "La credencial pertenece a una cuenta real. Configura el vendedor de prueba para probar sin cobros."
                  : test
                    ? "El entorno de producción tiene credenciales de una cuenta de prueba."
                    : "Cuenta real confirmada para producción.",
            });
          }
        } catch {
          rows.push({
            provider: "Mercado Pago",
            ok: false,
            message: "No se pudo consultar al proveedor.",
          });
        }
      } else
        rows.push({
          provider: "Mercado Pago",
          ok: false,
          message: "Falta MERCADOPAGO_ACCESS_TOKEN.",
        });
      if (env.FOURSQUARE_ENABLED === "true" && env.FOURSQUARE_SERVICE_KEY) {
        try {
          const clave = `places:foursquare:${new Date(now()).toISOString().slice(0, 10)}`,
            limit = Number(env.FOURSQUARE_DAILY_REQUEST_LIMIT || 200);
          await db.usageCounter.upsert({
            where: { clave },
            create: {
              clave,
              cantidad: 0,
              expiresAt: new Date(now() + 2 * 86400000),
            },
            update: {},
          });
          const reserved =
            Number.isSafeInteger(limit) &&
            limit > 0 &&
            (await db.usageCounter.updateMany({
              where: { clave, cantidad: { lt: limit } },
              data: { cantidad: { increment: 1 } },
            }));
          if (!reserved?.count)
            rows.push({
              provider: "Foursquare",
              ok: false,
              message: "Cuota local de consultas agotada o inválida.",
            });
          else {
            const r = await request(
              "https://places-api.foursquare.com/places/search?ll=-14.0678,-75.7286&radius=1000&limit=1&fields=fsq_place_id,name,latitude,longitude",
              {
                headers: {
                  Authorization: `Bearer ${env.FOURSQUARE_SERVICE_KEY}`,
                  "X-Places-Api-Version": "2025-06-17",
                  accept: "application/json",
                },
                signal: AbortSignal.timeout(10000),
              },
            );
            rows.push({
              provider: "Foursquare",
              ok: r.ok,
              message: r.ok
                ? "La clave responde a búsquedas. Fotos, reseñas y horarios dependen de cobertura y permisos del plan."
                : `El proveedor rechazó la búsqueda (HTTP ${r.status}). Revisa la Service API Key y sus permisos.`,
            });
          }
        } catch {
          rows.push({
            provider: "Foursquare",
            ok: false,
            message: "No se pudo consultar al proveedor.",
          });
        }
      } else
        rows.push({
          provider: "Foursquare",
          ok: false,
          message:
            "Configura FOURSQUARE_SERVICE_KEY y FOURSQUARE_ENABLED=true.",
        });
      const data = {
        checkedAt: new Date(now()).toISOString(),
        providers: rows,
      };
      cache = { until: now() + 300000, data };
      return data;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  return { run };
}
module.exports = { createIntegrationProbes };
