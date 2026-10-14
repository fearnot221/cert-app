import nodemailer from "nodemailer";
import { config } from "@cert/config";
export interface EmailMessage {
  from: { name: string; address: string };
  to: string;
  subject: string;
  messageId: string;
  text: string;
  html: string;
}
export interface EmailProvider {
  send(
    message: EmailMessage,
  ): Promise<{ accepted: unknown[]; messageId: string }>;
}
/** Development sink only. Production SMTP needs a separate verified/TLS adapter in Phase 3. */
export class MailpitEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    if (config.NODE_ENV === "production" || config.MAIL_MODE !== "mailpit")
      throw new Error("Mailpit provider is disabled");
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 10000,
      socketTimeout: 30000,
    });
    try {
      const result = await transport.sendMail(message);
      return { accepted: result.accepted, messageId: result.messageId };
    } finally {
      transport.close();
    }
  }
}
export const emailProvider: EmailProvider = new MailpitEmailProvider();
