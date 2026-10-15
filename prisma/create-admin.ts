// Creates the first organization and its Owner account. Safe for production: it never
// overwrites an existing password and refuses to run once the organization exists.
import argon2 from "argon2";
import { db, rolePermissions } from "@cert/domain";
import { OrganizationSlugSchema } from "@cert/contracts";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const orgName = process.env.ADMIN_ORG_NAME?.trim();
const orgSlug = process.env.ADMIN_ORG_SLUG
  ? OrganizationSlugSchema.parse(process.env.ADMIN_ORG_SLUG)
  : undefined;
if (!email || !email.includes("@")) throw new Error("Set ADMIN_EMAIL");
if (!password || password.length < 12)
  throw new Error("Set ADMIN_PASSWORD (12+ characters)");
if (!orgName) throw new Error("Set ADMIN_ORG_NAME");

const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
await db.$transaction(async (tx) => {
  if (await tx.organization.findFirst({ where: { name: orgName } }))
    throw new Error(`Organization "${orgName}" already exists; nothing changed.`);
  if (orgSlug && (await tx.organization.findUnique({ where: { slug: orgSlug } })))
    throw new Error(`Address /${orgSlug} is taken; choose another ADMIN_ORG_SLUG.`);
  const existing = await tx.user.findUnique({ where: { email } });
  if (existing?.passwordHash)
    console.log("Account already has a password; it was not changed.");
  const user = existing
    ? await tx.user.update({
        where: { id: existing.id },
        data: existing.passwordHash
          ? {}
          : {
              passwordHash,
              activatedAt: new Date(),
            },
      })
    : await tx.user.create({
        data: {
          email,
          passwordHash,
          activatedAt: new Date(),
        },
      });
  const org = await tx.organization.create({
    data: { name: orgName, ...(orgSlug ? { slug: orgSlug } : {}) },
  });
  for (const [name, permissions] of Object.entries(rolePermissions))
    await tx.role.create({
      data: { organizationId: org.id, name, permissions, isOwner: name === "Owner" },
    });
  const owner = await tx.role.findUniqueOrThrow({
    where: { organizationId_name: { organizationId: org.id, name: "Owner" } },
  });
  await tx.membership.create({
    data: { organizationId: org.id, userId: user.id, roleId: owner.id },
  });
  // The organization's sender for MAIL_MODE=smtp; the provider always sends From MAIL_FROM.
  const connection =
    (await tx.emailConnection.findFirst({ where: { provider: "smtp" } })) ??
    (await tx.emailConnection.create({ data: { name: "正式 SMTP", provider: "smtp" } }));
  const grant = await tx.connectionGrant.create({
    data: { organizationId: org.id, connectionId: connection.id },
  });
  await tx.senderIdentity.create({
    data: {
      organizationId: org.id,
      grantId: grant.id,
      displayName: org.name,
      fromAddress: process.env.MAIL_FROM || `no-reply@${new URL(process.env.APP_ORIGIN ?? "http://localhost").hostname}`,
      status: "verified",
    },
  });
  await tx.auditLog.create({
    data: {
      organizationId: org.id,
      actorId: user.id,
      action: "organization.bootstrap",
      resourceId: org.id,
      metadata: { via: "create-admin" },
    },
  });
  console.log(`Created organization "${org.name}" (/${org.slug}) with owner ${email}.`);
});
await db.$disconnect();
