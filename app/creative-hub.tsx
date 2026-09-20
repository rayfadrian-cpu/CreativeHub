"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Grid2X2, Tag, Columns3, Megaphone, CalendarDays, FileText, Layers3, Plus, LogOut, Users, Settings, Search, ArrowUpRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { canCreate, managers, type ContentItem, type WorkspaceData } from "@/lib/hub-types";
import { ContentEditor, ContentTable, CalendarView, CollectionsView, PillarsView, TeamView, WorkspaceSettings, EmptyState, Confirm, StatusBadge } from "./hub-views";
import { Kanban } from "./kanban";

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/hub/" + path, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Unable to complete this action.");
  return data;
}
export type View = "dashboard" | "brand" | "pillars" | "campaigns" | "plan" | "calendar" | "content" | "team" | "settings";
const nav = [
  ["dashboard", "Dashboard", Grid2X2], ["plan", "Content Plan", Layers3], ["calendar", "Calendar", CalendarDays], ["content", "All Content", FileText],
  ["brand", "Brand", Tag], ["pillars", "Content Pillars", Columns3], ["campaigns", "Campaigns", Megaphone],
] as const;
const titles: Record<View, [string, string]> = {
  dashboard: ["Dashboard", "Your content, from first idea to ready to publish."],
  plan: ["Content Plan", "Drag cards between stages. Every change is saved."],
  calendar: ["Calendar", "Keep your publishing dates in view."],
  content: ["All Content", "Find, review, and update your content."],
  brand: ["Brand", "The identity behind your content."],
  pillars: ["Content Pillars", "Organize your content around clear, repeatable themes."],
  campaigns: ["Campaigns", "Connect individual posts to a bigger story."],
  team: ["Team members", "Manage workspace access and responsibilities."],
  settings: ["Workspace settings", "The shared home for your creative work."],
};
export const dateLabel = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const initials = (name: string) => name.split(/[ @]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();

export default function CreativeHub({ user, signOutHref }: { user: { name: string; email: string }; signOutHref: string }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<ContentItem | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContentItem | null>(null);
  const [busyIds, setBusyIds] = useState<number[]>([]);
  const busyRef = useRef(new Set<number>());
  const reload = useCallback(async () => {
    try { const next = await api("workspace"); setData(next); setError(""); return next as WorkspaceData; }
    catch (e) { const message = (e as Error).message; setError(message); throw e; }
  }, []);
  useEffect(() => { void reload().catch(() => {}); }, [reload]);
  useEffect(() => {
    const sync = () => { const name = location.hash.slice(1) as View; if (name in titles) setView(name); };
    sync(); window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync);
  }, []);
  function navigate(next: View) { setView(next); window.history.replaceState(null, "", "#" + next); }
  async function move(item: ContentItem, status: ContentItem["status"], decision?: string) {
    if (busyRef.current.has(item.id)) return;
    busyRef.current.add(item.id); setBusyIds([...busyRef.current]);
    setData(current => current && ({ ...current, items: current.items.map(x => x.id === item.id ? { ...x, status } : x) }));
    try {
      const result = await api("content/" + item.id + "/status", "PATCH", { status, version: item.version, ...(decision ? { decision } : {}) });
      setData(current => current && ({ ...current, items: current.items.map(x => x.id === item.id ? result.item : x) }));
      toast.success(decision === "rejected" ? "Content rejected and returned to Revision" : "Moved to " + status);
    } catch (e) {
      setData(current => current && ({ ...current, items: current.items.map(x => x.id === item.id ? item : x) }));
      toast.error((e as Error).message);
      void reload().catch(() => {});
    } finally { busyRef.current.delete(item.id); setBusyIds([...busyRef.current]); }
  }
  async function saveContent(payload: Record<string, unknown>) {
    const result = await api(editor === "new" ? "content" : "content/" + (editor as ContentItem).id, editor === "new" ? "POST" : "PUT", payload);
    setData(current => current && ({ ...current, items: [...current.items.filter(x => x.id !== result.item.id), result.item].sort((a, b) => a.publishDate.localeCompare(b.publishDate)) }));
    setEditor(null); toast.success("Content saved");
  }
  // Structured tools call the same permission-enforcing server as the interface.
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: { signal: AbortSignal }) => Promise<void> | void } }).modelContext;
    if (!context) return;
    const controller = new AbortController();
    const tools = [{
      name: "list_content_items", description: "Read the content visible to the current workspace member.", inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: () => api("content"),
    }, {
      name: "move_content_card", description: "Save a content workflow status change if the current member has permission.", inputSchema: { type: "object", properties: { id: { type: "integer" }, version: { type: "integer" }, status: { type: "string", enum: ["Idea", "Writing", "Design", "Review", "Revision", "Approved", "Scheduled"] } }, required: ["id", "version", "status"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input: unknown) => { const value = input as { id: number; version: number; status: string }; if (!Number.isInteger(value?.id) || !Number.isInteger(value?.version)) throw new Error("Valid id and version are required."); const result = await api("content/" + value.id + "/status", "PATCH", { status: value.status, version: value.version }); await reload(); return { id: result.item.id, status: result.item.status, version: result.item.version }; },
    }];
    for (const tool of tools) { try { void Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {}); } catch {} }
    return () => controller.abort();
  }, [reload]);
  const actor = data?.actor;
  return <SidebarProvider style={{ "--sidebar-width": "218px" } as React.CSSProperties}>
    <Sidebar><SidebarHeader className="hub-sidebar-header"><div className="brand-lockup"><span className="brand-mark"><Layers3 size={20}/></span><span>Creative Hub</span></div><p className="workspace-label">{data?.workspace.name || "Content workspace"}</p></SidebarHeader>
      <SidebarContent><Nav view={view} navigate={navigate} manage={!!actor && managers(actor.role)} owner={actor?.role === "Owner"}/></SidebarContent>
      <SidebarFooter className="hub-profile"><div className="avatar">{initials(actor?.name || user.name)}</div><div className="profile-copy"><strong>{actor?.name || user.name}</strong><span>{actor?.role || "Workspace member"}</span></div><a href={signOutHref} target="_top" aria-label="Log out" title="Log out"><LogOut size={17}/></a></SidebarFooter>
    </Sidebar>
    <SidebarInset className="hub-main"><header className="hub-topbar"><div className="topbar-location"><SidebarTrigger/><span>{data?.workspace.name || "Creative Hub"}</span><span className="slash">/</span><strong>{titles[view][0]}</strong></div><div className="topbar-actions"><span className="private-label">Private workspace</span>{actor && canCreate(actor.role) && <Button onClick={() => setEditor("new")}><Plus size={16}/>New content</Button>}</div></header>
      <div className="hub-page">
        <div className="page-heading"><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div>{view === "dashboard" && <Button variant="outline" onClick={() => navigate("plan")}>Open content plan<ArrowUpRight size={16}/></Button>}</div>
        {error && <div className="error-banner" role="alert"><span>{error}</span><Button variant="outline" onClick={() => void reload().catch(() => {})}><RefreshCw size={15}/>Retry</Button></div>}
        {!data && !error && <div className="loading-grid" aria-label="Loading workspace"><Skeleton className="h-28"/><Skeleton className="h-28"/><Skeleton className="h-28"/><Skeleton className="h-28"/><Skeleton className="col-span-full h-80"/></div>}
        {data && <>
          {view === "dashboard" && <Dashboard data={data} navigate={navigate} open={setEditor}/>}
          {view === "plan" && <Kanban data={data} open={setEditor} move={move} busyIds={busyIds}/>}
          {view === "content" && <><div className="library-search"><Search size={17}/><Input aria-label="Search all content" placeholder="Search titles, people, platforms, or campaigns…" value={query} onChange={e => setQuery(e.target.value)}/></div><ContentTable items={data.items.filter(x => [x.title, x.pic, x.platform, x.campaign, x.pillar, x.brand].join(" ").toLowerCase().includes(query.toLowerCase()))} actor={data.actor} open={setEditor} remove={setDeleteTarget}/></>}
          {view === "calendar" && <CalendarView items={data.items} open={setEditor}/>}
          {view === "pillars" && <PillarsView data={data} reload={reload}/>}
          {(view === "brand" || view === "campaigns") && <CollectionsView data={data} kind={view === "brand" ? "brand" : "campaign"} reload={reload}/>}
          {view === "team" && <TeamView data={data} reload={reload}/>}
          {view === "settings" && <WorkspaceSettings data={data} reload={reload}/>}
        </>}
      </div>
    </SidebarInset>
    {data && editor && <ContentEditor key={editor === "new" ? "new" : editor.id} item={editor === "new" ? null : editor} data={data} close={() => setEditor(null)} save={saveContent} move={async (item, status, decision) => { await move(item, status, decision); setEditor(null); }}/>}
    <Confirm open={!!deleteTarget} close={() => setDeleteTarget(null)} title="Delete this content?" description={deleteTarget ? "“" + deleteTarget.title + "” will be permanently removed." : ""} label="Delete content" action={async () => { await api("content/" + deleteTarget!.id, "DELETE", { version: deleteTarget!.version }); setDeleteTarget(null); await reload(); toast.success("Content deleted"); }}/>
    <Toaster theme="light" position="top-right" richColors/>
  </SidebarProvider>;
}
function Nav({ view, navigate, manage, owner }: { view: View; navigate: (view: View) => void; manage: boolean; owner: boolean }) {
  const { setOpenMobile } = useSidebar();
  const go = (v: View) => { navigate(v); setOpenMobile(false); };
  return <nav className="hub-navigation" aria-label="Main navigation"><p>WORKSPACE</p><SidebarMenu>{nav.map(([v, label, Icon]) => <SidebarMenuItem key={v}><SidebarMenuButton isActive={v === view} onClick={() => go(v)}><Icon/><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>{manage && <><p className="nav-settings-label">SETTINGS</p><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive={view === "team"} onClick={() => go("team")}><Users/><span>Team members</span></SidebarMenuButton></SidebarMenuItem>{owner && <SidebarMenuItem><SidebarMenuButton isActive={view === "settings"} onClick={() => go("settings")}><Settings/><span>Workspace</span></SidebarMenuButton></SidebarMenuItem>}</SidebarMenu></>}</nav>;
}
function Dashboard({ data, navigate, open }: { data: WorkspaceData; navigate: (view: View) => void; open: (item: ContentItem) => void }) {
  const { items } = data; const today = new Date().toLocaleDateString("en-CA");
  const ready = items.filter(x => ["Approved", "Scheduled"].includes(x.status));
  const metrics = [["Total content", items.length, "Across all platforms"], ["In production", items.filter(x => ["Writing", "Design", "Revision"].includes(x.status)).length, "Moving forward"], ["Needs review", items.filter(x => x.status === "Review").length, "Ready for feedback"], ["Ready to publish", ready.length, "Approved or scheduled"]];
  return <><div className="metrics">{metrics.map(([label, count, detail], i) => <div className="metric" key={label}><div><span className={"metric-icon metric-" + i}>{[<FileText key="f"/>, <Layers3 key="l"/>, <Columns3 key="c"/>, <CalendarDays key="d"/>][i]}</span><span>{label}</span></div><strong>{count}</strong><p>{detail}</p></div>)}</div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><h2>Upcoming content</h2><Button variant="ghost" size="sm" onClick={() => navigate("content")}>View all<ArrowUpRight size={15}/></Button></div><ContentTable items={items.filter(x => x.publishDate >= today).slice(0, 8)} actor={data.actor} open={open} compact/></section><section className="panel"><div className="panel-heading"><h2>Workflow overview</h2></div><div className="workflow-summary">{["Idea", "Writing", "Design", "Review", "Revision", "Approved", "Scheduled"].map(status => <button key={status} onClick={() => navigate("plan")}><StatusBadge status={status as ContentItem["status"]}/><strong>{items.filter(x => x.status === status).length}</strong></button>)}</div><div className="panel-note">Scheduling records your plan. Publishing is handled by your team.</div></section></div>
    {!items.length && <EmptyState title="A fresh start for your content" description="Add your first idea using New content."/>}
  </>;
}
