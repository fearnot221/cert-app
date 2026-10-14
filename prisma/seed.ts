import argon2 from "argon2";
import { db, rolePermissions } from "@cert/domain";
import {
  createDefaultDocument,
  FONT_SHA256,
  FONT_ASSET_VERSION,
  RENDERER_VERSION,
} from "@cert/contracts";
if (process.env.NODE_ENV === "production")
  throw new Error("Development seed is forbidden in production");
const password = process.env.SEED_ADMIN_PASSWORD;
if (!password || password.length < 12)
  throw new Error("Set SEED_ADMIN_PASSWORD (12+ characters)");
const email = process.env.SEED_ADMIN_EMAIL || "admin@example.test";
const user = await db.user.upsert({
  where: { email },
  create: {
    email,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    activatedAt: new Date(),
  },
  update: {},
});
for (const [i, [name, slug]] of [["知行培訓中心", "zhixing"], ["青禾教育基金會", "qinghe"]].entries()) {
  const orgId = `00000000-0000-4000-8000-00000000000${i + 1}`;
  const org = await db.organization.upsert({
    where: { id: orgId },
    create: { id: orgId, name: name!, slug: slug! },
    update: {},
  });
  for (const [name, permissions] of Object.entries(rolePermissions)) {
    await db.role.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      create: {
        organizationId: org.id,
        name,
        permissions,
        isOwner: name === "Owner",
      },
      update: {},
    });
  }
  const owner = await db.role.findUniqueOrThrow({
    where: { organizationId_name: { organizationId: org.id, name: "Owner" } },
  });
  await db.membership.upsert({
    where: {
      organizationId_userId: { organizationId: org.id, userId: user.id },
    },
    create: { organizationId: org.id, userId: user.id, roleId: owner.id },
    update: {},
  });
  const connection = await db.emailConnection.upsert({
    where: { id: "00000000-0000-4000-8000-000000000003" },
    create: {
      id: "00000000-0000-4000-8000-000000000003",
      name: "本機 Mailpit 測試信箱",
    },
    update: {},
  });
  const grant = await db.connectionGrant.upsert({
    where: {
      organizationId_connectionId: {
        organizationId: org.id,
        connectionId: connection.id,
      },
    },
    create: { organizationId: org.id, connectionId: connection.id },
    update: {},
  });
  if (
    !(await db.senderIdentity.findFirst({ where: { organizationId: org.id } }))
  )
    await db.senderIdentity.create({
      data: {
        organizationId: org.id,
        grantId: grant.id,
        displayName: org.name,
        fromAddress: `certificates${i + 1}@example.test`,
      },
    });
  // Two templates, so one event can mix them: the list's `template` column picks one per recipient.
  const hours = createDefaultDocument();
  hours.fields.push({ key: "hours", label: "研習時數", type: "number", required: true });
  hours.elements[1]!.text = "研習時數證明";
  hours.elements[3]!.text = "完成 {{event_name}}，共 {{hours}} 小時";
  for (const [name, document] of [["結業證書範本", createDefaultDocument()], ["研習時數證明", hours]] as const) {
    if (await db.template.findFirst({ where: { organizationId: org.id, name } })) continue;
    const template = await db.template.create({
      data: {
        organizationId: org.id,
        name,
        document,
        status: "published",
      },
    });
    await db.templateVersion.create({
      data: {
        organizationId: org.id,
        templateId: template.id,
        number: 1,
        document,
        rendererVersion: RENDERER_VERSION,
        assetManifest: {
          font: { version: FONT_ASSET_VERSION, sha256: FONT_SHA256 },
          background: null,
        },
      },
    });
  }
}
console.log(
  "Local seed ready. Two organizations; existing credentials were not overwritten.",
);
await db.$disconnect();
