"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity as ActivityIcon, ArrowUpRight, BadgeCheck, CalendarDays, Columns3, FileText, FolderOpen, Grid2X2, Layers3, LogOut, Megaphone, Plus, RefreshCw, Settings, ShieldAlert, Tag, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { canCreate, managers, type ContentItem, type WorkspaceData } from "@/lib/hub-types";
import { ActivityView, AllContentView, BrandsView, CalendarView, CampaignsView, Choice, Confirm, ContentEditor, ContentTable, EmptyState, PillarsView, StatusBadge, TeamView, WorkspaceSettings } from "./hub-views";
import { Kanban } from "./kanban";
import { ContentWorkspace, MediaLibraryView } from "./milestone-two";
import { ApprovalsView } from "./milestone-three";

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/hub/" + path, {
    method, cache: "no-store", credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || "Unable to complete this action.", response.status);
  return data;
}

export type View = "dashboard" | "brand" | "pillars" | "campaigns" | "plan" | "calendar" | "content" | "media" | "approvals" | "activity" | "team" | "settings" | "detail";
const nav = [
  ["dashboard", "Dashboard", Grid2X2], ["plan", "Content Plan", Layers3], ["calendar", "Calendar", CalendarDays],
  ["content", "All Content", FileText], ["media", "Media Library", FolderOpen], ["brand", "Brands", Tag], ["pillars", "Content Pillars", Columns3],
  ["campaigns", "Campaigns", Megaphone], ["approvals", "Approvals", BadgeCheck], ["activity", "Activity", ActivityIcon],
] as const;
const titles: Record<View, [string, string]> = {
  dashboard: ["Dashboard", "What is moving, what is ready, and what needs attention."],
  plan: ["Content Plan", "Drag cards between stages. Every change is saved."],
  calendar: ["Calendar", "Manage planned publishing dates. Publishing remains manual."],
  content: ["All Content", "Search and filter the complete content library."],
  media: ["Media Library", "Upload, organize, preview, and reuse creative files."],
  brand: ["Brands", "The identities behind your Campaigns, Pillars, and Content."],
  pillars: ["Content Pillars", "Organize each Brand around clear, repeatable themes."],
  campaigns: ["Campaigns", "Connect individual posts to a defined initiative."],
  approvals: ["Approvals", "See what is waiting for review and the decisions already made."],
  activity: ["Activity", "A simple history of important workspace changes."],
  team: ["Team members", "Manage workspace access and responsibilities."],
  settings: ["Workspace settings", "The shared home for your creative work."],
  detail: ["Content workspace", "Shape the brief, copy, platform versions, assets, and approval."],
};

export const dateLabel = (date: string) => date ? new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not set";
export const initials = (name: string) => name.split(/[ @]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();

export default function CreativeHub({ user, signOutHref, initialContentId = null }: { user: { name: string; email: string }; signOutHref: string; initialContentId?: number | null }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [view, setView] = useState<View>(initialContentId ? "detail" : "dashboard");
  const [detailId, setDetailId] = useState<number | null>(initialContentId);
  const [editor, setEditor] = useState<ContentItem | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContentItem | null>(null);
  const [busyIds, setBusyIds] = useState<number[]>([]);
  const busyRef = useRef(new Set<number>());
  const reload = useCallback(async () => {
    try {
      const next = await api<WorkspaceData>("workspace");
      setData(next); setError(""); setAccessDenied(false); return next;
    } catch (e) {
      const issue = e as ApiError;
      setError(issue.message); setAccessDenied(issue.status === 403); throw e;
    }
  }, []);
  useEffect(() => {
    let active = true;
    void api<WorkspaceData>("workspace").then(next => {
      if (active) { setData(next); setError(""); setAccessDenied(false); }
    }).catch((issue: ApiError) => {
      if (active) { setError(issue.message); setAccessDenied(issue.status === 403); }
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const sync = () => {
      const match = location.pathname.match(/^\/content\/(\d+)$/);
      if (match) { setDetailId(Number(match[1])); setView("detail"); return; }
      const name = location.hash.slice(1) as View;
      setDetailId(null); setView(name in titles && name !== "detail" ? name : "dashboard");
    };
    sync(); window.addEventListener("hashchange", sync); window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);
  function navigate(next: Exclude<View, "detail">) { setDetailId(null); setView(next); window.history.pushState(null, "", "/#" + next); }
  function openDetail(item: ContentItem) { setDetailId(item.id); setView("detail"); window.history.pushState(null, "", "/content/" + item.id); }
  function openDetailId(id: number) { setDetailId(id); setView("detail"); window.history.pushState(null, "", "/content/" + id); }
  async function move(item: ContentItem, status: ContentItem["status"], decision?: string) {
    if (busyRef.current.has(item.id)) return;
    busyRef.current.add(item.id); setBusyIds([...busyRef.current]);
    setData(current => current && ({ ...current, items: current.items.map(x => x.id === item.id ? { ...x, status } : x) }));
    try {
      const result = await api<{ item: ContentItem }>("content/" + item.id + "/status", "PATCH", { status, version: item.version, ...(decision ? { decision } : {}) });
      setData(current => current && ({ ...current, items: current.items.map(x => x.id === item.id ? result.item : x) }));
      toast.success(decision === "rejected" ? "Content rejected and returned to Revision" : "Moved to " + status);
    } catch (e) {
      setData(current => current && ({ ...current, items: current.items.map(x => x.id === item.id ? item : x) }));
      toast.error((e as Error).message); void reload().catch(() => {}); throw e;
    } finally { busyRef.current.delete(item.id); setBusyIds([...busyRef.current]); }
  }
  async function saveContent(payload: Record<string, unknown>) {
    const result = await api<{ item: ContentItem }>(editor === "new" ? "content" : "content/" + (editor as ContentItem).id, editor === "new" ? "POST" : "PUT", payload);
    setData(current => current && ({ ...current, items: [...current.items.filter(x => x.id !== result.item.id), result.item].sort((a, b) => a.publishDate.localeCompare(b.publishDate)) }));
    setEditor(null); toast.success("Content saved");
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: { signal: AbortSignal }) => Promise<void> | void } }).modelContext;
    if (!context) return;
    const controller = new AbortController();
    const tools = [{
      name: "list_content_items", description: "Read content visible to the current workspace member.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => api("content?limit=100"),
    }, {
      name: "move_content_card", description: "Save a workflow status change when the current member has permission.",
      inputSchema: { type: "object", properties: { id: { type: "integer" }, version: { type: "integer" }, status: { type: "string", enum: ["Idea", "Writing", "Design", "Review", "Revision", "Approved", "Scheduled"] } }, required: ["id", "version", "status"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input: unknown) => { const value = input as { id: number; version: number; status: string }; if (!Number.isInteger(value?.id) || !Number.isInteger(value?.version)) throw new Error("Valid id and version are required."); const result = await api<{ item: ContentItem }>("content/" + value.id + "/status", "PATCH", { status: value.status, version: value.version }); await reload(); return { id: result.item.id, status: result.item.status, version: result.item.version }; },
    }];
    for (const tool of tools) { try { void Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {}); } catch {} }
    return () => controller.abort();
  }, [reload]);

  if (accessDenied && !data) return <main className="access-denied"><div className="access-denied-card"><span className="access-icon"><ShieldAlert/></span><h1>Workspace access required</h1><p>You are signed in as <strong>{user.email}</strong>, but this email is not an active member of Creative Hub.</p><p>Ask the workspace Owner or Admin to add this exact email address.</p><a className="login-button" href={signOutHref} target="_top">Sign out and use another account</a></div></main>;

  const actor = data?.actor;
  const refreshKey = data?.items.map(x => `${x.id}:${x.version}`).join("|") ?? "";
  return <SidebarProvider style={{ "--sidebar-width": "218px" } as React.CSSProperties}>
    <Sidebar><SidebarHeader className="hub-sidebar-header"><div className="brand-lockup"><span className="brand-mark"><Layers3 size={20}/></span><span>Creative Hub</span></div><p className="workspace-label">{data?.workspace.name || "Content workspace"}</p></SidebarHeader><SidebarContent><Nav view={view} navigate={navigate} manage={!!actor && managers(actor.role)} owner={actor?.role === "Owner"}/></SidebarContent><SidebarFooter className="hub-profile"><div className="avatar">{initials(actor?.name || user.name)}</div><div className="profile-copy"><strong>{actor?.name || user.name}</strong><span>{actor?.role || "Workspace member"}</span></div><a href={signOutHref} target="_top" aria-label="Log out" title="Log out"><LogOut size={17}/></a></SidebarFooter></Sidebar>
    <SidebarInset className="hub-main"><header className="hub-topbar"><div className="topbar-location"><SidebarTrigger/><span>{data?.workspace.name || "Creative Hub"}</span><span className="slash">/</span><strong>{titles[view][0]}</strong></div><div className="topbar-actions"><span className="private-label">Member-protected</span>{actor && canCreate(actor.role) && <Button onClick={() => setEditor("new")}><Plus size={16}/>New content</Button>}</div></header><div className="hub-page">{view !== "detail" && <div className="page-heading"><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div>{view === "dashboard" && <Button variant="outline" onClick={() => navigate("plan")}>Open content plan<ArrowUpRight size={16}/></Button>}</div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><Button variant="outline" onClick={() => void reload().catch(() => {})}><RefreshCw size={15}/>Retry</Button></div>}
      {!data && !error && <div className="loading-grid" aria-label="Loading workspace"><Skeleton className="h-28"/><Skeleton className="h-28"/><Skeleton className="h-28"/><Skeleton className="h-28"/><Skeleton className="col-span-full h-80"/></div>}
      {data && <>{view === "dashboard" && <Dashboard data={data} navigate={navigate} open={openDetail}/>} {view === "plan" && <Kanban data={data} open={openDetail} move={move} busyIds={busyIds}/>} {view === "content" && <AllContentView data={data} open={openDetail} remove={setDeleteTarget} refreshKey={refreshKey}/>} {view === "calendar" && <CalendarView data={data} open={openDetail}/>} {view === "media" && <MediaLibraryView data={data}/>} {view === "pillars" && <PillarsView data={data} reload={reload}/>} {view === "brand" && <BrandsView data={data} reload={reload}/>} {view === "campaigns" && <CampaignsView data={data} reload={reload}/>} {view === "approvals" && <ApprovalsView open={openDetailId}/>} {view === "activity" && <ActivityView/>} {view === "team" && <TeamView data={data} reload={reload}/>} {view === "settings" && <WorkspaceSettings data={data} reload={reload}/>} {view === "detail" && detailId && <ContentWorkspace contentId={detailId} data={data} back={() => navigate("content")} changed={reload}/>}</>}
    </div></SidebarInset>
    {data && editor && <ContentEditor key={editor === "new" ? "new" : editor.id + ":" + editor.version} item={editor === "new" ? null : editor} data={data} close={() => setEditor(null)} save={saveContent}/>}<Confirm open={!!deleteTarget} close={() => setDeleteTarget(null)} title="Delete this content?" description={deleteTarget ? "“" + deleteTarget.title + "” will be permanently removed. An activity record will remain." : ""} label="Delete content" action={async () => { await api("content/" + deleteTarget!.id, "DELETE", { version: deleteTarget!.version }); setDeleteTarget(null); await reload(); toast.success("Content deleted"); }}/><Toaster theme="light" position="top-right" richColors/>
  </SidebarProvider>;
}

function Nav({ view, navigate, manage, owner }: { view: View; navigate: (view: Exclude<View, "detail">) => void; manage: boolean; owner: boolean }) {
  const { setOpenMobile } = useSidebar();
  const go = (next: Exclude<View, "detail">) => { navigate(next); setOpenMobile(false); };
  return <nav className="hub-navigation" aria-label="Main navigation"><p>WORKSPACE</p><SidebarMenu>{nav.map(([next, label, Icon]) => <SidebarMenuItem key={next}><SidebarMenuButton isActive={next === view} onClick={() => go(next)}><Icon/><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>{manage && <><p className="nav-settings-label">SETTINGS</p><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive={view === "team"} onClick={() => go("team")}><Users/><span>Team members</span></SidebarMenuButton></SidebarMenuItem>{owner && <SidebarMenuItem><SidebarMenuButton isActive={view === "settings"} onClick={() => go("settings")}><Settings/><span>Workspace</span></SidebarMenuButton></SidebarMenuItem>}</SidebarMenu></>}</nav>;
}

function Dashboard({ data, navigate, open }: { data: WorkspaceData; navigate: (view: Exclude<View, "detail">) => void; open: (item: ContentItem) => void }) {
  const [brandId, setBrandId] = useState("all");
  const [campaignId, setCampaignId] = useState("all");
  const today = new Date().toLocaleDateString("en-CA");
  const horizon = new Date(); horizon.setDate(horizon.getDate() + 14);
  const until = horizon.toLocaleDateString("en-CA");
  const items = data.items.filter(x => (brandId === "all" || String(x.brandId) === brandId) && (campaignId === "all" || String(x.campaignId) === campaignId));
  const campaigns = data.campaigns.filter(x => brandId === "all" || String(x.brandId) === brandId);
  const metrics = [
    ["Ideas", items.filter(x => x.status === "Idea").length, "Waiting to be shaped"],
    ["Production", items.filter(x => ["Writing", "Design", "Revision"].includes(x.status)).length, "Writing, design, or revision"],
    ["Review", items.filter(x => x.status === "Review").length, "Waiting for a decision"],
    ["Approved", items.filter(x => x.status === "Approved").length, "Ready for scheduling"],
    ["Scheduled", items.filter(x => x.status === "Scheduled").length, "Planned by the team"],
  ];
  const upcoming = items.filter(x => x.publishDate >= today && x.publishDate <= until).sort((a, b) => a.publishDate.localeCompare(b.publishDate)).slice(0, 8);
  const needsAttention = items.filter(x => x.status === "Review" || (!!x.deadline && x.deadline < today && !["Approved", "Scheduled"].includes(x.status)) || !x.brandId || !x.platform || !x.pic || (x.status === "Scheduled" && !x.caption)).slice(0, 8);
  return <><div className="dashboard-filters"><Choice label="Filter dashboard by Brand" value={brandId} options={[{ value: "all", label: "All Brands" }, ...data.brands.map(x => ({ value: String(x.id), label: x.name }))]} onChange={v => { setBrandId(v); setCampaignId("all"); }}/><Choice label="Filter dashboard by Campaign" value={campaignId} options={[{ value: "all", label: "All Campaigns" }, ...campaigns.map(x => ({ value: String(x.id), label: x.name }))]} onChange={setCampaignId}/></div><div className="metrics metrics-five">{metrics.map(([label, count, detail], i) => <div className="metric" key={label}><div><span className={"metric-icon metric-" + i}>{[<FileText key="f"/>, <Layers3 key="l"/>, <Columns3 key="c"/>, <Tag key="t"/>, <CalendarDays key="d"/>][i]}</span><span>{label}</span></div><strong>{count}</strong><p>{detail}</p></div>)}</div><div className="dashboard-grid"><section className="panel"><div className="panel-heading"><h2>Upcoming · next 14 days</h2><Button variant="ghost" size="sm" onClick={() => navigate("calendar")}>Open Calendar<ArrowUpRight size={15}/></Button></div><ContentTable items={upcoming} actor={data.actor} open={open} compact/></section><section className="panel"><div className="panel-heading"><h2>Needs attention</h2><Button variant="ghost" size="sm" onClick={() => navigate("content")}>View all<ArrowUpRight size={15}/></Button></div>{needsAttention.length ? <div className="attention-list">{needsAttention.map(item => <button key={item.id} onClick={() => open(item)}><div><strong>{item.title}</strong><span>{item.status === "Review" ? "Waiting for review" : item.deadline && item.deadline < today ? "Past deadline" : item.status === "Scheduled" && !item.caption ? "Scheduled without caption" : "Missing important information"}</span></div><StatusBadge status={item.status}/></button>)}</div> : <EmptyState title="Nothing needs attention" description="No review, overdue, or incomplete items match these filters."/>}</section></div>{!items.length && <EmptyState title="A fresh start for your content" description="Add your first idea using New content."/>}</>;
}
