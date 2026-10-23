import "server-only";
import { z } from "zod";

export const databaseEnv = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
}).parse(process.env);
