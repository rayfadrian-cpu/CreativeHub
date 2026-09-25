import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleHub } from "../../../db/hub-service";
async function route(request: Request) {
  if (!env.DB) return Response.json({ error: "Workspace unavailable." }, { status: 503 });
  return handleHub(request, ["content"], { db: env.DB, identity: await getChatGPTUser(), ownerEmail: env.WORKSPACE_OWNER_EMAIL ?? "" });
}
export { route as GET, route as POST };
