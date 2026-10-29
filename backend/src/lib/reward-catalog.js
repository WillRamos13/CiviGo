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
      descripcion: `Solicitud de gift card ${name} por S/${value}. Entrega manual sujeta a confirmación de administración. No acredita afiliación con la marca.`,
      costoMonedas: value * 10,
      stock: value===20?10:value===50?5:value===100?3:2,
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
async function refreshGiftCardDefaults(db){
 return db.$transaction(async tx=>{
  const marker=await tx.appConfig.findUnique({where:{clave:'gift-catalog:v2'}});if(marker?.valor?.preparado)return 0;
  let changed=0;for(const card of giftCards()){
   const row=await tx.reward.findFirst({where:{nombre:card.nombre,demo:true}});
   if(row&&row.costoMonedas===(card.valorSoles||Number(card.nombre.match(/S\/(\d+)/)[1]))*100&&row.stock===0&&await tx.redemption.count({where:{recompensaId:row.id}})===0){await tx.reward.update({where:{id:row.id},data:{costoMonedas:card.costoMonedas,stock:card.stock,descripcion:card.descripcion}});changed++;}
  }
  await tx.appConfig.upsert({where:{clave:'gift-catalog:v2'},create:{clave:'gift-catalog:v2',valor:{preparado:true}},update:{valor:{preparado:true}}});return changed;
 },{isolationLevel:'Serializable',timeout:30000});
}
module.exports = { giftCards, presentReward, seedGiftCards,refreshGiftCardDefaults };
