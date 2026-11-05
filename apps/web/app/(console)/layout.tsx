import { db } from "@infradeck/db";
import { scope } from "../../lib/session";
import { Shell } from "../../components/shell";
import { LocaleProvider } from "../../components/locale";
export const dynamic = "force-dynamic";
export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = await scope();
  const [workspace, user, memberships, h] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: s.workspaceId } }),
    db.user.findUniqueOrThrow({ where: { id: s.userId } }),
    db.membership.findMany({
      where: { userId: s.userId },
      include: { workspace: true },
    }),
    db.workerHeartbeat.findUnique({ where: { id: "worker" } }),
  ]);
  return (
    <LocaleProvider locale={workspace.locale}>
      <Shell
        workspace={workspace}
        user={user}
        workspaces={memberships.map((m) => m.workspace)}
        workerOnline={!!h && Date.now() - h.seenAt.getTime() < 60000}
      >
        {children}
      </Shell>
    </LocaleProvider>
  );
}
