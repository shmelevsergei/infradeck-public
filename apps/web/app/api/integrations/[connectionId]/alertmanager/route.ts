import { receiveAlertmanager, AlertmanagerError } from "../../../../../../../packages/core/src/alertmanager";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const response = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return response("JSON required", 415);
  if (Number(request.headers.get("content-length") ?? 0) > 65536) return response("Payload too large", 413);
  const reader = request.body?.getReader(); if (!reader) return response("Payload required", 422);
  const chunks: Uint8Array[] = []; let size = 0, expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 10000);
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); return response("Payload too large", 413); } chunks.push(value); }
    if (expired) return response("Request timeout", 408);
    let payload: unknown;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return response("Invalid JSON", 422); }
    const { connectionId } = await context.params;
    await receiveAlertmanager(connectionId, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", payload);
    return Response.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return response(e instanceof AlertmanagerError ? e.message : "Unable to accept alert", e instanceof AlertmanagerError ? e.status : 503); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
