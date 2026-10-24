import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseEnv } from "./env";

export const pool = new Pool({ connectionString: databaseEnv.DATABASE_URL, max: 5 });
export const db = drizzle(pool);
