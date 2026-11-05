import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { db } from "@infradeck/db";
import { authorize, membership, auditData, type Scope } from "./index";
import { z } from "zod";

export const apiScopes = [
  "projects:read",
  "resources:read",
  "reports:read",
] as const;
export const tokenHash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
const expiry = (value: Date) => {
  if (!(value > new Date()) || value.getTime() > Date.now() + 366 * 86400000)
    throw new Error("Expiry must be within one year");
  return value;
};
export async function createInvitation(
  s: Scope,
  input: { email: string; role: string; canExport: boolean; expiresAt: Date; projectRestricted?: boolean },
) {
  const secret = randomBytes(32).toString("base64url");
  const email = z.email().parse(input.email.trim().toLowerCase());
  const role = z.enum(["ADMIN", "OPERATOR", "VIEWER"]).parse(input.role);
  if (input.projectRestricted && role === "ADMIN") throw new Error("Project-only users cannot be workspace administrators");
  await db.$transaction(async (tx) => {
    authorize(await membership(s.userId, s.workspaceId), "admin");
    const invite = await tx.invitation.create({
      data: {
        workspaceId: s.workspaceId,
        createdBy: s.userId,
        email,
        role,
        canExport: input.canExport,
        projectRestricted: input.projectRestricted ?? false,
        expiresAt: expiry(input.expiresAt),
        tokenHash: tokenHash(secret),
      },
    });
    await tx.auditEntry.create({
      data: auditData(s, "INVITATION_CREATE", invite.id, { email, role }),
    });
  });
  return secret;
}
export async function acceptInvitation(
  secret: string,
  email: string,
  name: string,
  password: string,
  authenticatedUserId?: string,
) {
  const recipient = z.email().parse(email.trim().toLowerCase());
  const hash = password
    ? await hashPassword(z.string().min(12).max(128).parse(password))
    : null;
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "Invitation" WHERE "tokenHash" = ${tokenHash(secret)} FOR UPDATE`;
      const invite = rows[0]
        ? await tx.invitation.findUnique({ where: { id: rows[0].id } })
        : null;
      if (
        !invite ||
        invite.email !== recipient ||
        invite.revokedAt ||
        invite.acceptedAt ||
        invite.expiresAt <= new Date()
      )
        throw new Error("Invalid, expired or used invitation");
      const inviter = await tx.membership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: invite.workspaceId,
            userId: invite.createdBy,
          },
        },
      });
      if (!inviter || inviter.projectRestricted || !["OWNER", "ADMIN"].includes(inviter.role))
        throw new Error("Invitation issuer no longer authorized");
      let user = await tx.user.findFirst({
        where: { email: { equals: recipient, mode: "insensitive" } },
      });
      if (user) {
        if (user.id !== authenticatedUserId)
          throw new Error("Sign in as the invitation recipient first");
      } else {
        if (!hash) throw new Error("Password required");
        user = await tx.user.create({
          data: {
            email: recipient,
            name: z.string().trim().min(1).max(200).parse(name),
          },
        });
        await tx.account.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            accountId: user.id,
            providerId: "credential",
            password: hash,
          },
        });
      }
      if (
        await tx.membership.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: invite.workspaceId,
              userId: user.id,
            },
          },
        })
      )
        throw new Error("Recipient is already a member");
      await tx.membership.create({
        data: {
          workspaceId: invite.workspaceId,
          userId: user.id,
          role: invite.role,
          canExport: invite.canExport,
          projectRestricted: invite.projectRestricted,
        },
      });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      await tx.auditEntry.create({
        data: {
          workspaceId: invite.workspaceId,
          actorId: user.id,
          action: "INVITATION_ACCEPT",
          target: invite.id,
        },
      });
      return user.id;
    },
    { isolationLevel: "Serializable" },
  );
}
export async function createApiToken(
  s: Scope,
  name: string,
  scopes: string[],
  expiresAt: Date,
) {
  const selected = z.array(z.enum(apiScopes)).min(1).parse(scopes);
  const secret = "idk_" + randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    authorize(await membership(s.userId, s.workspaceId), "admin");
    const token = await tx.apiToken.create({
      data: {
        workspaceId: s.workspaceId,
        actorId: s.userId,
        name: z.string().trim().min(1).max(200).parse(name),
        scopes: selected,
        tokenHash: tokenHash(secret),
        expiresAt: expiry(expiresAt),
      },
    });
    await tx.auditEntry.create({
      data: auditData(s, "API_TOKEN_CREATE", token.id, { scopes: selected }),
    });
  });
  return secret;
}
export async function authenticateApi(
  secret: string,
  required: (typeof apiScopes)[number],
): Promise<Scope> {
  if (!/^idk_[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("Unauthorized");
  return db.$transaction(async (tx) => {
    const token = await tx.apiToken.findUnique({
      where: { tokenHash: tokenHash(secret) },
    });
    if (
      !token ||
      token.revokedAt ||
      token.expiresAt <= new Date() ||
      !token.scopes.includes(required)
    )
      throw new Error("Unauthorized");
    const m = await tx.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: token.workspaceId,
          userId: token.actorId,
        },
      },
    });
    if (!m || m.projectRestricted || !["OWNER", "ADMIN"].includes(m.role))
      throw new Error("Unauthorized");
    const key = "api:" + token.id;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const rate = await tx.rateLimit.findUnique({ where: { key } });
    const inWindow = !!rate && Date.now() - Number(rate.lastRequest) < 60000;
    if (inWindow && rate.count >= 120) throw new Error("Rate limit");
    await tx.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, lastRequest: BigInt(Date.now()) },
      update: {
        count: inWindow ? rate!.count + 1 : 1,
        lastRequest: inWindow ? rate!.lastRequest : BigInt(Date.now()),
      },
    });
    return {
      workspaceId: token.workspaceId,
      userId: token.actorId,
      role: m.role,
      canExport: m.canExport,
    };
  });
}
