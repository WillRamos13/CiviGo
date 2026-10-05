const prisma = require("./db");
const { config } = require("./catalog");
const { HttpError } = require("./http");
function currentMonth(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
  })
    .format(date)
    .replace("/", "-");
}
function monthRange(value = currentMonth()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    throw new HttpError(400, "Mes inválido; utiliza AAAA-MM.");
  const [y, m] = value.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(y, m - 1, 1, 5)),
    lt: new Date(Date.UTC(y, m, 1, 5)),
  };
}
function calculateRanking(totals, premios) {
  let position = 1;
  const result = [];
  for (let i = 0; i < totals.length;) {
    let j = i + 1;
    while (j < totals.length && totals[j].puntos === totals[i].puntos) j++;
    const money =
      premios.slice(i, Math.min(j, 10)).reduce((s, v) => s + v, 0) / (j - i);
    for (let n = i; n < j; n++)
      result.push({ ...totals[n], position, monedasEstimadas: money });
    position = j + 1;
    i = j;
  }
  return result;
}
async function ranking(mes = currentMonth(), db = prisma) {
  const grouped = await db.pointEvent.groupBy({
    by: ["usuarioId"],
    where: { creadoEn: monthRange(mes) },
    _sum: { puntos: true },
    orderBy: { _sum: { puntos: "desc" } },
  });
  const users = await db.user.findMany({
    where: {
      id: { in: grouped.map((p) => p.usuarioId) },
      bloqueado: false,
      correoVerificado: true,
    },
    select: { id: true, nombreUsuario: true, reputacion: true },
  });
  const map = new Map(users.map((u) => [u.id, u]));
  const totals = grouped
    .filter((g) => map.has(g.usuarioId) && g._sum.puntos > 0)
    .map((g) => ({
      usuarioId: g.usuarioId,
      nickname: map.get(g.usuarioId).nombreUsuario,
      puntos: g._sum.puntos,
      credibilidad: map.get(g.usuarioId).reputacion,
    }));
  const rules = await config(db);
  const settled = await db.rankingSettlement.findUnique({ where: { id: mes } });
  if (settled) return { ...settled.datos, mes, finalized: true, demo: true };
  return {
    mes,
    entries: calculateRanking(totals, rules.premiosRanking),
    finalized: false,
    demo: true,
  };
}
module.exports = { ranking, currentMonth, monthRange, calculateRanking };
