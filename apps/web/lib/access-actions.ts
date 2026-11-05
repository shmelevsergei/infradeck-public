"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, authorize, auditData } from "@infradeck/core";
import { db } from "@infradeck/db";
import {
  createInvitation,
  acceptInvitation,
  createApiToken,
} from "../../../packages/core/src/access";
import { scope } from "./session";
import type { ActionState } from "./actions";
import { z } from "zod";
const value = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
async function origin() {
  const h = await headers();
  if (
    h.get("origin") &&
    h.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin
  )
    throw new Error("Invalid origin");
}
export async function accessAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    await origin();
    const s = await scope();
    authorize(s, "admin");
    const kind = value(f, "kind");
    if (kind === "invite") {
      const secret = await createInvitation(s, {
        email: value(f, "email"),
        role: value(f, "role"),
        canExport: value(f, "canExport") === "true",
        projectRestricted: value(f, "projectRestricted") === "true",
        expiresAt: z.coerce.date().parse(value(f, "expiresAt")),
      });
      revalidatePath("/access");
      return {
        success: new URL(
          "/invite?token=" + secret,
          process.env.BETTER_AUTH_URL,
        ).toString(),
      };
    }
    if (kind === "token") {
      const secret = await createApiToken(
        s,
        value(f, "name"),
        f.getAll("scopes").map(String),
        z.coerce.date().parse(value(f, "expiresAt")),
      );
      revalidatePath("/access");
      return { success: secret };
    }
    const id = value(f, "id");
    await db.$transaction(async (tx) => {
      const m = await tx.membership.findUniqueOrThrow({
        where: {
          workspaceId_userId: { workspaceId: s.workspaceId, userId: s.userId },
        },
      });
      authorize({ ...s, role: m.role }, "admin");
      if (kind === "revokeInvitation")
        await tx.invitation.updateMany({
          where: { workspaceId: s.workspaceId, id, acceptedAt: null },
          data: { revokedAt: new Date() },
        });
      else if (kind === "revokeToken")
        await tx.apiToken.updateMany({
          where: { workspaceId: s.workspaceId, id },
          data: { revokedAt: new Date() },
        });
      else throw new Error("Invalid operation");
      await tx.auditEntry.create({ data: auditData(s, kind, id) });
    });
    revalidatePath("/access");
    return { success: "Отозвано / Revoked" };
  } catch {
    return {
      error:
        "Проверьте права, получателя и срок действия / Check permissions, recipient and expiry",
    };
  }
}
export async function acceptInvitationAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    await origin();
    const token = z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(value(f, "token"));
    await db.$transaction(async (tx) => {
      const key = "invitation-accept";
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const rate = await tx.rateLimit.findUnique({ where: { key } });
      const active = !!rate && Date.now() - Number(rate.lastRequest) < 60000;
      if (active && rate.count >= 30) throw new Error("Rate limit");
      await tx.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, lastRequest: BigInt(Date.now()) },
        update: {
          count: active ? rate!.count + 1 : 1,
          lastRequest: active ? rate!.lastRequest : BigInt(Date.now()),
        },
      });
    });
    const session = await auth.api.getSession({ headers: await headers() });
    await acceptInvitation(
      token,
      value(f, "email"),
      value(f, "name"),
      value(f, "password"),
      session?.user.id,
    );
  } catch (e) {
    return {
      error:
        e instanceof Error &&
        e.message === "Sign in as the invitation recipient first"
          ? "Сначала войдите под email получателя / Sign in as the recipient first"
          : "Приглашение недействительно, истекло или уже использовано / Invitation invalid, expired or used",
    };
  }
  redirect("/login");
}
