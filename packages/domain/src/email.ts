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
/** The sender identity and connection a delivery must use in the current MAIL_MODE. */
export const mailSender = {
  status: config.MAIL_MODE === "smtp" ? "verified" : "development",
  provider: config.MAIL_MODE,
} as const;
async function sendWith(
  options: Parameters<typeof nodemailer.createTransport>[0],
  message: EmailMessage,
) {
  const transport = nodemailer.createTransport(options);
  try {
    const result = await transport.sendMail(message);
    return { accepted: result.accepted, messageId: result.messageId };
  } finally {
    transport.close();
  }
}
/** Development sink only. */
export class MailpitEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    if (config.NODE_ENV === "production" || config.MAIL_MODE !== "mailpit")
      throw new Error("Mailpit provider is disabled");
    return sendWith(
      {
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: false,
        ignoreTLS: true,
        connectionTimeout: 10000,
        socketTimeout: 30000,
      },
      message,
    );
  }
}
/**
 * Authenticated SMTP over TLS (implicit on 465, STARTTLS required otherwise). The visible From
 * address is always MAIL_FROM, so an organization can only choose the display name.
 */
export class SmtpEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    if (config.MAIL_MODE !== "smtp") throw new Error("SMTP provider is disabled");
    return sendWith(
      {
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        requireTLS: true,
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
        connectionTimeout: 10000,
        socketTimeout: 30000,
      },
      { ...message, from: { name: message.from.name, address: config.MAIL_FROM } },
    );
  }
}
export const emailProvider: EmailProvider =
  config.MAIL_MODE === "smtp" ? new SmtpEmailProvider() : new MailpitEmailProvider();
