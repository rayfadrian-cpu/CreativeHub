import { env } from "cloudflare:workers";

export const STATUSES = [
  "Idea",
  "Writing",
  "Design",
  "Review",
  "Revision",
  "Approved",
  "Scheduled",
] as const;

export type ContentInput = {
  title: string;
  publishDate: string;
  pillar: string;
  campaign: string;
  platform: string;
  pic: string;
  status: (typeof STATUSES)[number];
  caption: string;
  notes: string;
};

export function database() {
  if (!env.DB) throw new Error("Content storage is temporarily unavailable.");
  return env.DB;
}

export function validateContent(value: unknown): ContentInput {
  const body = (value ?? {}) as Record<string, unknown>;
  const clean = (key: string) => String(body[key] ?? "").trim();
  const status = clean("status") as ContentInput["status"];
  const input: ContentInput = {
    title: clean("title"),
    publishDate: clean("publishDate"),
    pillar: clean("pillar"),
    campaign: clean("campaign"),
    platform: clean("platform"),
    pic: clean("pic"),
    status,
    caption: clean("caption"),
    notes: clean("notes"),
  };
  if (!input.title || !input.publishDate || !input.pillar || !input.platform || !input.pic) {
    throw new Error("Please complete the title, date, pillar, platform, and person in charge.");
  }
  if (!STATUSES.includes(status)) throw new Error("Please choose a valid status.");
  return input;
}

export const selectContentSql = `
  SELECT id, title, publish_date AS publishDate, pillar, campaign, platform,
         pic, status, caption, notes, created_at AS createdAt, updated_at AS updatedAt
  FROM content_items
  WHERE owner_id = ?
  ORDER BY publish_date ASC, id DESC
`;
