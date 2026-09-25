import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { handleHub } from "../../../../db/hub-service";
export const dynamic = "force-dynamic";
async function route(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!env.DB) return Response.json({ error: "The workspace is temporarily unavailable." }, { status: 503 });
  return handleHub(request, (await context.params).path, { db: env.DB, bucket: env.BUCKET, identity: await getChatGPTUser(), ownerEmail: env.WORKSPACE_OWNER_EMAIL ?? "" });
}
export { route as GET, route as POST, route as PUT, route as PATCH, route as DELETE };
