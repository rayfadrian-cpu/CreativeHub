import { env } from "cloudflare:workers";
import { verifyPublishingMediaSignature } from "../../../../db/milestone-five";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  if (!env.DB || !env.BUCKET || !env.SOCIAL_TOKEN_ENCRYPTION_KEY) return new Response("Unavailable", { status: 503 });
  const assetId = Number((await context.params).assetId);
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace") ?? "";
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") ?? "";
  if (!Number.isInteger(assetId) || assetId < 1 || !workspaceId ||
      !await verifyPublishingMediaSignature(workspaceId, assetId, expires, signature, env.SOCIAL_TOKEN_ENCRYPTION_KEY)) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const asset = await env.DB.prepare(`SELECT storage_key AS storageKey, mime_type AS mimeType, file_name AS fileName
    FROM media_assets WHERE workspace_id = ? AND id = ?`).bind(workspaceId, assetId)
    .first<{ storageKey: string; mimeType: string; fileName: string }>();
  if (!asset) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const object = await env.BUCKET.get(asset.storageKey);
  if (!object) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(object.body, {
    headers: {
      "Content-Type": asset.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
