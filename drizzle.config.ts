import { defineConfig } from "drizzle-kit";
import { z } from "zod";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = z.string().url().parse(process.env.MIGRATION_DATABASE_URL);
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
