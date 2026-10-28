"use strict";
const BRANDS = [
  ["Tottus", "tottus"],
  ["Ripley", "ripley"],
  ["UTP", "utp"],
  ["OXXO", "oxxo"],
];
function giftCards() {
  return BRANDS.flatMap(([name, slug]) =>
    [20, 50, 100, 200].map((value) => ({
      nombre: `Gift card ${name} · S/${value}`,
      descripcion: `Tarjeta ilustrativa de ${name} por S/${value}. Catálogo de demostración: no es un vale emitido por la marca, no acredita afiliación y no garantiza entrega.`,
      costoMonedas: value * 100,
      stock: 0,
      activo: true,
      demo: true,
      slug,
    })),
  );
}
function presentReward(row) {
  const brand = BRANDS.find(([name]) =>
    row.nombre.toLowerCase().includes(name.toLowerCase()),
  );
  const amount = row.nombre.match(/S\/\s*(\d+(?:[.,]\d{1,2})?)/i);
  return {
    ...row,
    imagen: `/rewards/${brand ? brand[1] : "civigo"}.svg`,
    marca: brand?.[0] || "CiviGo",
    valorSoles: amount ? Number(amount[1].replace(",", ".")) : null,
  };
}
async function seedGiftCards(db) {
  await db.appConfig.upsert({
    where: { clave: "gift-catalog:v1" },
    create: { clave: "gift-catalog:v1", valor: { preparado: false } },
    update: {},
  });
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT clave FROM "AppConfig" WHERE clave = 'gift-catalog:v1' FOR UPDATE`;
      const marker = await tx.appConfig.findUnique({
        where: { clave: "gift-catalog:v1" },
      });
      if (marker.valor.preparado) return 0;
      let count = 0;
      for (const { slug, ...card } of giftCards()) {
        if (!(await tx.reward.findFirst({ where: { nombre: card.nombre } }))) {
          await tx.reward.create({ data: card });
          count++;
        }
      }
      await tx.appConfig.update({
        where: { clave: "gift-catalog:v1" },
        data: {
          valor: {
            preparado: true,
            creadoEn: new Date().toISOString(),
            demostracion: true,
          },
        },
      });
      return count;
    },
    { timeout: 60000 },
  );
}
module.exports = { giftCards, presentReward, seedGiftCards };
