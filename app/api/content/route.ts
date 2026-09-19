import { getChatGPTUser } from "../../chatgpt-auth";
import { database, selectContentSql, validateContent } from "../../../db/content";

function dateAfter(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const starterItems = [
  ["A calmer Monday starts here", 2, "Productivity", "September reset", "Instagram", "Maya", "Review", "Small steps, clearer weeks. Here is our Monday reset ritual.", "Check the final carousel order."],
  ["3 ways to plan content in less time", 3, "Education", "Work smarter", "LinkedIn", "Jordan", "Design", "Three practical ways to spend less time planning and more time creating.", "Use the blue campaign template."],
  ["Behind the scenes: our content ritual", 5, "Behind the scenes", "Meet the team", "TikTok", "Nadia", "Writing", "Come behind the scenes while we plan a week of useful content.", "Keep the video under 45 seconds."],
  ["September product roundup", 7, "Product updates", "September reset", "Instagram", "Maya", "Approved", "Everything we shipped this month, in one quick roundup.", "Approved by product on Friday."],
] as const;

async function ensureStarterContent(ownerId: string) {
  const db = database();
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM content_items WHERE owner_id = ?").bind(ownerId).first<{ count: number }>();
  if (Number(existing?.count ?? 0) > 0) return;
  const statements = starterItems.map((item) => db.prepare(`
    INSERT INTO content_items
      (owner_id, title, publish_date, pillar, campaign, platform, pic, status, caption, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(ownerId, item[0], dateAfter(item[1]), item[2], item[3], item[4], item[5], item[6], item[7], item[8]));
  await db.batch(statements);
}

export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
    await ensureStarterContent(user.userId);
    const result = await database().prepare(selectContentSql).bind(user.userId).all();
    return Response.json({ items: result.results ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load content." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
    const input = validateContent(await request.json());
    const db = database();
    const result = await db.prepare(`
      INSERT INTO content_items
        (owner_id, title, publish_date, pillar, campaign, platform, pic, status, caption, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(user.userId, input.title, input.publishDate, input.pillar, input.campaign, input.platform, input.pic, input.status, input.caption, input.notes).run();
    const item = await db.prepare(`
      SELECT id, title, publish_date AS publishDate, pillar, campaign, platform,
             pic, status, caption, notes, created_at AS createdAt, updated_at AS updatedAt
      FROM content_items WHERE owner_id = ? AND id = ?
    `).bind(user.userId, result.meta.last_row_id).first();
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create content.";
    return Response.json({ error: message }, { status: message.startsWith("Please complete") || message.includes("valid status") ? 400 : 500 });
  }
}
