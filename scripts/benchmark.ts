/** Real benchmark; does not fabricate metrics. Run against a dedicated test DB and worker. */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
const base = process.env.BENCHMARK_BASE_URL || "http://localhost:3001";
const count = Number(process.env.BENCHMARK_ROWS || 1000);
if (!Number.isInteger(count) || count < 1000)
  throw new Error("BENCHMARK_ROWS must be at least 1000");
if (process.env.ALLOW_BENCHMARK !== "yes")
  throw new Error(
    "Use isolated seeded DB and set ALLOW_BENCHMARK=yes. This generates real private PDFs, never sends mail.",
  );
let cookies = "";
let csrf = "";
async function call(path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookies,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.getSetCookie();
  if (set.length) {
    const jar = new Map(
      cookies
        .split("; ")
        .filter(Boolean)
        .map((v) => [v.split("=")[0], v]),
    );
    for (const v of set) {
      const pair = v.split(";")[0]!;
      jar.set(pair.split("=")[0]!, pair);
    }
    cookies = [...jar.values()].join("; ");
  }
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r;
}
csrf = (await (await call("/api/auth/csrf")).json()).csrfToken;
await call("/api/auth/login", {
  email: process.env.SEED_ADMIN_EMAIL || "admin@example.test",
  password: process.env.SEED_ADMIN_PASSWORD,
});
const me = await (await call("/api/auth/me")).json();
const org = me.memberships[0].organization.id;
const templates = await (
  await call(`/api/organizations/${org}/templates`)
).json();
const version = templates.items.find(
  (t: { versions: unknown[] }) => t.versions.length,
).versions[0].id;
const started = performance.now();
const batchIds: string[] = [];
for (let start = 0; start < count; start += 100) {
  const csv =
    "recipient_name,recipient_email\n" +
    Array.from(
      { length: Math.min(100, count - start) },
      (_, i) => `測試收件人${start + i},benchmark-${start + i}@example.test`,
    ).join("\n");
  const b = await (
    await call(`/api/organizations/${org}/batches`, {
      templateVersionId: version,
      eventName: `效能驗證 ${Date.now()} ${start}`,
      csv,
      idempotencyKey: crypto.randomUUID(),
    })
  ).json();
  const detail = await (
    await call(`/api/organizations/${org}/batches/${b.id}`)
  ).json();
  await call(`/api/organizations/${org}/batches/${b.id}/preview`, {
    rowId: detail.rows[0].id,
  });
  await call(`/api/organizations/${org}/batches/${b.id}/generate`, {});
  batchIds.push(b.id);
}
let success = 0,
  failed = 0;
for (;;) {
  success = 0;
  failed = 0;
  for (const id of batchIds) {
    const b = await (
      await call(`/api/organizations/${org}/batches/${id}`)
    ).json();
    success += b.rows.filter(
      (r: { status: string }) => r.status === "success",
    ).length;
    failed += b.rows.filter(
      (r: { status: string }) => r.status === "failed",
    ).length;
  }
  if (success + failed === count) break;
  await new Promise((r) => setTimeout(r, 2000));
}
const result = {
  rows: count,
  success,
  failed,
  failureRate: failed / count,
  elapsedSeconds: (performance.now() - started) / 1000,
  driverPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  workerMemory:
    "Measure separately with docker stats; driver RSS is not worker RSS",
  batchIds,
  recovery:
    "Run docker compose restart worker mid-run; record restart times separately",
  recordedAt: new Date().toISOString(),
};
await writeFile(
  ".runtime/benchmark-result.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
