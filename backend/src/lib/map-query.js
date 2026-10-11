const { HttpError } = require("./http");
function mapQuery(query) {
  if (query.bbox === undefined) return null;
  const box =
    typeof query.bbox === "string" ? query.bbox.split(",").map(Number) : [];
  if (
    box.length !== 4 ||
    box.some((x) => !Number.isFinite(x)) ||
    box[0] < -180 ||
    box[2] > 180 ||
    box[1] < -90 ||
    box[3] > 90 ||
    box[0] >= box[2] ||
    box[1] >= box[3]
  )
    throw new HttpError(400, "El área del mapa no es válida.");
  let after;
  if (query.after !== undefined) {
    if (
      typeof query.after !== "string" ||
      !/^[1-9]\d*$/.test(query.after) ||
      !Number.isSafeInteger(Number(query.after)) ||
      Number(query.after) > 2147483647
    )
      throw new HttpError(400, "Cursor de incidentes inválido.");
    after = Number(query.after);
  }
  return {
    where: {
      longitud: { gte: box[0], lte: box[2] },
      latitud: { gte: box[1], lte: box[3] },
      ...(after ? { id: { lt: after } } : {}),
    },
    take: 250,
  };
}
module.exports = { mapQuery };
