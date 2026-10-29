const test = require("node:test"),
  assert = require("node:assert/strict");
const { giftCards, presentReward } = require("../src/lib/reward-catalog");
test("gift card requests have PEN denominations, bounded stock and costs aligned with monthly coins; no voucher is automatically issued", () => {
  const cards = giftCards();
  assert.equal(cards.length, 16);
  for (const card of cards) {
    assert.ok(card.stock>=2&&card.stock<=10);
    assert.equal(card.costoMonedas,presentReward(card).valorSoles*10);
    assert.equal(card.demo, true);
    assert.match(card.descripcion, /Entrega manual sujeta a confirmación/);
    const dto = presentReward(card);
    assert.match(dto.imagen, /^\/rewards\/(tottus|ripley|utp|oxxo)\.svg$/);
    assert.ok([20, 50, 100, 200].includes(dto.valorSoles));
  }
  assert.equal(
    presentReward({ nombre: "Reconocimiento de la comunidad" }).imagen,
    "/rewards/civigo.svg",
  );
});
