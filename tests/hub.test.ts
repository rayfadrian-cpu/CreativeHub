/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleHub } from "../db/hub-service.ts";
import { roles, statuses, type Role } from "../lib/hub-types.ts";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const files = readdirSync("drizzle").filter(x => x.endsWith(".sql")).sort();
  sqlite.exec(readFileSync("drizzle/" + files[0], "utf8"));
  sqlite.exec(`INSERT INTO content_items
    (id, owner_id, title, publish_date, pillar, campaign, platform, pic, caption, notes)
    VALUES (42, 'legacy-user', 'Preserve me', '2026-09-25', 'Education', 'Legacy campaign',
      'Instagram', 'Legacy PIC', 'Original caption', 'Original notes')`);
  for (const file of files.slice(1)) sqlite.exec(readFileSync("drizzle/" + file, "utf8"));

  function prepare(sql: string) {
    let args: any[] = [];
    const statement = {
      bind(...values: any[]) { args = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
    };
    return statement;
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  const identity = (role: string) => ({ userId: role + "-user", email: role.replaceAll(" ", "").toLowerCase() + "@example.com", displayName: role + " Person" });
  async function call(role: string | null, method: string, path: string, payload?: any, headers: Record<string, string> = {}) {
    const request = new Request("https://creative.test/api/hub/" + path, {
      method,
      headers: { origin: "https://creative.test", ...headers },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const response = await handleHub(request, path.split("?")[0].split("/"), { db, identity: role ? identity(role) : null, ownerEmail: "owner@example.com" });
    return { status: response.status, data: await response.json() as any };
  }
  async function start() {
    assert.equal((await call("Owner", "GET", "workspace")).status, 200);
    for (const role of roles.filter(x => x !== "Owner")) {
      const added = await call("Owner", "POST", "members", { name: role + " Person", email: identity(role).email, role });
      assert.equal(added.status, 201);
      assert.equal((await call(role, "GET", "workspace")).status, 200);
    }
  }
  const memberId = (role: Role) => Number((sqlite.prepare("SELECT id FROM members WHERE role = ?").get(role) as any).id);
  const brandId = () => Number((sqlite.prepare("SELECT id FROM brands WHERE workspace_id = 'main' ORDER BY id LIMIT 1").get() as any).id);
  const pillarId = () => Number((sqlite.prepare("SELECT id FROM pillars WHERE workspace_id = 'main' ORDER BY id LIMIT 1").get() as any).id);
  function item(status = "Idea", assignee: Role = "Creative") {
    const brand = brandId();
    const result = sqlite.prepare(`INSERT INTO content_items
      (owner_id, workspace_id, brand_id, brand, title, publish_date, pillar, platform, pic, assignee_id, status)
      VALUES ('Owner-user', 'main', ?, 'Creative Hub', 'Test card', '2026-10-01', '', 'Instagram', ?, ?, ?)`)
      .run(brand, assignee + " Person", memberId(assignee), status);
    return Number(result.lastInsertRowid);
  }
  return { sqlite, call, start, memberId, brandId, pillarId, item };
}

test("safe migration preserves every legacy content value and links stable IDs", async () => {
  const f = fixture();
  assert.equal((await f.call(null, "GET", "workspace")).status, 401);
  assert.equal((await f.call("Stranger", "GET", "workspace")).status, 403);
  await f.start();
  const data = (await f.call("Owner", "GET", "workspace")).data;
  assert.equal(data.actor.role, "Owner");
  assert.equal(data.items.length, 1);
  assert.deepEqual(
    [data.items[0].id, data.items[0].title, data.items[0].caption, data.items[0].notes, data.items[0].pic, data.items[0].status, data.items[0].publishDate],
    [42, "Preserve me", "Original caption", "Original notes", "Legacy PIC", "Idea", "2026-09-25"],
  );
  assert.ok(data.items[0].brandId);
  assert.ok(data.items[0].pillarId);
  assert.ok(data.items[0].campaignId);
  assert.equal((f.sqlite.prepare("SELECT model_version FROM workspaces WHERE id = 'main'").get() as any).model_version, 2);
  assert.equal((f.sqlite.prepare("SELECT COUNT(*) n FROM collections").get() as any).n, 0);
  assert.equal((await f.call("Owner", "PUT", "content/42", { version: 1, title: "Bad origin" }, { origin: "https://evil.test" })).status, 403);
  assert.equal((await f.call("Viewer", "GET", "workspace")).data.members[0].email, "");
  assert.ok((f.sqlite.prepare("SELECT COUNT(*) n FROM activity_history WHERE action = 'workspace_migrated'").get() as any).n >= 1);
  f.sqlite.close();
});

const transitions: Record<Role, (from: string, to: string) => boolean> = {
  Owner: () => true,
  Admin: () => true,
  "Content Strategist": (from, to) => !["Approved", "Scheduled"].includes(from) && !["Approved", "Scheduled"].includes(to),
  Creative: (from, to) => !["Approved", "Scheduled"].includes(from) && !["Approved", "Scheduled"].includes(to),
  Designer: (from, to) => ["Design", "Review"].includes(from) && ["Design", "Review"].includes(to),
  "Social Media": (from, to) => from === "Approved" && to === "Scheduled",
  Approver: (from, to) => from === "Review" && ["Approved", "Revision"].includes(to),
  Viewer: () => false,
};

for (const role of roles) test(`${role}: every workflow transition is enforced by the server and persists`, async () => {
  const f = fixture(); await f.start();
  for (const from of statuses) for (const to of statuses) {
    if (from === to) continue;
    const id = f.item(from, role);
    const response = await f.call(role, "PATCH", `content/${id}/status`, { status: to, version: 1 });
    const allowed = transitions[role](from, to);
    assert.equal(response.status, allowed ? 200 : 403, `${role}: ${from} -> ${to}: ${JSON.stringify(response.data)}`);
    const saved = (await f.call("Owner", "GET", `content/${id}`)).data.item;
    assert.equal(saved.status, allowed ? to : from);
    assert.equal(saved.version, allowed ? 2 : 1);
  }
  f.sqlite.close();
});

for (const role of roles) test(`${role}: content and administration permissions cannot be bypassed`, async () => {
  const f = fixture(); await f.start();
  const id = f.item("Design", role);
  const manager = ["Owner", "Admin"].includes(role);
  const strategist = manager || role === "Content Strategist";
  const creating = strategist || role === "Creative";
  const create = await f.call(role, "POST", "content", {
    title: "New", brandId: f.brandId(), platform: "Instagram", publishDate: "2026-10-02",
    status: "Idea", priority: "Normal", format: "Post",
  });
  assert.equal(create.status, creating ? 201 : 403);
  if (role === "Creative") assert.equal(create.data.item.assigneeId, f.memberId(role));
  let version = 1;
  for (const field of ["title", "caption", "notes", "publishDate", "platform", "priority", "brief", "targetAudience"]) {
    const allowed = strategist || role === "Creative" || (role === "Designer" && field === "notes") || (role === "Social Media" && ["caption", "platform", "publishDate"].includes(field));
    const value = field === "publishDate" ? "2026-10-03" : field === "priority" ? "High" : "Updated " + field;
    const response = await f.call(role, "PUT", `content/${id}`, { version, [field]: value });
    assert.equal(response.status, allowed ? 200 : 403, `${role} ${field}: ${JSON.stringify(response.data)}`);
    if (allowed) version += 1;
  }
  assert.equal((await f.call(role, "PUT", `content/${id}`, { version, status: "Approved" })).status, manager ? 200 : 403);
  if (manager) version += 1;
  assert.equal((await f.call(role, "PATCH", "workspace", { name: "Renamed", slug: "renamed", timezone: "Asia/Jakarta" })).status, role === "Owner" ? 200 : 403);
  assert.equal((await f.call(role, "POST", "members", { name: "New member", email: `${role.replaceAll(" ", "")}@new.example.com`, role: "Viewer" })).status, manager ? 201 : 403);
  assert.equal((await f.call(role, "POST", "pillars", { brandId: f.brandId(), name: "Test " + role, description: "", objective: "", color: "#123456", active: true })).status, strategist ? 201 : 403);
  assert.equal((await f.call(role, "DELETE", `content/${id}`, { version })).status, manager ? 200 : 403);
  f.sqlite.close();
});

test("relationships, full content fields, server search, filters, and pagination work", async () => {
  const f = fixture(); await f.start();
  assert.equal((await f.call("Admin", "POST", "brands", { name: "Second Brand", description: "", slug: "second-brand", logo: "", timezone: "Asia/Jakarta" })).status, 201);
  const workspace = (await f.call("Owner", "GET", "workspace")).data;
  const secondBrand = workspace.brands.find((x: any) => x.name === "Second Brand");
  assert.equal((await f.call("Content Strategist", "POST", "campaigns", { brandId: secondBrand.id, name: "Launch", description: "", objective: "Awareness", targetAudience: "Founders", startDate: "2026-10-01", endDate: "2026-10-31", ownerMemberId: f.memberId("Content Strategist"), status: "Active" })).status, 201);
  assert.equal((await f.call("Content Strategist", "POST", "pillars", { brandId: secondBrand.id, name: "Education", description: "", objective: "Teach", color: "#334455", active: true })).status, 201);
  const refreshed = (await f.call("Owner", "GET", "workspace")).data;
  const campaign = refreshed.campaigns.find((x: any) => x.name === "Launch");
  const pillar = refreshed.pillars.find((x: any) => x.brandId === secondBrand.id);
  const create = await f.call("Owner", "POST", "content", {
    brandId: secondBrand.id, campaignId: campaign.id, pillarId: pillar.id, title: "Searchable launch",
    objective: "Explain the launch", brief: "Show the main benefit", targetAudience: "Founders", format: "Carousel",
    priority: "High", assigneeId: f.memberId("Creative"), deadline: "2026-10-05", publishDate: "2026-10-08",
    platform: "LinkedIn", status: "Idea", caption: "A distinctive caption", notes: "Private planning note",
  });
  assert.equal(create.status, 201);
  assert.equal(create.data.item.brandId, secondBrand.id);
  assert.equal(create.data.item.campaignId, campaign.id);
  assert.equal(create.data.item.pillarId, pillar.id);
  assert.equal(create.data.item.format, "Carousel");
  assert.equal(create.data.item.creatorName, "Owner Person");
  const search = await f.call("Owner", "GET", `content?query=distinctive&brandId=${secondBrand.id}&campaignId=${campaign.id}&status=Idea&limit=1&offset=0`);
  assert.equal(search.status, 200);
  assert.equal(search.data.total, 1);
  assert.equal(search.data.items[0].title, "Searchable launch");
  assert.equal((await f.call("Owner", "GET", "content?query=does-not-exist&limit=40&offset=0")).data.total, 0);
  f.sqlite.close();
});

test("archiving Brands and Campaigns preserves existing content and blocks new assignment", async () => {
  const f = fixture(); await f.start();
  const data = (await f.call("Owner", "GET", "workspace")).data;
  const brand = data.brands[0];
  const campaign = data.campaigns[0];
  assert.ok(brand && campaign);
  assert.equal((await f.call("Owner", "PATCH", `brands/${brand.id}/archive`, { archived: true })).status, 200);
  assert.equal((await f.call("Owner", "POST", "content", { title: "Blocked", brandId: brand.id, publishDate: "2026-10-02", platform: "Instagram", status: "Idea", priority: "Normal", format: "Post" })).status, 400);
  assert.equal((await f.call("Owner", "GET", "content/42")).data.item.title, "Preserve me");
  assert.equal((await f.call("Owner", "PATCH", `brands/${brand.id}/archive`, { archived: false })).status, 200);
  assert.equal((await f.call("Content Strategist", "PATCH", `campaigns/${campaign.id}/archive`, { archived: true })).status, 200);
  assert.equal((await f.call("Owner", "GET", "content/42")).data.item.campaignId, campaign.id);
  f.sqlite.close();
});

test("Pillar changes and deletion keep content, and activity history records important changes", async () => {
  const f = fixture(); await f.start();
  const payload = { brandId: f.brandId(), name: "New Pillar", description: "Description", objective: "Objective", color: "#0099aa", active: true };
  assert.equal((await f.call("Content Strategist", "POST", "pillars", payload)).status, 201);
  const data = (await f.call("Owner", "GET", "workspace")).data;
  const pillar = data.pillars.find((x: any) => x.name === payload.name);
  assert.equal((await f.call("Owner", "PUT", "content/42", { version: 1, pillarId: pillar.id })).status, 200);
  assert.equal((await f.call("Content Strategist", "PUT", `pillars/${pillar.id}`, { ...payload, name: "Renamed Pillar", active: false })).status, 200);
  let item = (await f.call("Owner", "GET", "content/42")).data.item;
  assert.equal(item.pillar, "Renamed Pillar");
  assert.equal((await f.call("Owner", "DELETE", `pillars/${pillar.id}`, { confirm: true })).status, 200);
  item = (await f.call("Owner", "GET", "content/42")).data.item;
  assert.equal(item.pillarId, null);
  assert.equal(item.caption, "Original caption");
  const history = await f.call("Owner", "GET", "activity?limit=100");
  assert.equal(history.status, 200);
  assert.ok(history.data.activities.some((x: any) => x.action === "pillar_created"));
  assert.ok(history.data.activities.some((x: any) => x.action === "pillar_updated"));
  assert.ok(history.data.activities.some((x: any) => x.action === "pillar_deleted"));
  assert.ok(history.data.activities.some((x: any) => x.action === "content_updated"));
  f.sqlite.close();
});

test("owner protection, role changes, disabling members, review actions, and concurrency remain safe", async () => {
  const f = fixture(); await f.start();
  const owner = f.memberId("Owner"), creative = f.memberId("Creative");
  assert.equal((await f.call("Admin", "PATCH", `members/${owner}`, { role: "Viewer", status: "Inactive" })).status, 403);
  assert.equal((await f.call("Owner", "PATCH", `members/${owner}`, { role: "Viewer", status: "Active" })).status, 403);
  assert.equal((await f.call("Admin", "PATCH", `members/${creative}`, { role: "Owner", status: "Active" })).status, 403);
  assert.equal((await f.call("Admin", "PATCH", `members/${creative}`, { role: "Viewer", status: "Inactive" })).status, 200);
  assert.equal((await f.call("Creative", "GET", "workspace")).status, 403);
  assert.equal((await f.call("Admin", "PATCH", `members/${creative}`, { role: "Viewer", status: "Active" })).status, 200);
  const id = f.item("Design", "Owner");
  assert.equal((await f.call("Owner", "PUT", `content/${id}`, { version: 1, publishDate: "2026-02-30" })).status, 400);
  assert.equal((await f.call("Owner", "PATCH", `content/${id}/status`, { version: 1, status: "Review" })).status, 200);
  assert.equal((await f.call("Owner", "PATCH", `content/${id}/status`, { version: 1, status: "Approved" })).status, 409);
  const rejected = await f.call("Approver", "PATCH", `content/${id}/status`, { version: 2, status: "Revision", decision: "rejected" });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.item.reviewDecision, "rejected");
  assert.ok((f.sqlite.prepare("SELECT COUNT(*) n FROM activity_history WHERE action IN ('member_disabled','member_role_changed','approval_action')").get() as any).n >= 3);
  f.sqlite.close();
});
