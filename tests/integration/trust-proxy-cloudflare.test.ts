import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// compose.cloudflare.yaml: Cloudflare -> Caddy -> nginx -> api.
process.env.TRUST_PROXY = "loopback,uniquelocal,cloudflare";
let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../../apps/api/src/server");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  const { db } = await import("@cert/domain");
  await db.$disconnect();
});

// What nginx hands the API: Cloudflare appends the visitor, Caddy the edge, nginx the Caddy container.
const lookup = (chain: string) =>
  app.inject({
    method: "GET",
    url: "/api/public/serials?serial=NO-SUCH-SERIAL",
    remoteAddress: "172.18.0.4",
    headers: { "x-forwarded-for": chain },
  });

describe("behind Cloudflare's proxy", () => {
  it("rate-limits each visitor, not each Cloudflare edge", async () => {
    const visitor = "forged, 203.0.113.7, 104.16.0.10, 172.18.0.3";
    for (let i = 0; i < 60; i += 1) expect((await lookup(visitor)).statusCode).toBe(404);
    expect((await lookup(visitor)).statusCode).toBe(429);
    // Same edge, different visitor.
    expect((await lookup("198.51.100.9, 104.16.0.10, 172.18.0.3")).statusCode).toBe(404);
  });
});
