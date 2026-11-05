import { db } from "@infradeck/db";
import { authorize, auditData } from "@infradeck/core";
import { scope } from "../../../../lib/session";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const s = await scope(true);
  try {
    authorize(s, "export");
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  const { id } = await params;
  const job = await db.reportJob.findFirst({
    where: { id, workspaceId: s.workspaceId, status: "DONE" },
    select: { artifact: true, format: true, id: true },
  });
  if (!job?.artifact) return new Response("Not found", { status: 404 });
  await db.auditEntry.create({ data: auditData(s, "REPORT_DOWNLOAD", id) });
  return new Response(new Uint8Array(job.artifact), {
    headers: {
      "Content-Type":
        job.format === "PDF"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="infradeck-${job.id}.${job.format.toLowerCase()}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
