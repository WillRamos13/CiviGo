const { PrismaClient } = require("@prisma/client");
const { runtimeDatabaseUrl } = require("./database-url");
const url = runtimeDatabaseUrl();
// A small pool leaves room for Railway's previous replica, seed and migration.
// An explicitly configured positive connection_limit remains respected.
const prisma =
  globalThis.__civigoPrisma ||
  new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
if (process.env.NODE_ENV !== "production") globalThis.__civigoPrisma = prisma;
module.exports = prisma;
module.exports.prisma = prisma;
