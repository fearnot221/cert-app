import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Production runs Caddy -> nginx -> api on private Docker addresses; set before config is parsed.
process.env.TRUST_PROXY = "loopback,uniquelocal";
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

const lookup = (forwardedFor: string, remoteAddress = "172.18.0.4") =>
  app.inject({
    method: "GET",
    url: "/api/public/serials?serial=NO-SUCH-SERIAL",
    remoteAddress,
    headers: { "x-forwarded-for": forwardedFor },
  });

describe("behind the production proxies", () => {
  it("rate-limits each visitor separately instead of the whole site", async () => {
    // A visitor's own forged entry on the left is ignored; the proxy-appended address counts.
    const first = "forged, 203.0.113.7, 172.18.0.3";
    for (let i = 0; i < 60; i += 1) expect((await lookup(first)).statusCode).toBe(404);
    expect((await lookup(first)).statusCode).toBe(429);
    expect((await lookup("forged-again, 203.0.113.7, 172.18.0.3")).statusCode).toBe(429);
    expect((await lookup("198.51.100.9, 172.18.0.3")).statusCode).toBe(404);
  });

  it("does not trust forwarded addresses from a public peer", async () => {
    const direct = (spoofed: string) => lookup(spoofed, "192.0.2.50");
    for (let i = 0; i < 60; i += 1) expect((await direct(`198.18.0.${i}`)).statusCode).toBe(404);
    expect((await direct("198.18.1.1")).statusCode).toBe(429);
  });
});
