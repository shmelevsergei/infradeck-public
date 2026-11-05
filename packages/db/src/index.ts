import "dotenv/config";
import { PrismaClient } from "../generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { infradeckDb?: PrismaClient };
export const db =
  globalDb.infradeckDb ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString:
        process.env.DATABASE_URL ??
        "postgresql://infradeck:unset@localhost:5432/infradeck",
    }),
  });
if (process.env.NODE_ENV !== "production") globalDb.infradeckDb = db;
export { Prisma } from "../generated/client";
