const test = require("node:test"),
  assert = require("node:assert/strict"),
  { createHmac } = require("node:crypto");
const {
  verifyPaymentWebhook,
  premiumEnd,
  checkoutUrl,
  settings,
} = require("../src/lib/payments");
test("Webhook signatures bind payment id and request id and reject expired or tampered signatures", () => {
  const now = Date.now(),
    ts = String(Math.floor(now / 1000)),
    key = "test-only-signature-key",
    id = "12345",
    requestId = "request-123";
  const signature = createHmac("sha256", key)
    .update(`id:${id};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  const headers = {
    "x-request-id": requestId,
    "x-signature": `ts=${ts},v1=${signature}`,
  };
  assert.equal(verifyPaymentWebhook(headers, id, key, now), true);
  assert.equal(verifyPaymentWebhook(headers, "999", key, now), false);
  assert.equal(
    verifyPaymentWebhook({ ...headers, "x-request-id": "other" }, id, key, now),
    false,
  );
  assert.equal(verifyPaymentWebhook(headers, id, key, now + 6 * 60000), false);
  assert.equal(
    verifyPaymentWebhook(
      { ...headers, "x-signature": `ts=${ts},v1=bad` },
      id,
      key,
      now,
    ),
    false,
  );
});
test("Only production approved grants extend Premium; refunds, trials and repeated notifications do not create benefits", () => {
  const first = {
    referencia: "a",
    aprobadoEn: "2026-10-01T12:00:00Z",
    dias: 30,
    estado: "approved",
    modo: "production",
  };
  assert.equal(premiumEnd([first]), Date.parse("2026-10-31T12:00:00Z"));
  assert.equal(premiumEnd([{ ...first, estado: "refunded" }]), 0);
  assert.equal(premiumEnd([{ ...first, modo: "test" }]), 0);
  assert.equal(
    premiumEnd([
      first,
      { ...first, referencia: "b", aprobadoEn: "2026-10-15T12:00:00Z" },
    ]),
    Date.parse("2026-11-30T12:00:00Z"),
  );
});
test("Checkout is disabled without explicit configuration and never sends users to arbitrary URLs", () => {
  assert.equal(settings({}).enabled, false);
  assert.equal(settings({}).price, 590);
  assert.throws(() => settings({ PREMIUM_PRICE_PEN_CENTS: "-10" }));
  assert.match(
    checkoutUrl(
      "https://sandbox.mercadopago.com.pe/checkout/v1/redirect?pref_id=1",
    ),
    /^https:/,
  );
  for (const value of [
    "http://www.mercadopago.com.pe/",
    "https://mercadopago.com.pe.evil.invalid/",
    "javascript:alert(1)",
  ])
    assert.throws(() => checkoutUrl(value));
});
