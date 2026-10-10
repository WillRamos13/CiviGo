import "dotenv/config";
import { defineConfig } from "prisma/config";
import { cliDatabaseUrl } from "./src/lib/database-url";

const url = cliDatabaseUrl(process.env, process.argv[2]);

export default defineConfig({
  schema: "./prisma/schema.prisma",
  ...(url ? { engine: "classic" as const, datasource: { url } } : {}),
});
