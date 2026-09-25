import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { handleHub } from "../../../../db/hub-service";
async function route(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!env.DB) return Response.json({ error: "Workspace unavailable." }, { status: 503 });
  return handleHub(request, ["content", (await context.params).id], { db: env.DB, identity: await getChatGPTUser(), ownerEmail: env.WORKSPACE_OWNER_EMAIL ?? "" });
}
export { route as GET, route as PUT, route as DELETE };
