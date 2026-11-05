import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { db } from "@infradeck/db";

const installationInput = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(12)
    .max(128)
    .refine(
      (value) => value === value.trim(),
      "Password must not have surrounding whitespace",
    ),
  name: z.string().trim().min(1).max(2000),
  workspace: z.string().trim().min(1).max(2000),
  timezone: z.string().min(1).max(2000),
  locale: z.enum(["ru", "en"]),
});

export async function initializeInstallation(
  input: unknown,
  existing: "reject" | "skip" = "reject",
) {
  return db.$transaction(
    async (tx) => {
      // The browser wizard and deployment initializer must share this lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(781230)`;
      if (await tx.installation.count()) {
        if (existing === "skip") return { created: false };
        throw new Error(
          "Первоначальная настройка уже завершена / Initial setup already completed",
        );
      }
      if (
        (await tx.user.count()) ||
        (await tx.workspace.count()) ||
        (await tx.membership.count())
      )
        throw new Error(
          "Installation marker missing in a non-empty database; use administrator recovery",
        );
      const config = installationInput.parse(input);
      new Intl.DateTimeFormat("en", { timeZone: config.timezone });
      const user = await tx.user.create({
        data: { email: config.email, name: config.name },
      });
      await tx.account.create({
        data: {
          id: randomUUID(),
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password: await hashPassword(config.password),
        },
      });
      const workspace = await tx.workspace.create({
        data: {
          name: config.workspace,
          timezone: config.timezone,
          locale: config.locale,
          memberships: {
            create: { userId: user.id, role: "OWNER", canExport: true },
          },
        },
      });
      await tx.installation.create({ data: { id: 1 } });
      await tx.auditEntry.create({
        data: {
          workspaceId: workspace.id,
          actorId: user.id,
          action: "SETUP",
          target: workspace.id,
        },
      });
      return { created: true };
    },
    { timeout: 30000 },
  );
}

export async function initializeAdminFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
) {
  if (!env.INFRADECK_INIT_ADMIN_EMAIL && !env.INFRADECK_INIT_ADMIN_PASSWORD)
    return "disabled" as const;
  const result = await initializeInstallation(
    {
      email: env.INFRADECK_INIT_ADMIN_EMAIL,
      password: env.INFRADECK_INIT_ADMIN_PASSWORD,
      name: env.INFRADECK_INIT_ADMIN_NAME || "Administrator",
      workspace: env.INFRADECK_INIT_WORKSPACE_NAME || "InfraDeck",
      timezone: env.INFRADECK_INIT_TIMEZONE || "UTC",
      locale: env.INFRADECK_INIT_LOCALE || "en",
    },
    "skip",
  );
  return result.created ? ("created" as const) : ("existing" as const);
}
