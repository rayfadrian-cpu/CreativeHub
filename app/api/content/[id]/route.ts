import { getChatGPTUser } from "../../../chatgpt-auth";
import { database, validateContent } from "../../../../db/content";

function parseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid content item.");
  return id;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
    const id = parseId((await context.params).id);
    const input = validateContent(await request.json());
    const db = database();
    await db.prepare(`
      UPDATE content_items SET title = ?, publish_date = ?, pillar = ?, campaign = ?,
        platform = ?, pic = ?, status = ?, caption = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_id = ?
    `).bind(input.title, input.publishDate, input.pillar, input.campaign, input.platform, input.pic, input.status, input.caption, input.notes, id, user.userId).run();
    const item = await db.prepare(`
      SELECT id, title, publish_date AS publishDate, pillar, campaign, platform,
             pic, status, caption, notes, created_at AS createdAt, updated_at AS updatedAt
      FROM content_items WHERE owner_id = ? AND id = ?
    `).bind(user.userId, id).first();
    if (!item) return Response.json({ error: "Content item not found." }, { status: 404 });
    return Response.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update content.";
    return Response.json({ error: message }, { status: message.startsWith("Please complete") || message.includes("valid status") ? 400 : 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
    const id = parseId((await context.params).id);
    await database().prepare("DELETE FROM content_items WHERE id = ? AND owner_id = ?").bind(id, user.userId).run();
    return Response.json({ deleted: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not delete content." }, { status: 500 });
  }
}
