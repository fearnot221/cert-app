import { randomBytes, createHash } from "node:crypto";
import { db } from "./db.js";
import { config } from "@cert/config";
import { emailProvider } from "./email.js";
import { withJobLock } from "./jobs.js";

/** Durable global identity mail. Tokens exist only in worker memory and the recipient's mailbox. */
export async function processAccountMail(id: string) {
  await withJobLock(`account-mail:${id}`, async () => {
    const token = randomBytes(32).toString("base64url");
    const mail = await db.$transaction(async (tx) => {
      const candidate = await tx.accountMail.findUnique({ where: { id } });
      if (!candidate) return;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${candidate.userId} FOR UPDATE`;
      const row = await tx.accountMail.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!row || !["queued", "sending"].includes(row.status)) return;
      if (row.status === "sending") {
        // SMTP may already have accepted the message. Never blindly resend after a crash.
        await tx.accountMail.update({
          where: { id },
          data: { status: "unknown" },
        });
        return;
      }
      if (
        row.user.disabled ||
        (row.purpose === "activation"
          ? !!row.user.activatedAt
          : !row.user.activatedAt) ||
        config.MAIL_MODE === "disabled" ||
        Date.now() - row.createdAt.getTime() > 3600e3
      ) {
        await tx.accountMail.update({
          where: { id },
          data: { status: "cancelled" },
        });
        return;
      }
      await tx.invitation.updateMany({
        where: { userId: row.userId, purpose: row.purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.invitation.create({
        data: {
          userId: row.userId,
          purpose: row.purpose,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(
            Date.now() + (row.purpose === "activation" ? 86400e3 : 1800e3),
          ),
        },
      });
      await tx.accountMail.update({
        where: { id },
        data: { status: "sending" },
      });
      return row;
    });
    if (!mail) return;
    const activation = mail.purpose === "activation";
    const url = `${config.APP_ORIGIN}/${activation ? "activate" : "reset-password"}#token=${token}`;
    const subject = activation
      ? "重新啟用你的 Certfolio 帳號"
      : "重設你的 Certfolio 密碼";
    const text = `${subject}\n${url}\n連結有效期限：${activation ? "24 小時" : "30 分鐘"}，僅限使用一次。若非本人要求，可忽略本信。`;
    try {
      const sent = await emailProvider.send({
        from: { name: "Certfolio 帳號服務", address: config.MAIL_FROM || "accounts@example.test" },
        to: mail.user.email,
        subject,
        messageId: `<account-${id}@certfolio.local>`,
        text,
        html: `<p>${subject}</p><p><a href="${url}">開啟安全連結</a></p><p>若非本人要求，可忽略本信。</p>`,
      });
      await db.accountMail.update({
        where: { id },
        data: { status: sent.accepted.length ? "accepted" : "failed" },
      });
    } catch {
      await db.accountMail.update({
        where: { id },
        data: { status: "unknown" },
      });
    }
  });
}
