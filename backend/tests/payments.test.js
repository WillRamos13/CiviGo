const test = require("node:test"),
  assert = require("node:assert/strict"),
  { createHmac } = require("node:crypto");
const {
  verifyPaymentWebhook,
  premiumEnd,
  checkoutUrl,
  settings,
  createPaymentService,
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
test("a real seller cannot be used for a supposedly free test checkout", async () => {
  const service = createPaymentService({
    db: {},
    env: {
      PAYMENTS_ENABLED: "true",
      PAYMENTS_MODE: "test",
      MERCADOPAGO_ACCESS_TOKEN: "fixture",
      MERCADOPAGO_WEBHOOK_SECRET: "fixture",
      PUBLIC_APP_URL: "https://civigo.online",
      PUBLIC_API_URL: "https://api.example.invalid",
    },
    request: async () => ({
      ok: true,
      json: async () => ({ tags: ["normal"] }),
    }),
  });
  await assert.rejects(
    () =>
      service.checkout(
        { id: 1, correo: "private@example.invalid" },
        "12345678-1234-1234-1234-123456789012",
      ),
    (error) => error.code === "PAYMENT_TEST_SELLER_REQUIRED",
  );
});
test('a test seller cannot receive a production checkout or create a Premium order',async()=>{
 const service=createPaymentService({db:{},env:{PAYMENTS_ENABLED:'true',PAYMENTS_MODE:'production',MERCADOPAGO_ACCESS_TOKEN:'fixture',MERCADOPAGO_WEBHOOK_SECRET:'fixture',PUBLIC_APP_URL:'https://civigo.online',PUBLIC_API_URL:'https://api.example.invalid'},request:async()=>({ok:true,json:async()=>({tags:['test_user']})})});
 await assert.rejects(()=>service.checkout({id:1},'12345678-1234-1234-1234-123456789012'),error=>error.code==='PAYMENT_PRODUCTION_SELLER_REQUIRED');
});
test('an old checkout cannot silently keep a previous price after the catalog changes',async()=>{
 const service=createPaymentService({request:async()=>({ok:true,json:async()=>({tags:['normal']})}),env:{PAYMENTS_ENABLED:'true',PAYMENTS_MODE:'production',MERCADOPAGO_ACCESS_TOKEN:'fixture',MERCADOPAGO_WEBHOOK_SECRET:'fixture',PUBLIC_APP_URL:'https://civigo.online',PUBLIC_API_URL:'https://api.example.invalid'},db:{appConfig:{findUnique:async()=>({valor:{checkout:'https://www.mercadopago.com/checkout/v1/redirect?pref_id=fixture',centimos:590,modo:'production'}})}}});
 await assert.rejects(()=>service.checkout({id:1},'12345678-1234-1234-1234-123456789012'),error=>error.code==='PAYMENT_PRICE_CHANGED');
});
test("official global checkout URLs are accepted; credentials, odd ports and lookalikes are rejected", () => {
  assert.equal(
    new URL(
      checkoutUrl(
        "https://www.mercadopago.com/checkout/v1/redirect?pref_id=fixture",
      ),
    ).hostname,
    "www.mercadopago.com",
  );
  for (const url of [
    "https://evil@www.mercadopago.com/",
    "https://www.mercadopago.com:444/",
    "https://www.mercadopago.com.attacker.invalid/",
  ])
    assert.throws(() => checkoutUrl(url));
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
  assert.equal(settings({}).price, 100);
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

test('un enlace de pago vencido exige preparar una compra nueva sin contactar al proveedor de cobros',async()=>{
 const current=Date.parse('2026-10-29T12:00:00Z'),calls=[];
 const service=createPaymentService({now:()=>current,request:async url=>{calls.push(url);return {ok:true,json:async()=>({tags:['normal']})};},env:{PAYMENTS_ENABLED:'true',PAYMENTS_MODE:'production',MERCADOPAGO_ACCESS_TOKEN:'fixture',MERCADOPAGO_WEBHOOK_SECRET:'fixture',PUBLIC_APP_URL:'https://civigo.online',PUBLIC_API_URL:'https://api.example.invalid'},db:{appConfig:{findUnique:async()=>({valor:{checkout:'https://www.mercadopago.com/checkout/v1/redirect?pref_id=fixture',centimos:100,modo:'production',creadoEn:'2026-10-29T11:00:00Z'}})}}});
 await assert.rejects(()=>service.checkout({id:1},'12345678-1234-1234-1234-123456789012'),error=>error.code==='PAYMENT_CHECKOUT_EXPIRED');
 assert.deepEqual(calls,['https://api.mercadopago.com/users/me']);
});
