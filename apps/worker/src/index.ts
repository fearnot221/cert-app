import { Queue, Worker } from "bullmq";
import { config } from "@cert/config";
import { db } from "@cert/domain";
import {
  processOutbox,
  closeJobResources,
} from "../../../packages/domain/src/jobs.js";
import { processAccountMail } from "../../../packages/domain/src/account-mail.js";
const url = new URL(config.REDIS_URL);
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  username: url.username ? decodeURIComponent(url.username) : undefined,
  password: url.password ? decodeURIComponent(url.password) : undefined,
  db: Number(url.pathname.slice(1) || 0),
  tls: url.protocol === "rediss:" ? {} : undefined,
  maxRetriesPerRequest: null,
};
const prefix = config.WORKER_QUEUE_PREFIX;
const queues = {
  account: new Queue("certificate-account", { connection, prefix }),
  pdf: new Queue("certificate-pdf", { connection, prefix }),
  mail: new Queue("certificate-mail", { connection, prefix }),
};
const workers = Object.entries(queues).map(
  ([kind, queue]) =>
    new Worker(
      queue.name,
      async (job) => {
        if (kind === "account") await processAccountMail(job.data.eventId);
        else await processOutbox(job.data.eventId, job.attemptsMade + 1);
      },
      {
        connection,
        prefix,
        concurrency: kind === "pdf" ? config.WORKER_CONCURRENCY : 1,
        limiter: kind !== "pdf" ? { max: 10, duration: 1000 } : undefined,
      },
    ),
);
for (const worker of workers)
  worker.on("error", (error) => console.error("worker error", error.name));
let stopping = false;
let dispatching = false;
async function dispatch() {
  if (stopping || dispatching) return;
  dispatching = true;
  try {
    const accountMails = await db.accountMail.findMany({
      where: { status: { in: ["queued", "sending"] } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    // Redis is a delivery mechanism. All unfinished durable records are reconciled repeatedly.
    const events = await db.outboxEvent.findMany({
      where: { completedAt: null },
      orderBy: { createdAt: "asc" },
      take: 1000,
    });
    for (const event of [
      ...events,
      ...accountMails.map((mail) => ({ id: mail.id, kind: "account" })),
    ]) {
      const queue = queues[event.kind as keyof typeof queues];
      if (!queue) continue;
      const existing = await queue.getJob(event.id);
      if (existing) {
        const state = await existing.getState();
        if (state === "failed" && Date.now() - existing.timestamp > 60000)
          await existing.retry();
        else if (state === "completed") await existing.remove();
        else continue;
      }
      await queue.add(
        event.kind,
        { eventId: event.id },
        {
          jobId: event.id,
          attempts: 3,
          backoff: { type: "exponential", delay: 3000 },
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 },
        },
      );
    }
  } catch (error) {
    console.error(
      "outbox dispatch failed",
      error instanceof Error ? error.name : "Error",
    );
  } finally {
    dispatching = false;
  }
}
await dispatch();
const timer = setInterval(dispatch, 2000);
timer.unref();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await closeJobResources();
  await db.$disconnect();
  process.exit(0);
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, shutdown);
console.log("Certificate worker ready; durable outbox reconciliation enabled");
