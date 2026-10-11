const { HttpError, text } = require("./http");

function pagination(query, legacyLimit) {
  const paged = query.page !== undefined;
  const integer = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (
      typeof value !== "string" ||
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > max
    )
      throw new HttpError(400, "Página o límite inválido.");
    return Number(value);
  };
  const page = integer(query.page, 1, 1000000);
  const pageSize = integer(
    query.limit,
    paged ? 50 : legacyLimit,
    paged ? 100 : legacyLimit,
  );
  return {
    paged,
    page,
    pageSize,
    args: { skip: (page - 1) * pageSize, take: pageSize },
  };
}
function searchText(query) {
  return query.q === undefined ? "" : text(query.q, "Búsqueda", 160, 0);
}
function pageResult(items, total, paging) {
  return paging.paged
    ? {
        items,
        total,
        page: paging.page,
        pageSize: paging.pageSize,
        pages: Math.max(1, Math.ceil(total / paging.pageSize)),
      }
    : items;
}
module.exports = { pagination, searchText, pageResult };
