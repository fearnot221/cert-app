import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import { db } from "@cert/domain";
import { config } from "@cert/config";
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const options = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  signed: true,
};
export async function userFor(req: FastifyRequest) {
  const raw = req.cookies.session;
  const signed = raw ? req.unsignCookie(raw) : null;
  if (!signed?.valid || !signed.value) fail(401, "請先登入");
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(signed.value) },
    include: { user: true },
  });
  if (
    !session ||
    session.expiresAt < new Date() ||
    session.user.disabled ||
    !session.user.activatedAt
  )
    fail(401, "登入已逾期，請重新登入");
  return session.user;
}
export async function authorize(
  req: FastifyRequest,
  organizationId: string,
  permission: string,
) {
  const user = await userFor(req);
  const membership = await db.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    include: { role: true, organization: true },
  });
  if (
    !membership?.active ||
    !membership.organization.active ||
    !membership.role.permissions.includes(permission)
  )
    fail(403, "沒有此組織的操作權限");
  return { user, membership };
}
export async function audit(
  organizationId: string,
  actorId: string,
  action: string,
  resourceId?: string,
) {
  await db.auditLog.create({
    data: { organizationId, actorId, action, resourceId },
  });
}
async function sessionFor(
  reply: FastifyReply,
  userId: string,
  expectedHash: string,
) {
  const raw = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: userId } });
    if (!current || current.disabled || current.passwordHash !== expectedHash)
      fail(401, "帳號狀態已變更，請重新登入");
    await tx.session.create({
      data: {
        tokenHash: hashToken(raw),
        userId,
        expiresAt: new Date(Date.now() + 8 * 3600e3),
      },
    });
  });
  reply.setCookie("session", raw, { ...options, maxAge: 8 * 3600 });
}
export async function registerAuth(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== new URL(config.APP_ORIGIN).origin)
      fail(403, "來源不被允許");
    const raw = req.cookies.csrf;
    const verified = raw ? req.unsignCookie(raw) : null;
    const header = req.headers["x-csrf-token"];
    if (
      !verified?.valid ||
      typeof header !== "string" ||
      !verified.value ||
      !/^[a-f0-9]{64}$/.test(header) ||
      header.length !== verified.value.length ||
      !timingSafeEqual(Buffer.from(header), Buffer.from(verified.value))
    )
      fail(403, "安全驗證已逾期，請重新整理");
  });
  app.get("/api/auth/csrf", async (req, reply) => {
    const existing = req.cookies.csrf ? req.unsignCookie(req.cookies.csrf) : null;
    const csrfToken = existing?.valid && existing.value && /^[a-f0-9]{64}$/.test(existing.value) ? existing.value : randomBytes(32).toString("hex");
    reply.setCookie("csrf", csrfToken, options);
    return { csrfToken };
  });
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z
        .object({
          email: z.email().max(254),
          password: z.string().min(1).max(256),
        })
        .parse(req.body);
      const user = await db.user.findUnique({
        where: { email: body.email.toLowerCase() },
      });
      // Always perform Argon2 work, including for unknown identities.
      const ok = await argon2.verify(
        user?.passwordHash || (await dummyHash),
        body.password,
      );
      if (!ok || !user?.activatedAt || user.disabled)
        fail(401, "Email 或密碼不正確");
      await sessionFor(reply, user.id, user.passwordHash!);
      return { ok: true };
    },
  );
  app.get("/api/auth/me", async (req) => {
    const user = await userFor(req);
    const memberships = await db.membership.findMany({
      where: { userId: user.id, active: true, organization: { active: true } },
      include: { role: true, organization: true },
    });
    return {
      user: { id: user.id, email: user.email },
      memberships: memberships.map((m) => ({
        organization: { id: m.organization.id, name: m.organization.name, slug: m.organization.slug },
        role: m.role.name,
        permissions: m.role.permissions,
      })),
    };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const value = req.cookies.session
      ? req.unsignCookie(req.cookies.session).value
      : null;
    if (value)
      await db.session.deleteMany({ where: { tokenHash: hashToken(value) } });
    reply.clearCookie("session", options);
    return { ok: true };
  });
  for (const [route, purpose] of [
    ["resend-activation", "activation"],
    ["forgot-password", "reset"],
  ] as const) {
    app.post(
      `/api/auth/${route}`,
      { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
      async (req) => {
        const { email } = z
          .object({ email: z.email().max(254) })
          .parse(req.body);
        await db.$transaction(async (tx) => {
          const user = await tx.user.findUnique({
            where: { email: email.toLowerCase() },
          });
          if (!user) return;
          await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
          const current = await tx.user.findUniqueOrThrow({
            where: { id: user.id },
          });
          if (
            current.disabled ||
            (purpose === "activation"
              ? !!current.activatedAt
              : !current.activatedAt)
          )
            return;
          const recent = await tx.accountMail.findFirst({
            where: {
              userId: user.id,
              purpose,
              createdAt: { gt: new Date(Date.now() - 60e3) },
            },
          });
          if (recent) return;
          await tx.accountMail.updateMany({
            where: { userId: user.id, purpose, status: "queued" },
            data: { status: "cancelled" },
          });
          await tx.accountMail.create({ data: { userId: user.id, purpose } });
        });
        return {
          ok: true,
          message: "若帳號符合條件，我們會寄送連結。請檢查信箱，稍候再申請。",
        };
      },
    );
  }
  app.post(
    "/api/auth/reset-password",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const body = z
        .object({
          token: z.string().min(32).max(128),
          password: z.string().min(12).max(128),
        })
        .parse(req.body);
      const passwordHash = await argon2.hash(body.password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });
      await db.$transaction(async (tx) => {
        const candidate = await tx.invitation.findUnique({
          where: { tokenHash: hashToken(body.token) },
        });
        if (!candidate) fail(400, "連結無效或已過期，請重新申請");
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${candidate.userId} FOR UPDATE`;
        const invite = await tx.invitation.findUniqueOrThrow({
          where: { id: candidate.id },
          include: { user: true },
        });
        if (
          invite.purpose !== "reset" ||
          invite.consumedAt ||
          invite.expiresAt <= new Date() ||
          !invite.user.activatedAt ||
          invite.user.disabled
        )
          fail(400, "連結無效或已過期，請重新申請");
        await tx.user.update({
          where: { id: invite.userId },
          data: { passwordHash },
        });
        await tx.session.deleteMany({ where: { userId: invite.userId } });
        await tx.invitation.updateMany({
          where: { userId: invite.userId, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        await tx.accountMail.updateMany({
          where: { userId: invite.userId, status: "queued" },
          data: { status: "cancelled" },
        });
      });
      reply.clearCookie("session", options);
      return { ok: true };
    },
  );
  app.post(
    "/api/auth/activate",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z
        .object({
          token: z.string().min(32).max(128),
          password: z.string().min(12).max(128),
        })
        .parse(req.body);
      const passwordHash = await argon2.hash(body.password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });
      const userId = await db.$transaction(async (tx) => {
        const candidate = await tx.invitation.findUnique({
          where: { tokenHash: hashToken(body.token) },
        });
        if (!candidate) fail(400, "連結無效或已過期，請聯絡發證單位");
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${candidate.userId} FOR UPDATE`;
        const invite = await tx.invitation.findUnique({
          where: { id: candidate.id },
          include: { user: true },
        });
        if (
          !invite ||
          invite.purpose !== "activation" ||
          invite.consumedAt ||
          invite.expiresAt <= new Date() ||
          invite.user.activatedAt ||
          invite.user.disabled
        )
          fail(400, "連結無效或已過期，請聯絡發證單位");
        const consumed = await tx.invitation.updateMany({
          where: {
            id: invite.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1) fail(400, "連結無效或已使用");
        const changed = await tx.user.updateMany({
          where: { id: invite.userId, activatedAt: null },
          data: { passwordHash, activatedAt: new Date() },
        });
        if (changed.count !== 1) fail(400, "帳號已啟用");
        await tx.session.deleteMany({ where: { userId: invite.userId } });
        await tx.invitation.updateMany({
          where: { userId: invite.userId, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        return invite.userId;
      });
      await sessionFor(reply, userId, passwordHash);
      return { ok: true };
    },
  );
}
const dummyHash = argon2.hash(randomBytes(32).toString("hex"), {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
});
