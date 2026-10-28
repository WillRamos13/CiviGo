const test = require("node:test"),
  assert = require("node:assert/strict");
const { giftCards, presentReward } = require("../src/lib/reward-catalog");
test("gift cards have PEN denominations and individual images but cannot issue nonexistent vouchers", () => {
  const cards = giftCards();
  assert.equal(cards.length, 16);
  for (const card of cards) {
    assert.equal(card.stock, 0);
    assert.equal(card.demo, true);
    assert.match(card.descripcion, /no es un vale emitido/);
    const dto = presentReward(card);
    assert.match(dto.imagen, /^\/rewards\/(tottus|ripley|utp|oxxo)\.svg$/);
    assert.ok([20, 50, 100, 200].includes(dto.valorSoles));
  }
  assert.equal(
    presentReward({ nombre: "Reconocimiento de la comunidad" }).imagen,
    "/rewards/civigo.svg",
  );
});
