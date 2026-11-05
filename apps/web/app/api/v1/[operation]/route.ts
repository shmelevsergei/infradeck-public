import { db } from "@infradeck/db";
import { authenticateApi } from "../../../../../../packages/core/src/access";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  const { operation } = await params;
  if (!["projects", "resources", "reports"].includes(operation))
    return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const scope = await authenticateApi(
      (request.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
      `${operation}:read` as
        | "projects:read"
        | "resources:read"
        | "reports:read",
    );
    const where = { workspaceId: scope.workspaceId };
    const data =
      operation === "projects"
        ? await db.project.findMany({
            where,
            take: 1000,
            orderBy: { id: "asc" },
          })
        : operation === "resources"
          ? await db.resource.findMany({
              where,
              take: 1000,
              orderBy: { id: "asc" },
            })
          : await db.reportJob.findMany({
              where,
              take: 1000,
              orderBy: { id: "asc" },
              select: {
                id: true,
                format: true,
                status: true,
                createdAt: true,
                generatedAt: true,
              },
            });
    return Response.json(
      { data, limit: 1000 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { error: "Access denied" },
      { status: e instanceof Error && e.message === "Rate limit" ? 429 : 403 },
    );
  }
}
