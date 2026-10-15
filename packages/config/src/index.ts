import { z } from "zod";
export const config = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().default(3001),
    APP_ORIGIN: z.url().default("http://localhost:5173"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default("redis://localhost:56379"),
    STORAGE_ROOT: z.string().default("./.runtime/storage"),
    SESSION_SECRET: z.string().min(32),
    MAIL_MODE: z.enum(["mailpit", "disabled"]).default("disabled"),
    SMTP_HOST: z.string().default("127.0.0.1"),
    SMTP_PORT: z.coerce.number().default(51025),
    WORKER_QUEUE_PREFIX: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default("bull"),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
    /// proxy-addr ranges whose X-Forwarded-For is trusted (e.g. "uniquelocal" for Docker networks); empty trusts none.
    TRUST_PROXY: z.string().default(""),
  })
  .parse(process.env);
if (
  config.NODE_ENV === "production" &&
  (config.MAIL_MODE !== "disabled" ||
    config.SESSION_SECRET.includes("replace-this"))
)
  throw new Error(
    "Production requires a private session secret and disabled mail until Phase3 verified SMTP is configured.",
  );
if (
  config.MAIL_MODE === "mailpit" &&
  !["127.0.0.1", "localhost", "mailpit"].includes(config.SMTP_HOST)
)
  throw new Error("Development mail must use the local Mailpit sink.");
