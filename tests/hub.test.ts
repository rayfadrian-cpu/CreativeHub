/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleHub } from "../db/hub-service.ts";
import { roles, statuses, type Role } from "../lib/hub-types.ts";

let fixtureSequence = 0;

function fixture() {
  const fixtureId = ++fixtureSequence;
  const sqlite = new DatabaseSync(":memory:");
  const objects = new Map<string, { bytes: Uint8Array; httpEtag: string }>();
  const bucket = {
    async put(key: string, value: BodyInit) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      const httpEtag = `\"${bytes.length}-${key.length}\"`;
      objects.set(key, { bytes, httpEtag });
      return { key, size: bytes.length, httpEtag };
    },
    async get(key: string) {
      const object = objects.get(key);
      return object ? { body: object.bytes, httpEtag: object.httpEtag } : null;
    },
    async delete(key: string) { objects.delete(key); },
  } as unknown as R2Bucket;
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
  const identity = (role: string) => ({ userId: `${fixtureId}-${role}-user`, email: role.replaceAll(" ", "").toLowerCase() + "@example.com", displayName: role + " Person" });
  async function call(role: string | null, method: string, path: string, payload?: any, headers: Record<string, string> = {}) {
    const request = new Request("https://creative.test/api/hub/" + path, {
      method,
      headers: { origin: "https://creative.test", ...headers },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const response = await handleHub(request, path.split("?")[0].split("/"), { db, bucket, identity: role ? identity(role) : null, ownerEmail: "owner@example.com" });
    return { status: response.status, data: await response.json() as any };
  }
  async function upload(role: string, fileName: string, mimeType: string, bytes: Uint8Array) {
    const request = new Request(`https://creative.test/api/hub/media/upload?fileName=${encodeURIComponent(fileName)}`, {
      method: "POST",
      headers: {
        origin: "https://creative.test", "content-type": mimeType, "content-length": String(bytes.byteLength),
      },
      body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    });
    const response = await handleHub(request, ["media", "upload"], { db, bucket, identity: identity(role), ownerEmail: "owner@example.com" });
    return { status: response.status, data: await response.json() as any };
  }
  async function file(role: string, assetId: number) {
    const request = new Request(`https://creative.test/api/hub/media/${assetId}/file`, {
      headers: { origin: "https://creative.test" },
    });
    return handleHub(request, ["media", String(assetId), "file"], { db, bucket, identity: identity(role), ownerEmail: "owner@example.com" });
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
    const id = Number(result.lastInsertRowid);
    if (["Review", "Approved", "Scheduled"].includes(status)) {
      sqlite.prepare(`INSERT INTO approvals
        (workspace_id, content_id, requested_by_member_id, status, content_version, submission_note,
         decision_by_member_id, decision_note, decided_at)
        VALUES ('main', ?, ?, ?, ?, 'Fixture review', ?, ?, ?)`)
        .run(id, memberId("Owner"), status === "Review" ? "pending" : "approved",
          status === "Review" ? 1 : 0,
          status === "Review" ? null : memberId("Owner"), status === "Review" ? "" : "Fixture approval",
          status === "Review" ? "" : "2026-09-25 00:00:00");
    }
    return id;
  }
  return { sqlite, objects, call, upload, file, start, memberId, brandId, pillarId, item };
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
  assert.equal((f.sqlite.prepare("SELECT model_version FROM workspaces WHERE id = 'main'").get() as any).model_version, 4);
  const variant = f.sqlite.prepare("SELECT platform, title, caption, notes FROM content_platform_variants WHERE content_id = 42").get() as any;
  assert.deepEqual([variant.platform, variant.title, variant.caption, variant.notes], ["Instagram", "Preserve me", "Original caption", ""]);
  assert.equal((f.sqlite.prepare("SELECT COUNT(*) n FROM collections").get() as any).n, 0);
  assert.equal((await f.call("Owner", "PUT", "content/42", { version: 1, title: "Bad origin" }, { origin: "https://evil.test" })).status, 403);
  assert.equal((await f.call("Viewer", "GET", "workspace")).data.members[0].email, "");
  assert.ok((f.sqlite.prepare("SELECT COUNT(*) n FROM activity_history WHERE action = 'workspace_migrated'").get() as any).n >= 1);
  f.sqlite.close();
});

test("Milestone 3 backfill preserves an existing Review and makes its approval actionable", async () => {
  const f = fixture();
  f.sqlite.prepare("UPDATE content_items SET status = 'Review', version = 7 WHERE id = 42").run();
  await f.start();
  const pending = f.sqlite.prepare("SELECT status, content_version FROM approvals WHERE content_id = 42").get() as any;
  assert.deepEqual([pending.status, pending.content_version], ["pending", 7]);
  const approved = await f.call("Approver", "POST", "content/42/approval/decide", { version: 7, decision: "approved", note: "Migrated review approved." });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.item.version, 8);
  assert.equal((await f.call("Social Media", "PATCH", "content/42/status", { version: 8, status: "Scheduled" })).status, 200);
  f.sqlite.close();
});

const transitions: Record<Role, (from: string, to: string) => boolean> = {
  Owner: (from, to) => to !== "Approved" && !(from === "Review" && to === "Revision") && !(to === "Review" && ["Approved", "Scheduled"].includes(from)) && (to !== "Scheduled" || from === "Approved"),
  Admin: (from, to) => to !== "Approved" && !(from === "Review" && to === "Revision") && !(to === "Review" && ["Approved", "Scheduled"].includes(from)) && (to !== "Scheduled" || from === "Approved"),
  "Content Strategist": (from, to) => !(from === "Review" && to === "Revision") && !["Approved", "Scheduled"].includes(from) && !["Approved", "Scheduled"].includes(to),
  Creative: (from, to) => !(from === "Review" && to === "Revision") && !["Approved", "Scheduled"].includes(from) && !["Approved", "Scheduled"].includes(to),
  Designer: (from, to) => ["Design", "Review"].includes(from) && ["Design", "Review"].includes(to),
  "Social Media": (from, to) => from === "Approved" && to === "Scheduled",
  Approver: () => false,
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
  assert.equal((await f.call(role, "PUT", `content/${id}`, { version, status: "Approved" })).status, 403);
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
  assert.equal((await f.call("Approver", "PATCH", `content/${id}/status`, { version: 2, status: "Revision" })).status, 403);
  const rejected = await f.call("Approver", "POST", `content/${id}/approval/decide`, { version: 2, decision: "rejected", note: "The claim needs evidence." });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.item.reviewDecision, "rejected");
  assert.ok((f.sqlite.prepare("SELECT COUNT(*) n FROM activity_history WHERE action IN ('member_disabled','member_role_changed','content_rejected')").get() as any).n >= 3);
  f.sqlite.close();
});

test("content workspace returns every Milestone 2 section and keeps record visibility rules", async () => {
  const f = fixture(); await f.start();
  const creativeItem = f.item("Writing", "Creative");
  const owner = await f.call("Owner", "GET", `content/${creativeItem}/workspace`);
  assert.equal(owner.status, 200);
  assert.equal(owner.data.item.id, creativeItem);
  assert.deepEqual(owner.data.variants, []);
  assert.deepEqual(owner.data.assets, []);
  assert.deepEqual(owner.data.comments, []);
  assert.ok(Array.isArray(owner.data.approvals));
  assert.ok(Array.isArray(owner.data.statusHistory));
  assert.equal(owner.data.permissions.comment, true);
  assert.equal(owner.data.permissions.manageAssets, true);
  const viewer = await f.call("Viewer", "GET", `content/${creativeItem}/workspace`);
  assert.equal(viewer.status, 200);
  assert.equal(viewer.data.permissions.manageAssets, false);
  assert.equal(viewer.data.permissions.manageVariants, false);
  assert.equal((await f.call("Designer", "GET", `content/${creativeItem}/workspace`)).status, 403);
  const designerItem = f.item("Design", "Designer");
  assert.equal((await f.call("Designer", "GET", `content/${designerItem}/workspace`)).status, 200);
  f.sqlite.close();
});

test("platform versions can be created and edited with concurrency, permissions, and activity history", async () => {
  const f = fixture(); await f.start();
  const id = f.item("Writing", "Creative");
  const payload = {
    platform: "TikTok", title: "TikTok cut", caption: "Opening caption", description: "Vertical edit",
    hashtags: "#launch", cta: "Follow us", notes: "Keep it short", plannedPublishAt: "2026-10-04T09:30", status: "Writing",
  };
  assert.equal((await f.call("Viewer", "POST", `content/${id}/variants`, payload)).status, 403);
  const created = await f.call("Social Media", "POST", `content/${id}/variants`, payload);
  assert.equal(created.status, 201);
  assert.equal(created.data.variant.platform, "TikTok");
  assert.equal(created.data.variant.caption, "Opening caption");
  const variantId = created.data.variant.id;
  assert.equal((await f.call("Owner", "PUT", `variants/${variantId}`, { ...payload, version: 99, caption: "Stale" })).status, 409);
  const edited = await f.call("Social Media", "PUT", `variants/${variantId}`, { ...payload, version: 1, caption: "Final caption", status: "Review" });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.variant.caption, "Final caption");
  assert.equal(edited.data.variant.version, 2);
  assert.equal((await f.call("Owner", "POST", `content/${id}/variants`, payload)).status, 409);
  const workspace = await f.call("Owner", "GET", `content/${id}/workspace`);
  assert.equal(workspace.data.variants[0].plannedPublishAt, "2026-10-04T09:30");
  assert.ok(workspace.data.activities.some((x: any) => x.action === "platform_variant_created"));
  assert.ok(workspace.data.activities.some((x: any) => x.action === "platform_variant_edited"));
  f.sqlite.close();
});

test("Media Library upload, private preview, search, rename, and role restrictions work", async () => {
  const f = fixture(); await f.start();
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  assert.equal((await f.upload("Viewer", "blocked.png", "image/png", bytes)).status, 403);
  assert.equal((await f.upload("Approver", "blocked.png", "image/png", bytes)).status, 403);
  const uploaded = await f.upload("Designer", "launch-cover.png", "image/png", bytes);
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.data.asset.kind, "image");
  assert.equal(uploaded.data.asset.fileSize, bytes.length);
  const id = uploaded.data.asset.id;
  const preview = await f.file("Viewer", id);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), bytes);
  const search = await f.call("Viewer", "GET", "media?query=cover&kind=image");
  assert.equal(search.status, 200);
  assert.equal(search.data.assets.length, 1);
  assert.equal((await f.call("Creative", "PUT", `media/${id}`, { fileName: "not-allowed.png" })).status, 403);
  const renamed = await f.call("Designer", "PUT", `media/${id}`, { fileName: "final-cover.png" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.asset.fileName, "final-cover.png");
  assert.ok((f.sqlite.prepare("SELECT COUNT(*) n FROM activity_history WHERE action IN ('asset_uploaded','file_renamed')").get() as any).n >= 2);
  f.sqlite.close();
});

test("master assets attach, detach, reorder, and block unsafe Media Library deletion", async () => {
  const f = fixture(); await f.start();
  const id = f.item("Design", "Designer");
  const first = await f.upload("Owner", "main.png", "image/png", new Uint8Array([1, 2, 3]));
  const second = await f.upload("Owner", "reference.pdf", "application/pdf", new Uint8Array([4, 5, 6, 7]));
  const firstId = first.data.asset.id, secondId = second.data.asset.id;
  const attachedFirst = await f.call("Owner", "POST", `content/${id}/assets`, { mediaAssetId: firstId, usage: "Main Asset" });
  const attachedSecond = await f.call("Designer", "POST", `content/${id}/assets`, { mediaAssetId: secondId, usage: "Reference" });
  assert.equal(attachedFirst.status, 201);
  assert.equal(attachedSecond.status, 201);
  assert.equal((await f.call("Owner", "DELETE", `media/${firstId}`)).status, 409);
  const ids = attachedSecond.data.assets.map((asset: any) => asset.linkId).reverse();
  const reordered = await f.call("Owner", "PATCH", `content/${id}/assets/reorder`, { ids });
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.data.assets.map((asset: any) => asset.linkId), ids);
  const linkId = reordered.data.assets.find((asset: any) => asset.id === firstId).linkId;
  assert.equal((await f.call("Viewer", "DELETE", `content/${id}/assets/${linkId}`)).status, 403);
  assert.equal((await f.call("Owner", "DELETE", `content/${id}/assets/${linkId}`)).status, 200);
  assert.equal((await f.call("Owner", "DELETE", `media/${firstId}`)).status, 200);
  assert.equal(f.objects.size, 1);
  assert.ok((f.sqlite.prepare("SELECT COUNT(*) n FROM activity_history WHERE action IN ('asset_attached','assets_reordered','asset_detached','file_deleted')").get() as any).n >= 5);
  f.sqlite.close();
});

test("platform-version assets stay linked independently and preserve Media Library files on variant deletion", async () => {
  const f = fixture(); await f.start();
  const id = f.item("Writing", "Creative");
  const upload = await f.upload("Creative", "vertical.mp4", "video/mp4", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
  const created = await f.call("Creative", "POST", `content/${id}/variants`, {
    platform: "Instagram", title: "Reel", caption: "Caption", description: "", hashtags: "", cta: "", notes: "",
    plannedPublishAt: "", status: "Writing",
  });
  const variantId = created.data.variant.id;
  const attached = await f.call("Creative", "POST", `variants/${variantId}/assets`, { mediaAssetId: upload.data.asset.id, usage: "Main Asset" });
  assert.equal(attached.status, 201);
  assert.equal(attached.data.assets[0].fileName, "vertical.mp4");
  assert.equal((await f.call("Owner", "DELETE", `media/${upload.data.asset.id}`)).status, 409);
  assert.equal((await f.call("Owner", "DELETE", `variants/${variantId}`)).status, 200);
  const library = await f.call("Viewer", "GET", "media?kind=video");
  assert.equal(library.data.assets.length, 1);
  assert.equal(library.data.assets[0].attachmentCount, 0);
  assert.equal((await f.call("Owner", "DELETE", `media/${upload.data.asset.id}`)).status, 200);
  f.sqlite.close();
});

test("discussion comments, replies, resolving, permissions, and activity history work", async () => {
  const f = fixture(); await f.start();
  const id = f.item("Writing", "Creative");
  assert.equal((await f.call("Viewer", "POST", `content/${id}/comments`, { body: "Blocked" })).status, 403);
  const root = await f.call("Creative", "POST", `content/${id}/comments`, { body: "Please check the opening line." });
  assert.equal(root.status, 201);
  assert.equal(root.data.comments.length, 1);
  assert.equal(root.data.comments[0].authorName, "Creative Person");
  const commentId = root.data.comments[0].id;
  const reply = await f.call("Approver", "POST", `content/${id}/comments`, { body: "I will review it today.", parentId: commentId });
  assert.equal(reply.status, 201);
  assert.equal(reply.data.comments[1].parentId, commentId);
  assert.equal((await f.call("Viewer", "PATCH", `comments/${commentId}/resolve`, { resolved: true })).status, 403);
  const resolved = await f.call("Creative", "PATCH", `comments/${commentId}/resolve`, { resolved: true });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.data.comments[0].resolved, 1);
  assert.equal(resolved.data.comments[0].resolvedByName, "Creative Person");
  const reopened = await f.call("Approver", "PATCH", `comments/${commentId}/resolve`, { resolved: false });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.comments[0].resolved, 0);
  const workspace = await f.call("Viewer", "GET", `content/${id}/workspace`);
  assert.equal(workspace.status, 200);
  assert.equal(workspace.data.comments.length, 2);
  assert.ok((f.sqlite.prepare("SELECT COUNT(*) n FROM activity_history WHERE action IN ('comment_added','comment_replied','comment_resolved','comment_reopened')").get() as any).n >= 4);
  f.sqlite.close();
});

test("approval requests require roles and notes, record decisions, and gate scheduling", async () => {
  const f = fixture(); await f.start();
  assert.equal((await f.call("Owner", "POST", "content", {
    title: "Cannot skip approval", brandId: f.brandId(), publishDate: "2026-10-02",
    platform: "Instagram", status: "Scheduled", priority: "Normal", format: "Post",
  })).status, 403);
  const id = f.item("Design", "Creative");
  assert.equal((await f.call("Social Media", "POST", `content/${id}/approval/submit`, { version: 1, note: "Ready" })).status, 403);
  const submitted = await f.call("Creative", "POST", `content/${id}/approval/submit`, { version: 1, note: "Please check the final layout." });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.item.status, "Review");
  assert.equal(submitted.data.item.version, 2);
  assert.equal((await f.call("Owner", "PUT", `content/${id}`, { version: 2, title: "Changed during review" })).status, 403);
  assert.equal((await f.call("Owner", "PATCH", `content/${id}/status`, { version: 2, status: "Approved" })).status, 403);
  assert.equal((await f.call("Approver", "POST", `content/${id}/approval/decide`, { version: 2, decision: "revision", note: "" })).status, 400);
  assert.equal((await f.call("Viewer", "POST", `content/${id}/approval/decide`, { version: 2, decision: "revision", note: "Not allowed" })).status, 403);
  const revision = await f.call("Approver", "POST", `content/${id}/approval/decide`, { version: 2, decision: "revision", note: "Increase the headline contrast." });
  assert.equal(revision.status, 200);
  assert.equal(revision.data.item.status, "Revision");
  assert.equal(revision.data.item.reviewDecision, "revision");
  const resubmitted = await f.call("Creative", "POST", `content/${id}/approval/submit`, { version: 3, note: "Contrast updated." });
  assert.equal(resubmitted.status, 200);
  const approved = await f.call("Approver", "POST", `content/${id}/approval/decide`, { version: 4, decision: "approved", note: "Ready to schedule." });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.item.status, "Approved");
  const scheduled = await f.call("Social Media", "PATCH", `content/${id}/status`, { version: 5, status: "Scheduled" });
  assert.equal(scheduled.status, 200);
  assert.equal(scheduled.data.item.status, "Scheduled");
  const records = f.sqlite.prepare("SELECT status, decision_note FROM approvals WHERE content_id = ? ORDER BY id").all(id) as any[];
  assert.deepEqual(records.map(x => x.status), ["revision", "approved"]);
  assert.equal(records[0].decision_note, "Increase the headline contrast.");
  assert.ok((f.sqlite.prepare("SELECT COUNT(*) n FROM content_status_history WHERE content_id = ?").get(id) as any).n >= 5);
  const unapproved = f.item("Idea", "Creative");
  f.sqlite.prepare("UPDATE content_items SET status = 'Approved' WHERE id = ?").run(unapproved);
  assert.equal((await f.call("Social Media", "PATCH", `content/${unapproved}/status`, { version: 1, status: "Scheduled" })).status, 409);
  assert.ok((f.sqlite.prepare("SELECT COUNT(*) n FROM activity_history WHERE action IN ('review_requested','revision_requested','content_approved')").get() as any).n >= 4);
  f.sqlite.close();
});

test("approval queue is workspace-scoped and returns pending reviews with content details", async () => {
  const f = fixture(); await f.start();
  const creativeId = f.item("Design", "Creative");
  const designerId = f.item("Design", "Designer");
  assert.equal((await f.call("Creative", "POST", `content/${creativeId}/approval/submit`, { version: 1, note: "Creative ready" })).status, 200);
  assert.equal((await f.call("Designer", "POST", `content/${designerId}/approval/submit`, { version: 1, note: "Design ready" })).status, 200);
  const approver = await f.call("Approver", "GET", "approvals?status=pending");
  assert.equal(approver.status, 200);
  assert.equal(approver.data.approvals.length, 2);
  assert.ok(approver.data.approvals.every((record: any) => record.contentTitle === "Test card" && record.contentStatus === "Review"));
  const designer = await f.call("Designer", "GET", "approvals?status=pending");
  assert.equal(designer.data.approvals.length, 1);
  assert.equal(designer.data.approvals[0].contentId, designerId);
  f.sqlite.close();
});
