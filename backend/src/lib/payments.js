"use strict";
const { randomUUID, createHmac, timingSafeEqual } = require("node:crypto");
const { HttpError } = require("./http");
const DAY = 86400000;
function settings(env = process.env) {
  const price = Number(env.PREMIUM_PRICE_PEN_CENTS || 100);
  if (!Number.isSafeInteger(price) || price < 100 || price > 1000000)
    throw new Error("Precio Premium inválido.");
  return {
    price,
    days: 30,
    mode: env.PAYMENTS_MODE === "production" ? "production" : "test",
    enabled:
      env.PAYMENTS_ENABLED === "true" &&
      !!env.MERCADOPAGO_ACCESS_TOKEN &&
      !!env.MERCADOPAGO_WEBHOOK_SECRET,
  };
}
function premiumEnd(grants = []) {
  return grants
    .filter((g) => g.estado === "approved" && g.modo === "production")
    .sort(
      (a, b) =>
        Date.parse(a.aprobadoEn) - Date.parse(b.aprobadoEn) ||
        a.referencia.localeCompare(b.referencia),
    )
    .reduce(
      (end, g) => Math.max(end, Date.parse(g.aprobadoEn)) + g.dias * DAY,
      0,
    );
}
async function withPaidPremium(user, db, now = Date.now()) {
  if (!user || user.premium) return user;
  const ledger = await db.appConfig.findUnique({
    where: { clave: `premium:paid:${user.id}` },
  });
  const end = premiumEnd(ledger?.valor?.periodos || []);
  return end > now
    ? { ...user, premium: true, premiumHasta: new Date(end).toISOString() }
    : user;
}
function verifyPaymentWebhook(headers, paymentId, secret, now = Date.now()) {
  if (
    !secret ||
    !/^\d{1,24}$/.test(String(paymentId)) ||
    typeof headers["x-request-id"] !== "string" ||
    !/^[a-zA-Z0-9-]{1,200}$/.test(headers["x-request-id"])
  )
    return false;
  const parts = Object.fromEntries(
    String(headers["x-signature"] || "")
      .split(",")
      .map((s) => s.trim().split("=")),
  );
  if (
    !/^\d{10,13}$/.test(parts.ts || "") ||
    !/^([a-fA-F0-9]{64})$/.test(parts.v1 || "")
  )
    return false;
  const epoch = Number(parts.ts) * (parts.ts.length <= 10 ? 1000 : 1);
  if (Math.abs(now - epoch) > 5 * 60000) return false;
  const expected = createHmac("sha256", secret)
    .update(
      `id:${paymentId};request-id:${headers["x-request-id"]};ts:${parts.ts};`,
    )
    .digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, "hex"));
}
function publicOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(
      503,
      "Falta configurar la dirección pública de los pagos.",
      "PAYMENT_CONFIGURATION",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HttpError(
      503,
      "Configura direcciones HTTPS públicas para los pagos.",
      "PAYMENT_CONFIGURATION",
    );
  return url.origin;
}
function checkoutUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === "mercadopago.com.pe" ||
      url.hostname.endsWith(".mercadopago.com.pe") ||
      url.hostname === "mercadopago.com" ||
      url.hostname.endsWith(".mercadopago.com")
    )
  )
    throw new Error("Checkout no permitido.");
  return url.href;
}
function createPaymentService({
  db,
  env = process.env,
  request = fetch,
  transaction,
  now = Date.now,
} = {}) {
  let testSellerUntil = 0;
  const transact =
    transaction ||
    ((work) => db.$transaction(work, { isolationLevel: "Serializable" }));
  async function provider(path, options = {}) {
    let response;
    try {
      response = await request(`https://api.mercadopago.com${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new HttpError(
        503,
        "No se pudo conectar con Mercado Pago. Inténtalo más tarde.",
        "PAYMENT_PROVIDER",
      );
    }
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? "PAYMENT_CREDENTIALS"
          : "PAYMENT_PROVIDER";
      // Provider payloads may contain private account data. Log only the status.
      console.warn(
        "[CiviGo pagos]",
        JSON.stringify({ estado: response.status, codigo: code }),
      );
      throw new HttpError(
        503,
        code === "PAYMENT_CREDENTIALS"
          ? "Mercado Pago rechazó la configuración. Comunícalo al administrador."
          : "Mercado Pago no pudo preparar el pago. Inténtalo más tarde.",
        code,
      );
    }
    return response.json();
  }
  async function checkout(user, key) {
    const config = settings(env);
    if (!config.enabled)
      throw new HttpError(503, "Los pagos todavía no están habilitados.");
    if (!/^[a-fA-F0-9-]{36}$/.test(key || ""))
      throw new HttpError(400, "Identificador de compra inválido.");
    const app = publicOrigin(env.PUBLIC_APP_URL),
      api = publicOrigin(env.PUBLIC_API_URL);
    if (config.mode === "test" && now() >= testSellerUntil) {
      const seller = await provider("/users/me");
      if (!Array.isArray(seller.tags) || !seller.tags.includes("test_user"))
        throw new HttpError(
          503,
          "La prueba requiere las credenciales de la cuenta vendedor de prueba de Mercado Pago.",
          "PAYMENT_TEST_SELLER_REQUIRED",
        );
      testSellerUntil = now() + 300000;
    }
    const ledgerKey = `payments:order:${user.id}:${key}`;
    let existing = await db.appConfig.findUnique({
      where: { clave: ledgerKey },
    });
    if (existing?.valor?.checkout && (existing.valor.centimos!==config.price || existing.valor.modo!==config.mode))
      throw new HttpError(409,"El precio o el entorno de pago cambió. Vuelve a iniciar la compra.","PAYMENT_PRICE_CHANGED");
    if (existing?.valor?.checkout)
      return {
        referencia: existing.valor.referencia,
        url: checkoutUrl(existing.valor.checkout),
      };
    if (existing)
      throw new HttpError(
        409,
        "Esta compra ya se está procesando. Consulta su estado antes de repetirla.",
      );
    const reference = randomUUID(),
      createdAt = new Date(now()).toISOString();
    const order = {
      referencia: reference,
      usuarioId: user.id,
      centimos: config.price,
      moneda: "PEN",
      dias: config.days,
      estado: "CREANDO",
      creadoEn: createdAt,
      modo: config.mode,
    };
    await transact(async (tx) => {
      const hour = new Date(now()).toISOString().slice(0, 13),
        quotaKey = `payments:checkout:${user.id}:${hour}`;
      await tx.usageCounter.upsert({
        where: { clave: quotaKey },
        create: {
          clave: quotaKey,
          cantidad: 0,
          expiresAt: new Date(now() + 2 * 3600000),
        },
        update: {},
      });
      const reserved = await tx.usageCounter.updateMany({
        where: { clave: quotaKey, cantidad: { lt: 10 } },
        data: { cantidad: { increment: 1 } },
      });
      if (!reserved.count)
        throw new HttpError(
          429,
          "Has iniciado varias compras. Consulta su estado antes de volver a intentarlo.",
        );
      await tx.appConfig.create({ data: { clave: ledgerKey, valor: order } });
      await tx.appConfig.create({
        data: {
          clave: `payments:ref:${reference}`,
          valor: { clave: ledgerKey, usuarioId: user.id },
        },
      });
    });
    try {
      const preference = await provider("/checkout/preferences", {
        method: "POST",
        headers: { "X-Idempotency-Key": key },
        body: JSON.stringify({
          items: [
            {
              id: "civigo-premium-30",
              title: "CiviGo Premium · 30 días",
              quantity: 1,
              currency_id: "PEN",
              unit_price: config.price / 100,
            },
          ],
          external_reference: reference,
          ...(config.mode === "production"
            ? { payer: { email: user.correo } }
            : {}),
          notification_url: `${api}/api/payments/webhook`,
          back_urls: {
            success: `${app}/premium?orden=${reference}`,
            pending: `${app}/premium?orden=${reference}`,
            failure: `${app}/premium?orden=${reference}`,
          },
          auto_return: "approved",
          expires: true,
          expiration_date_from: createdAt,
          expiration_date_to: new Date(now() + 30 * 60000).toISOString(),
        }),
      });
      // Checkout Pro uses init_point for both environments. The seller account,
      // not a sandbox redirect URL, determines whether this is a test payment.
      const url = checkoutUrl(preference.init_point);
      await db.appConfig.update({
        where: { clave: ledgerKey },
        data: {
          valor: {
            ...order,
            estado: "PENDIENTE",
            checkout: url,
            preferencia: String(preference.id),
          },
        },
      });
      return { referencia: reference, url };
    } catch (error) {
      await db.appConfig.update({
        where: { clave: ledgerKey },
        data: {
          valor: {
            ...order,
            estado: "ERROR",
            codigoError: /^PAYMENT_[A-Z_]+$/.test(error.code || "")
              ? error.code
              : "PAYMENT_CHECKOUT",
          },
        },
      });
      throw error;
    }
  }
  async function ownedOrder(reference, userId) {
    const link = await db.appConfig.findUnique({
      where: { clave: `payments:ref:${reference}` },
    });
    if (!link || link.valor.usuarioId !== userId)
      throw new HttpError(404, "Compra no encontrada.");
    const order = await db.appConfig.findUnique({
      where: { clave: link.valor.clave },
    });
    return {
      referencia: reference,
      estado: order.valor.estado,
      centimos: order.valor.centimos,
      moneda: "PEN",
      dias: order.valor.dias,
      modo: order.valor.modo,
    };
  }
  async function reconcile(
    paymentId,
    ownerId = null,
    expectedReference = null,
  ) {
    if (!/^\d{1,24}$/.test(String(paymentId)))
      throw new HttpError(400, "Pago inválido.");
    const config = settings(env);
    if (!config.enabled) throw new HttpError(503, "Pagos no habilitados.");
    const payment = await provider(`/v1/payments/${paymentId}`);
    if (
      String(payment.id) !== String(paymentId) ||
      typeof payment.external_reference !== "string"
    )
      throw new HttpError(400, "Referencia de pago inválida.");
    if (
      expectedReference !== null &&
      payment.external_reference !== expectedReference
    )
      throw new HttpError(400, "El pago pertenece a otra compra.");
    const ref = await db.appConfig.findUnique({
      where: { clave: `payments:ref:${payment.external_reference}` },
    });
    if (!ref || (ownerId !== null && ownerId !== ref.valor.usuarioId))
      throw new HttpError(404, "Compra no encontrada.");
    await transact(async (tx) => {
      await tx.$queryRaw`SELECT clave FROM "AppConfig" WHERE clave = ${ref.valor.clave} FOR UPDATE`;
      const entry = await tx.appConfig.findUnique({
          where: { clave: ref.valor.clave },
        }),
        order = entry.valor;
      if (
        payment.currency_id !== "PEN" ||
        !Number.isFinite(payment.transaction_amount) ||
        Math.abs(payment.transaction_amount * 100 - order.centimos) > 0.00001 ||
        payment.live_mode !== (order.modo === "production")
      )
        throw new HttpError(
          400,
          "El importe, la moneda o el entorno del pago no coinciden con la compra.",
        );
      if (order.pagoId && order.pagoId !== String(payment.id))
        throw new HttpError(
          409,
          "Esta compra ya tiene otro pago asociado; requiere revisión.",
        );
      const status = String(payment.status);
      if (
        ![
          "approved",
          "refunded",
          "charged_back",
          "pending",
          "in_process",
          "rejected",
          "cancelled",
        ].includes(status)
      )
        return;
      const entitlementKey = `premium:paid:${order.usuarioId}`;
      await tx.appConfig.upsert({
        where: { clave: entitlementKey },
        create: { clave: entitlementKey, valor: { periodos: [] } },
        update: {},
      });
      const entitlement = await tx.appConfig.findUnique({
        where: { clave: entitlementKey },
      });
      let grants = entitlement.valor.periodos || [];
      const approvedTime = Date.parse(payment.date_approved || "");
      if (status === "approved") {
        if (!Number.isFinite(approvedTime) || approvedTime > now() + 60000)
          throw new HttpError(400, "Fecha de aprobación inválida.");
        if (!grants.some((g) => g.referencia === order.referencia))
          grants = [
            ...grants,
            {
              referencia: order.referencia,
              pagoId: String(payment.id),
              aprobadoEn: new Date(approvedTime).toISOString(),
              dias: order.dias,
              estado: "approved",
              modo: order.modo,
            },
          ];
      } else if (["refunded", "charged_back"].includes(status))
        grants = grants.map((g) =>
          g.referencia === order.referencia ? { ...g, estado: status } : g,
        );
      // A late pending/rejected notification cannot undo an approved grant.
      const finalStatus =
        order.estado === "approved" &&
        !["approved", "refunded", "charged_back"].includes(status)
          ? order.estado
          : status;
      await tx.appConfig.update({
        where: { clave: entitlementKey },
        data: { valor: { periodos: grants } },
      });
      await tx.appConfig.update({
        where: { clave: ref.valor.clave },
        data: {
          valor: {
            ...order,
            estado: finalStatus,
            pagoId: String(payment.id),
            actualizadoEn: new Date(now()).toISOString(),
          },
        },
      });
      if (order.estado !== finalStatus)
        await tx.auditLog.create({
          data: {
            usuarioId: order.usuarioId,
            accion: "ACTUALIZAR_PAGO",
            entidad: "Payment",
            entidadId: order.referencia,
            datos: {
              estado: finalStatus,
              pagoId: String(payment.id),
              centimos: order.centimos,
              moneda: "PEN",
              modo: order.modo,
            },
          },
        });
    });
    return ownedOrder(payment.external_reference, ref.valor.usuarioId);
  }
  return {
    checkout,
    ownedOrder,
    reconcile,
    catalog: () => {
      const c = settings(env);
      return {
        habilitado: c.enabled,
        precioCentimos: c.price,
        moneda: "PEN",
        dias: c.days,
        modo: c.mode,
      };
    },
  };
}
module.exports = {
  settings,
  premiumEnd,
  withPaidPremium,
  verifyPaymentWebhook,
  checkoutUrl,
  createPaymentService,
};
