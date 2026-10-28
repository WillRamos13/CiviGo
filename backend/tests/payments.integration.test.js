const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
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
      MERCADOPAGO_ACCESS_TOKEN: "test-fixture",
      MERCADOPAGO_WEBHOOK_SECRET: "test-fixture",
      PUBLIC_APP_URL: "https://civigo.example",
      PUBLIC_API_URL: "https://api.civigo.example",
    };
    const request = async (url, options) => {
      requests++;
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
      assert.equal(requests, 1);
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
      await service.reconcile("12345", user.id);
      await service.reconcile("12345", user.id);
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
      payment.status = "refunded";
      await service.reconcile("12345", user.id);
      assert.equal((await withPaidPremium(user, db, clock)).premium, false);
      assert.equal(
        (await withPaidPremium({ ...user, premium: true }, db, clock)).premium,
        true,
        "Manual admin grants survive payment refunds",
      );
      const sandbox = createPaymentService({
        db,
        env: { ...env, PAYMENTS_MODE: "test" },
        request,
        now: () => clock,
      });
      const sandboxCheckout = await sandbox.checkout(user, randomUUID());
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
