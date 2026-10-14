import Fastify, { LogController } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { ZodError } from "zod";
import { config } from "@cert/config";
import { registerAuth, hashToken } from "./auth.js";
import { registerRoutes } from "./routes.js";
import { apiDocumentation } from "./openapi.js";
export async function buildApp() {
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            redact: [
              "req.headers.cookie",
              "req.headers.authorization",
              "req.body",
              "res.headers.set-cookie",
            ],
          },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      // Account endpoints retain per-IP limits; signed workspace sessions do not compete behind a shared NAT.
      if (req.routeOptions.url?.startsWith("/api/auth/")) return req.ip;
      const signed = req.cookies.session
        ? req.unsignCookie(req.cookies.session)
        : null;
      return signed?.valid && signed.value
        ? `session:${hashToken(signed.value)}`
        : req.ip;
    },
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: "操作過於頻繁，請稍後再試。",
    }),
  });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
  });
  await app.register(swagger, {
    transform: apiDocumentation,
    openapi: {
      info: { title: "Cert App Phase 1 API", version: "0.1.0" },
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: "session" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        message: "輸入格式不正確",
        issues: error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    const e = error as Error & { statusCode?: number; code?: string };
    if (e.code === "P2002")
      return reply.code(409).send({ message: "這筆操作已存在，請重新整理" });
    if (e.code === "P2025")
      return reply.code(404).send({ message: "找不到資料" });
    if (e.statusCode && e.statusCode < 500)
      return reply.code(e.statusCode).send({ message: e.message });
    app.log.error({ code: e.code, errorName: e.name }, "Request failed");
    return reply.code(500).send({ message: "伺服器暫時無法處理，請重試" });
  });
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
  });
  await registerAuth(app);
  await registerRoutes(app);
  app.get("/api/openapi.json", async () => app.swagger());
  return app;
}
