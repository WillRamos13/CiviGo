const test = require("node:test"),
  assert = require("node:assert/strict"),
  { createHmac, randomBytes, randomUUID } = require("node:crypto"),
  { once } = require("node:events");
const {
  createPaymentService,
  withPaidPremium,
  premiumEnd,
} = require("../src/lib/payments");
const connection = process.env.TEST_DATABASE_URL;
test(
  "Real database: payment ownership, exact amount, idempotent grant, refund and sandbox isolation",
  { skip: !connection },
  async () => {
    const url = new URL(connection);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(url.hostname),
      "Payments tests only use an isolated local database",
    );
    const { PrismaClient } = require("@prisma/client"),
      db = new PrismaClient({ datasourceUrl: connection });
    const uid = randomUUID();
    let user,
      reference,
      requests = 0,
      payment,
      clock = Date.now();
    const env = {
      PAYMENTS_ENABLED: "true",
      PAYMENTS_MODE: "production",
      PREMIUM_PRICE_PEN_CENTS: "590",
      MERCADOPAGO_ACCESS_TOKEN: "test-fixture",
      MERCADOPAGO_WEBHOOK_SECRET: "test-fixture",
      PUBLIC_APP_URL: "https://civigo.example",
      PUBLIC_API_URL: "https://api.civigo.example",
    };
    const request = async (url, options) => {
      requests++;
      if (url.endsWith("/users/me"))
        return {
          ok: true,
          json: async () => ({
            tags: options.headers.Authorization.includes("sandbox")
              ? ["test_user"]
              : ["normal"],
          }),
        };
      if (url.endsWith("/checkout/preferences")) {
        const body = JSON.parse(options.body);
        reference = body.external_reference;
        assert.equal(body.items[0].unit_price, 5.9);
        assert.equal(body.items[0].currency_id, "PEN");
        return {
          ok: true,
          json: async () => ({
            id: "fixture",
            init_point:
              "https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=fixture",
            sandbox_init_point:
              "https://sandbox.mercadopago.com.pe/checkout/v1/redirect?pref_id=fixture",
          }),
        };
      }
      return { ok: true, json: async () => payment };
    };
    const service = createPaymentService({
      db,
      env,
      request,
      now: () => clock,
    });
    try {
      user = await db.user.create({
        data: {
          nombreUsuario: "pay-" + uid,
          correo: uid + "@example.invalid",
          telefono: "pay-" + uid,
          password: "not-a-real-login",
          correoVerificado: true,
        },
      });
      const key = randomUUID(),
        checkout = await service.checkout(user, key);
      assert.equal(
        (await service.checkout(user, key)).referencia,
        checkout.referencia,
      );
      assert.equal(requests, 2);
      const orderReference = reference;
      await assert.rejects(
        () => service.ownedOrder(orderReference, user.id + 100000),
        /no encontrada/,
      );
      payment = {
        id: 12345,
        external_reference: orderReference,
        currency_id: "PEN",
        transaction_amount: 5.9,
        status: "approved",
        live_mode: true,
        date_approved: new Date(clock).toISOString(),
        date_last_updated: new Date(clock).toISOString(),
      };
      await assert.rejects(
        () => service.reconcile("12345", user.id + 100000),
        /no encontrada/,
      );
      payment.transaction_amount = 1;
      await assert.rejects(
        () => service.reconcile("12345", user.id),
        /importe/,
      );
      assert.equal(
        (await service.ownedOrder(orderReference, user.id)).estado,
        "PENDIENTE",
      );
      payment.transaction_amount = 5.9;
      payment.currency_id = "USD";
      await assert.rejects(
        () => service.reconcile("12345", user.id),
        /importe/,
      );
      payment.currency_id = "PEN";
      payment.id = 12344;
      payment.status = "rejected";
      await service.reconcile("12344", user.id);
      assert.equal(
        (await service.ownedOrder(orderReference, user.id)).estado,
        "rejected",
      );
      payment.id = 12345;
      payment.status = "approved";
      await service.reconcile("12345", user.id);
      await service.reconcile("12345", user.id);
      payment.id = 12344;
      payment.status = "cancelled";
      await service.reconcile("12344", user.id);
      assert.equal(
        (await service.ownedOrder(orderReference, user.id)).estado,
        "approved",
        "An old rejected attempt cannot overwrite a successful retry",
      );
      payment.id = 12345;
      payment.status = "approved";
      let ledger = await db.appConfig.findUnique({
        where: { clave: `premium:paid:${user.id}` },
      });
      assert.equal(ledger.valor.periodos.length, 1);
      assert.equal(premiumEnd(ledger.valor.periodos), clock + 30 * 86400000);
      assert.equal((await withPaidPremium(user, db, clock)).premium, true);
      assert.equal(
        (await db.user.findUnique({ where: { id: user.id } })).premium,
        false,
      );
      clock += 31 * 86400000;
      assert.equal((await withPaidPremium(user, db, clock)).premium, false);
      clock -= 31 * 86400000;
      const approval = { ...payment };
      payment = {
        ...approval,
        status: "charged_back",
        date_last_updated: new Date(clock + 1000).toISOString(),
      };
      await service.reconcile("12345", user.id);
      assert.equal((await withPaidPremium(user, db, clock)).premium, false);
      payment = { ...approval, date_last_updated: undefined };
      assert.equal(
        (await service.reconcile("12345", user.id)).estado,
        "charged_back",
      );
      assert.equal((await withPaidPremium(user, db, clock)).premium, false);
      payment = {
        ...approval,
        date_last_updated: new Date(clock + 2000).toISOString(),
      };
      await service.reconcile("12345", user.id);
      assert.equal((await withPaidPremium(user, db, clock)).premium, true);
      ledger = await db.appConfig.findUnique({
        where: { clave: `premium:paid:${user.id}` },
      });
      assert.equal(ledger.valor.periodos.length, 1);
      payment = {
        ...approval,
        status: "refunded",
        date_last_updated: new Date(clock + 3000).toISOString(),
      };
      await service.reconcile("12345", user.id);
      assert.equal((await withPaidPremium(user, db, clock)).premium, false);
      payment = approval;
      assert.equal(
        (await service.reconcile("12345", user.id)).estado,
        "refunded",
      );
      assert.equal(
        (await withPaidPremium({ ...user, premium: true }, db, clock)).premium,
        true,
        "Manual admin grants survive payment refunds",
      );
      const refundFirst = await service.checkout(user, randomUUID());
      payment = {
        ...approval,
        id: 12346,
        external_reference: refundFirst.referencia,
        status: "refunded",
        date_last_updated: new Date(clock + 3000).toISOString(),
      };
      await service.reconcile("12346", user.id);
      payment = {
        ...payment,
        status: "approved",
        date_last_updated: approval.date_last_updated,
      };
      assert.equal(
        (await service.reconcile("12346", user.id)).estado,
        "refunded",
      );
      payment = { ...payment, date_last_updated: undefined };
      assert.equal(
        (await service.reconcile("12346", user.id)).estado,
        "refunded",
      );
      assert.equal((await withPaidPremium(user, db, clock)).premium, false);
      const sandbox = createPaymentService({
        db,
        env: {
          ...env,
          PAYMENTS_MODE: "test",
          MERCADOPAGO_ACCESS_TOKEN: "sandbox-fixture",
        },
        request,
        now: () => clock,
      });
      const sandboxCheckout = await sandbox.checkout(user, randomUUID());
      assert.ok(
        !sandboxCheckout.url.includes("sandbox."),
        "Test seller uses the same official init_point redirect",
      );
      payment = {
        ...payment,
        id: 99999,
        external_reference: sandboxCheckout.referencia,
        status: "approved",
        live_mode: false,
      };
      await sandbox.reconcile("99999", user.id);
      assert.equal(
        (await withPaidPremium(user, db, clock)).premium,
        false,
        "Sandbox never grants real Premium",
      );
    } finally {
      if (user) {
        await db.auditLog.deleteMany({ where: { usuarioId: user.id } });
        await db.appConfig.deleteMany({
          where: {
            OR: [
              { clave: { startsWith: `payments:order:${user.id}:` } },
              { clave: `premium:paid:${user.id}` },
              {
                valor: { path: ["usuarioId"], equals: user.id },
                clave: { startsWith: "payments:ref:" },
              },
            ],
          },
        });
        await db.user.delete({ where: { id: user.id } });
      }
      await db.$disconnect();
    }
  },
);

test(
  "Premium HTTP checkout only activates after a signed and verified payment and revokes on refund",
  { skip: !connection },
  async (t) => {
    assert.ok(
      ["127.0.0.1", "localhost"].includes(new URL(connection).hostname),
    );
    require("./helpers/provider-environment").disableExternalProviders();
    const secret = "local-webhook-fixture";
    Object.assign(process.env, {
      NODE_ENV: "test",
      PAYMENTS_ENABLED: "true",
      PAYMENTS_MODE: "production",
      PREMIUM_PRICE_PEN_CENTS: "100",
      MERCADOPAGO_ACCESS_TOKEN: "local-seller-fixture",
      MERCADOPAGO_WEBHOOK_SECRET: secret,
      PUBLIC_APP_URL: "https://civigo.example",
      PUBLIC_API_URL: "https://api.civigo.example",
    });
    const { PrismaClient } = require("@prisma/client");
    const db = new PrismaClient({ datasourceUrl: connection });
    const previousDb = globalThis.__civigoPrisma;
    const localhostFetch = globalThis.fetch;
    globalThis.__civigoPrisma = db;
    let reference,
      payment,
      server,
      user,
      paymentLookups = 0;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      const { origin, pathname } = new URL(url);
      assert.equal(origin, "https://api.mercadopago.com");
      assert.equal(
        options.headers.Authorization,
        "Bearer local-seller-fixture",
      );
      if (pathname === "/users/me") return Response.json({ tags: ["normal"] });
      if (pathname === "/checkout/preferences") {
        const preference = JSON.parse(options.body);
        assert.equal(preference.items[0].unit_price, 1);
        assert.equal(preference.items[0].currency_id, "PEN");
        assert.equal(
          preference.notification_url,
          "https://api.civigo.example/api/payments/webhook",
        );
        reference = preference.external_reference;
        return Response.json({
          id: "checkout-http-fixture",
          init_point:
            "https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=local",
        });
      }
      assert.equal(pathname, "/v1/payments/123456");
      paymentLookups++;
      return Response.json(payment);
    });
    try {
      const { hashToken } = require("../src/lib/auth");
      const uid = randomUUID(),
        token = randomBytes(32).toString("hex");
      user = await db.user.create({
        data: {
          nombreUsuario: "payment-http-" + uid,
          correo: uid + "@example.invalid",
          telefono: "payment-http-" + uid,
          password: "not-a-real-login",
          correoVerificado: true,
        },
      });
      await db.session.create({
        data: {
          id: hashToken(token),
          usuarioId: user.id,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      server = require("../src/server").listen(0, "127.0.0.1");
      await once(server, "listening");
      const send = (path, options) =>
        localhostFetch(
          `http://127.0.0.1:${server.address().port}/api${path}`,
          options,
        );
      const auth = { Cookie: `civigo_session=${token}` };
      const checkout = await send("/payments/checkout", {
        method: "POST",
        headers: {
          ...auth,
          "Content-Type": "application/json",
          "X-Idempotency-Key": randomUUID(),
        },
        body: "{}",
      });
      assert.equal(checkout.status, 200);
      assert.equal((await checkout.json()).referencia, reference);
      const order = async () =>
        (await send(`/payments/orders/${reference}`, { headers: auth })).json();
      const premium = async () =>
        (await (await send("/users/me", { headers: auth })).json()).usuario
          .premium;
      assert.equal((await order()).estado, "PENDIENTE");
      assert.equal(await premium(), false);
      const paymentId = "123456",
        now = new Date().toISOString();
      payment = {
        id: Number(paymentId),
        external_reference: reference,
        currency_id: "PEN",
        transaction_amount: 1,
        status: "approved",
        live_mode: true,
        date_approved: now,
        date_last_updated: now,
      };
      const notify = async (signed) => {
        const requestId = randomUUID(),
          ts = String(Date.now());
        const signature = createHmac("sha256", signed ? secret : "otro-secreto")
          .update(`id:${paymentId};request-id:${requestId};ts:${ts};`)
          .digest("hex");
        return send(`/payments/webhook?data.id=${paymentId}&type=payment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-request-id": requestId,
            "x-signature": `ts=${ts},v1=${signature}`,
          },
          body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
        });
      };
      assert.equal((await notify(false)).status, 401);
      assert.equal(paymentLookups, 0);
      assert.equal((await notify(true)).status, 200);
      assert.equal(paymentLookups, 1);
      assert.equal((await order()).estado, "approved");
      assert.equal(await premium(), true);
      payment.status = "refunded";
      payment.date_last_updated = new Date().toISOString();
      assert.equal((await notify(true)).status, 200);
      assert.equal((await order()).estado, "refunded");
      assert.equal(await premium(), false);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      if (user) {
        await db.auditLog.deleteMany({ where: { usuarioId: user.id } });
        await db.appConfig.deleteMany({
          where: {
            OR: [
              { clave: { startsWith: `payments:order:${user.id}:` } },
              { clave: `premium:paid:${user.id}` },
              ...(reference ? [{ clave: `payments:ref:${reference}` }] : []),
            ],
          },
        });
        await db.user.delete({ where: { id: user.id } });
      }
      globalThis.__civigoPrisma = previousDb;
      await db.$disconnect();
    }
  },
);
