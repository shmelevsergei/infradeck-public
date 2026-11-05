import { db } from "@infradeck/db";
import { hashPassword } from "better-auth/crypto";
const email = process.argv[2],
  password = process.env.INFRADECK_RESET_PASSWORD;
if (!email || !password || password.length < 12)
  throw new Error(
    "Usage: INFRADECK_RESET_PASSWORD=<12+ chars> npm run admin:reset -- email",
  );
const user = await db.user.findUniqueOrThrow({ where: { email } });
await db.$transaction(async (tx) => {
  await tx.account.updateMany({
    where: { userId: user.id, providerId: "credential" },
    data: { password: await hashPassword(password) },
  });
  await tx.session.deleteMany({ where: { userId: user.id } });
  for (const m of await tx.membership.findMany({ where: { userId: user.id } }))
    await tx.auditEntry.create({
      data: {
        workspaceId: m.workspaceId,
        actorId: "LOCAL_CLI",
        action: "PASSWORD_RESET",
        target: user.id,
      },
    });
});
await db.$disconnect();
console.log("Password reset; all existing sessions revoked.");
