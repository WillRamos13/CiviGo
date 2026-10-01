const { PrismaClient } = require("@prisma/client");
const prisma = globalThis.__civigoPrisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.__civigoPrisma = prisma;
module.exports = prisma;
module.exports.prisma = prisma;
