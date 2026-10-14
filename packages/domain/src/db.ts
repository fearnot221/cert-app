import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "@cert/config";
export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
});
