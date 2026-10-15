import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLOUDFLARE_IP_RANGES } from "../../packages/config/src/cloudflare.js";

describe("Cloudflare edge ranges", () => {
  it("match between the API and the Caddy config, so both trust the same proxies", () => {
    const caddyfile = readFileSync(new URL("../../deploy/Caddyfile", import.meta.url), "utf8");
    const caddy = /trusted_proxies static (.+)/.exec(caddyfile)![1]!.trim().split(/\s+/);
    expect(caddy).toEqual(CLOUDFLARE_IP_RANGES);
  });
});
