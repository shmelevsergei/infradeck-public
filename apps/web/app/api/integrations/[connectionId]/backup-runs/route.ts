import {
  BackupWebhookError,
  backupWebhookLimit,
  receiveBackupResult,
} from "../../../../../../../packages/core/src/backup-webhook";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  const response = (value: unknown, status: number) =>
    Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return response({ error: "JSON required" }, 415);
    if (Number(request.headers.get("content-length") ?? 0) > backupWebhookLimit)
      return response({ error: "Payload too large" }, 413);
    const reader = request.body?.getReader();
    if (!reader) return response({ error: "Invalid backup result" }, 422);
    const chunks: Uint8Array[] = [];
    let size = 0,
      expired = false;
    const timer = setTimeout(() => {
      expired = true;
      void reader.cancel().catch(() => {});
    }, 10000);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > backupWebhookLimit) {
          await reader.cancel();
          return response({ error: "Payload too large" }, 413);
        }
        chunks.push(value);
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
    if (expired) return response({ error: "Request timeout" }, 408);
    const { connectionId } = await context.params;
    const result = await receiveBackupResult(
      connectionId,
      request.headers.get("x-infradeck-timestamp") ?? "",
      request.headers.get("x-infradeck-signature") ?? "",
      Buffer.concat(chunks),
    );
    return response(result, result.duplicate ? 200 : 202);
  } catch (error) {
    return response(
      {
        error:
          error instanceof BackupWebhookError
            ? error.message
            : "Unable to accept backup result",
      },
      error instanceof BackupWebhookError ? error.status : 503,
    );
  }
}
