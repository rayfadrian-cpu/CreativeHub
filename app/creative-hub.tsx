"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, CalendarDays, CheckCircle2, ChevronDown, CircleDot, Columns3,
  FileText, Grid2X2, Layers3, LogOut, Megaphone, Pencil, Plus, Search,
  Settings2, Sparkles, Tag, Trash2, Users2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";

const statuses = ["Idea", "Writing", "Design", "Review", "Revision", "Approved", "Scheduled"] as const;
const platforms = ["Instagram", "TikTok", "YouTube", "LinkedIn", "Facebook", "X / Twitter"];
const pillars = ["Education", "Productivity", "Product updates", "Behind the scenes"];
const campaigns = ["September reset", "Work smarter", "Meet the team", "Always-on content"];

type Status = (typeof statuses)[number];
type ContentItem = {
  id: number; title: string; publishDate: string; pillar: string; campaign: string;
  platform: string; pic: string; status: Status; caption: string; notes: string;
};
type FormState = Omit<ContentItem, "id">;
type View = "dashboard" | "brand" | "pillars" | "campaigns" | "plan" | "calendar" | "content";

const emptyForm = (): FormState => ({
  title: "", publishDate: new Date().toISOString().slice(0, 10), pillar: pillars[0],
  campaign: campaigns[0], platform: platforms[0], pic: "", status: "Idea", caption: "", notes: "",
});

const statusStyle: Record<Status, string> = {
  Idea: "border-slate-200 bg-slate-50 text-slate-600",
  Writing: "border-sky-200 bg-sky-50 text-sky-700",
  Design: "border-violet-200 bg-violet-50 text-violet-700",
  Review: "border-amber-200 bg-amber-50 text-amber-700",
  Revision: "border-rose-200 bg-rose-50 text-rose-700",
  Approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Scheduled: "border-blue-200 bg-blue-50 text-blue-700",
};

const navItems: { view: View; label: string; icon: typeof Grid2X2 }[] = [
  { view: "dashboard", label: "Dashboard", icon: Grid2X2 },
  { view: "brand", label: "Brand", icon: Tag },
  { view: "pillars", label: "Content pillars", icon: Columns3 },
  { view: "campaigns", label: "Campaigns", icon: Megaphone },
  { view: "plan", label: "Content plan", icon: Layers3 },
  { view: "calendar", label: "Calendar", icon: CalendarDays },
  { view: "content", label: "All content", icon: FileText },
];

function firstName(value: string) {
  if (value.includes("@")) return value.split("@")[0];
  return value.trim().split(/\s+/)[0] || "there";
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CH";
}

function readableDate(value: string, short = false) {
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString("en-US", short ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export default function CreativeHub({ user, signOutHref }: { user: { name: string; email: string }; signOutHref: string }) {
  const [view, setView] = useState<View>("dashboard");
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadContent = useCallback(async () => {
    try {
      const response = await fetch("/api/content", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load content.");
      setItems(data.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load content.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadContent(); }, [loadContent]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const createTool = {
      name: "create_content_item",
      title: "Create content item",
      description: "Create a social media content item in Creative Hub and add it to the visible plan.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" }, publishDate: { type: "string", description: "Date in YYYY-MM-DD format" },
          pillar: { type: "string" }, campaign: { type: "string" }, platform: { type: "string" },
          pic: { type: "string", description: "Person in charge" }, status: { type: "string", enum: statuses },
          caption: { type: "string" }, notes: { type: "string" },
        },
        required: ["title", "publishDate", "pillar", "platform", "pic", "status"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: unknown) => {
        const response = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not create content.");
        setItems((current) => [...current, data.item].sort((a, b) => a.publishDate.localeCompare(b.publishDate)));
        return { id: data.item.id, title: data.item.title, status: data.item.status };
      },
    };
    const listTool = {
      name: "list_content_items",
      title: "List content items",
      description: "Read the current Creative Hub content plan.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => {
        const response = await fetch("/api/content", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load content.");
        return { items: data.items };
      },
    };
    try {
      void Promise.resolve(context.registerTool(createTool, { signal: lifecycle.signal })).catch(() => undefined);
      void Promise.resolve(context.registerTool(listTool, { signal: lifecycle.signal })).catch(() => undefined);
    } catch {}
    return () => lifecycle.abort();
  }, []);

  function openCreate() {
    setEditing(null); setForm(emptyForm()); setDialogOpen(true);
  }

  function openEdit(item: ContentItem) {
    setEditing(item); setForm({ title: item.title, publishDate: item.publishDate, pillar: item.pillar, campaign: item.campaign, platform: item.platform, pic: item.pic, status: item.status, caption: item.caption, notes: item.notes }); setDialogOpen(true);
  }

  async function saveContent(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch(editing ? `/api/content/${editing.id}` : "/api/content", {
        method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save content.");
      setItems((current) => (editing ? current.map((item) => item.id === editing.id ? data.item : item) : [...current, data.item]).sort((a, b) => a.publishDate.localeCompare(b.publishDate)));
      setDialogOpen(false); toast.success(editing ? "Content updated" : "Content added");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save content."); }
    finally { setSaving(false); }
  }

  async function deleteContent(item: ContentItem) {
    try {
      const response = await fetch(`/api/content/${item.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete content.");
      setItems((current) => current.filter((entry) => entry.id !== item.id)); toast.success("Content deleted");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete content."); }
  }

  const filtered = useMemo(() => items.filter((item) => {
    const matchesQuery = `${item.title} ${item.pillar} ${item.campaign} ${item.platform} ${item.pic}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (statusFilter === "All" || item.status === statusFilter);
  }), [items, query, statusFilter]);

  return (
    <SidebarProvider style={{ "--sidebar-width": "246px" } as React.CSSProperties}>
      <Sidebar collapsible="offcanvas" className="border-r border-slate-200 bg-white">
        <SidebarHeader className="h-[74px] justify-center border-b border-slate-100 px-5">
          <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white shadow-[0_8px_22px_rgba(37,99,235,.25)]"><Sparkles size={18} strokeWidth={2.3} /></div><div><div className="text-[15px] font-bold tracking-[-0.02em]">Creative Hub</div><div className="text-xs text-slate-400">Content workspace</div></div></div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="p-4">
            <SidebarGroupLabel className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[.13em] text-slate-400">Workspace</SidebarGroupLabel>
            <SidebarGroupContent><SidebarMenu className="gap-1.5">{navItems.map(({ view: itemView, label, icon: Icon }) => <SidebarMenuItem key={itemView}><SidebarMenuButton size="lg" isActive={view === itemView} onClick={() => setView(itemView)} className="h-11 rounded-xl px-3 text-slate-600 data-[active=true]:bg-blue-50 data-[active=true]:font-semibold data-[active=true]:text-blue-700"><Icon size={18} /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-slate-100 p-4">
          <div className="flex items-center gap-3 rounded-xl p-2"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{initials(user.name)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{user.name}</span><span className="block truncate text-xs text-slate-400">{user.email}</span></span><a href={signOutHref} target="_top" aria-label="Sign out" className="text-slate-400 hover:text-slate-900"><LogOut size={16} /></a></div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-[#f5f7fb]">
        <header className="sticky top-0 z-20 flex h-[74px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3"><SidebarTrigger className="h-9 w-9 lg:hidden" /><div className="relative hidden w-[340px] lg:block"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><Input aria-label="Search content" value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setView("content")} placeholder="Search content, campaigns, people..." className="h-10 rounded-xl border-slate-200 bg-slate-50/80 pl-10 shadow-none" /></div></div>
          <div className="flex items-center gap-3"><Button variant="outline" size="icon" className="h-10 w-10 rounded-xl border-slate-200 text-slate-500" aria-label="Workspace settings" onClick={() => setView("brand")}><Settings2 size={18} /></Button><Button onClick={openCreate} className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold shadow-[0_8px_20px_rgba(37,99,235,.2)] hover:bg-blue-700"><Plus size={17} /><span className="hidden sm:inline">New content</span></Button></div>
        </header>

        <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-8">
          {view === "dashboard" && <Dashboard items={items} loading={loading} name={firstName(user.name)} onEdit={openEdit} onNavigate={setView} />}
          {view === "brand" && <BrandView />}
          {view === "pillars" && <PillarsView items={items} />}
          {view === "campaigns" && <CampaignsView items={items} />}
          {view === "plan" && <PlanView items={items} onEdit={openEdit} />}
          {view === "calendar" && <CalendarView items={items} onEdit={openEdit} />}
          {view === "content" && <AllContentView items={filtered} loading={loading} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onEdit={openEdit} onDelete={deleteContent} onCreate={openCreate} />}
        </div>
      </SidebarInset>

      <ContentDialog open={dialogOpen} setOpen={setDialogOpen} editing={editing} form={form} setForm={setForm} saving={saving} onSubmit={saveContent} />
      <Toaster position="top-right" richColors />
    </SidebarProvider>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div>{eyebrow && <p className="mb-1 text-sm font-medium text-blue-600">{eyebrow}</p>}<h1 className="text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-[36px]">{title}</h1><p className="mt-2 text-[15px] text-slate-500">{description}</p></div>{action}</div>;
}

function StatusBadge({ status }: { status: Status }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyle[status]}`}>{status}</span>;
}

function Dashboard({ items, loading, name, onEdit, onNavigate }: { items: ContentItem[]; loading: boolean; name: string; onEdit: (item: ContentItem) => void; onNavigate: (view: View) => void }) {
  const ready = items.filter((item) => item.status === "Approved" || item.status === "Scheduled").length;
  const activeCampaigns = new Set(items.map((item) => item.campaign).filter(Boolean)).size;
  const metrics = [
    { label: "All content", value: items.length, detail: "Across every platform", icon: FileText, wash: "bg-blue-50", ink: "text-blue-600" },
    { label: "In progress", value: items.filter((item) => !["Approved", "Scheduled"].includes(item.status)).length, detail: "Moving through the workflow", icon: CircleDot, wash: "bg-violet-50", ink: "text-violet-600" },
    { label: "Ready to publish", value: ready, detail: "Approved and scheduled", icon: CheckCircle2, wash: "bg-emerald-50", ink: "text-emerald-600" },
    { label: "Active campaigns", value: activeCampaigns, detail: "Currently represented", icon: BarChart3, wash: "bg-amber-50", ink: "text-amber-600" },
  ];
  return <>
    <PageHeading eyebrow={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} title={`Good morning, ${name}`} description="Here’s what your content team is working on." action={<Button variant="outline" onClick={() => onNavigate("calendar")} className="self-start rounded-xl border-slate-200 bg-white"><CalendarDays size={16} className="text-blue-600" />Open calendar</Button>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, detail, icon: Icon, wash, ink }) => <article key={label} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.035)]"><div className={`absolute -right-6 -top-6 h-20 w-20 rounded-full ${wash}`} /><div className="relative flex items-start justify-between"><div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-[30px] font-bold tracking-[-0.04em]">{loading ? "—" : value}</p></div><span className={`grid h-10 w-10 place-items-center rounded-xl ${wash} ${ink}`}><Icon size={19} /></span></div><p className="mt-3 text-xs text-slate-400">{detail}</p></article>)}</div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]"><ContentTable items={items.slice(0, 5)} loading={loading} onEdit={onEdit} onViewAll={() => onNavigate("content")} /><Queue items={items.filter((item) => item.status === "Scheduled" || item.status === "Approved").slice(0, 4)} onOpen={() => onNavigate("calendar")} /></div>
  </>;
}

function ContentTable({ items, loading, onEdit, onViewAll }: { items: ContentItem[]; loading: boolean; onEdit: (item: ContentItem) => void; onViewAll: () => void }) {
  return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,.035)]"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6"><div><h2 className="text-lg font-bold tracking-[-0.02em]">Content in progress</h2><p className="mt-0.5 text-sm text-slate-400">The latest work across your team</p></div><button onClick={onViewAll} className="text-sm font-semibold text-blue-600 hover:text-blue-700">View all</button></div><div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-slate-100 bg-slate-50/70 hover:bg-slate-50/70"><TableHead className="min-w-[270px] pl-6">Content</TableHead><TableHead>Pillar</TableHead><TableHead>Publish</TableHead><TableHead>PIC</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={5} className="h-36 text-center text-slate-400">Loading your content…</TableCell></TableRow> : items.length === 0 ? <TableRow><TableCell colSpan={5} className="h-36 text-center text-slate-400">No content yet. Add your first idea.</TableCell></TableRow> : items.map((item) => <TableRow key={item.id} onClick={() => onEdit(item)} className="cursor-pointer border-slate-100 hover:bg-blue-50/30"><TableCell className="py-4 pl-6"><div className="font-semibold text-slate-800">{item.title}</div><div className="mt-1 text-xs text-slate-400">{item.platform} · {item.campaign || "Always-on"}</div></TableCell><TableCell><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{item.pillar}</span></TableCell><TableCell className="text-sm font-medium text-slate-600">{readableDate(item.publishDate, true)}</TableCell><TableCell><div className="flex items-center gap-2 text-sm font-medium text-slate-600"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{initials(item.pic)}</span>{item.pic}</div></TableCell><TableCell><StatusBadge status={item.status} /></TableCell></TableRow>)}</TableBody></Table></div></article>;
}

function Queue({ items, onOpen }: { items: ContentItem[]; onOpen: () => void }) {
  return <aside className="rounded-2xl bg-slate-950 p-5 text-white shadow-[0_14px_40px_rgba(15,23,42,.14)] sm:p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.12em] text-blue-300">Next up</p><h2 className="mt-1 text-lg font-bold">Publishing queue</h2></div><span className="rounded-lg bg-white/10 px-2.5 py-1 text-xs text-slate-300">{items.length} items</span></div><div className="mt-6 space-y-5">{items.length === 0 ? <p className="text-sm leading-6 text-slate-400">Approved and scheduled content will appear here.</p> : items.map((item, index) => <div key={item.id} className="relative flex gap-4">{index < items.length - 1 && <span className="absolute left-[18px] top-10 h-9 w-px bg-white/15" />}<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-[11px] font-bold text-blue-300">{item.platform.slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between text-xs text-slate-400"><span>{readableDate(item.publishDate, true)}</span><span>{item.status}</span></div><p className="mt-1 truncate text-sm font-semibold text-slate-100">{item.title}</p></div></div>)}</div><button onClick={onOpen} className="mt-7 w-full rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Open calendar</button></aside>;
}

function BrandView() {
  return <><PageHeading eyebrow="Brand workspace" title="Brand" description="Keep the essentials visible so every piece of content feels consistent." /><div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]"><section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-600 text-white"><Sparkles size={24} /></div><div><h2 className="text-xl font-bold">Creative Hub</h2><p className="text-sm text-slate-500">Primary brand</p></div></div><div className="mt-7 grid gap-5 sm:grid-cols-2"><Info label="Brand promise" value="Make social content planning feel clear and calm." /><Info label="Audience" value="Busy content and marketing teams." /><Info label="Voice" value="Clear, useful, friendly, confident." /><Info label="Writing style" value="Short sentences, plain language, practical detail." /></div></section><section className="rounded-2xl bg-blue-600 p-6 text-white"><p className="text-xs font-semibold uppercase tracking-[.12em] text-blue-200">Visual direction</p><h2 className="mt-2 text-xl font-bold">Clear space. Strong hierarchy.</h2><p className="mt-3 text-sm leading-6 text-blue-100">Use bright blue for important actions, deep navy for focus, and generous white space to keep busy work easy to scan.</p><div className="mt-8 flex gap-3">{["#2563EB", "#0F172A", "#F5F7FB", "#FFFFFF"].map((color) => <div key={color}><div className="h-12 w-12 rounded-xl border border-white/20" style={{ background: color }} /><p className="mt-2 text-[11px] text-blue-100">{color}</p></div>)}</div></section></div></>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-xs font-semibold uppercase tracking-[.08em] text-slate-400">{label}</p><p className="mt-2 text-sm leading-6 text-slate-700">{value}</p></div>; }

function PillarsView({ items }: { items: ContentItem[] }) {
  const colors = ["bg-blue-600", "bg-violet-500", "bg-amber-500", "bg-emerald-500"];
  return <><PageHeading eyebrow="Content strategy" title="Content pillars" description="The repeatable themes that keep your content balanced and recognizable." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{pillars.map((pillar, index) => { const count = items.filter((item) => item.pillar === pillar).length; return <article key={pillar} className="rounded-2xl border border-slate-200 bg-white p-5"><span className={`block h-2 w-10 rounded-full ${colors[index]}`} /><h2 className="mt-5 text-lg font-bold">{pillar}</h2><p className="mt-2 min-h-10 text-sm leading-5 text-slate-500">{["Teach something useful and immediately practical.", "Help the audience work with more clarity and focus.", "Explain what changed and why it matters.", "Show the people and process behind the work."][index]}</p><div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-sm"><span className="text-slate-400">Content items</span><span className="font-bold">{count}</span></div></article>; })}</div></>;
}

function CampaignsView({ items }: { items: ContentItem[] }) {
  return <><PageHeading eyebrow="Campaigns" title="Campaign overview" description="See the initiatives that connect individual content into a larger story." /><div className="grid gap-5 lg:grid-cols-2">{campaigns.map((campaign, index) => { const count = items.filter((item) => item.campaign === campaign).length; const approved = items.filter((item) => item.campaign === campaign && ["Approved", "Scheduled"].includes(item.status)).length; const progress = count ? Math.round(approved / count * 100) : 0; return <article key={campaign} className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-start justify-between"><div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${index === 0 ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{index === 0 ? "Active" : "Always on"}</span><h2 className="mt-3 text-xl font-bold">{campaign}</h2></div><Megaphone className="text-slate-300" /></div><div className="mt-7 flex justify-between text-sm"><span className="text-slate-500">{count} content items</span><span className="font-semibold">{progress}% ready</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }} /></div></article>; })}</div></>;
}

function PlanView({ items, onEdit }: { items: ContentItem[]; onEdit: (item: ContentItem) => void }) {
  return <><PageHeading eyebrow="Workflow" title="Content plan" description="Move every idea through writing, design, review, approval, and scheduling." /><div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:px-8"><div className="grid min-w-[1520px] grid-cols-7 gap-3">{statuses.map((status) => { const list = items.filter((item) => item.status === status); return <section key={status} className="rounded-2xl border border-slate-200 bg-slate-100/70 p-3"><div className="mb-3 flex items-center justify-between px-1"><StatusBadge status={status} /><span className="text-xs font-bold text-slate-400">{list.length}</span></div><div className="space-y-3">{list.map((item) => <button key={item.id} onClick={() => onEdit(item)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><p className="text-sm font-semibold leading-5 text-slate-800">{item.title}</p><p className="mt-3 text-xs text-slate-400">{item.platform} · {readableDate(item.publishDate, true)}</p><div className="mt-3 flex items-center justify-between"><span className="text-[11px] font-medium text-slate-500">{item.pillar}</span><span className="grid h-6 w-6 place-items-center rounded-full bg-slate-900 text-[9px] font-bold text-white">{initials(item.pic)}</span></div></button>)}{list.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-xs text-slate-400">No items</div>}</div></section>; })}</div></div></>;
}

function CalendarView({ items, onEdit }: { items: ContentItem[]; onEdit: (item: ContentItem) => void }) {
  const focus = items[0] ? new Date(`${items[0].publishDate}T12:00:00`) : new Date();
  const year = focus.getFullYear(); const month = focus.getMonth();
  const start = new Date(year, month, 1); const days = new Date(year, month + 1, 0).getDate(); const offset = start.getDay();
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => index - offset + 1);
  return <><PageHeading eyebrow="Publishing schedule" title={focus.toLocaleDateString("en-US", { month: "long", year: "numeric" })} description="See what is planned for each publishing day." /><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-[.08em] text-slate-400">{day}</div>)}</div><div className="grid grid-cols-7">{cells.map((day, index) => { const date = day > 0 && day <= days ? `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : ""; const dayItems = items.filter((item) => item.publishDate === date); return <div key={index} className={`min-h-28 border-b border-r border-slate-100 p-2 ${date ? "bg-white" : "bg-slate-50/60"}`}><span className="text-xs font-semibold text-slate-500">{date ? day : ""}</span><div className="mt-2 space-y-1">{dayItems.slice(0, 3).map((item) => <button key={item.id} onClick={() => onEdit(item)} className="block w-full truncate rounded-md bg-blue-50 px-2 py-1.5 text-left text-[11px] font-semibold text-blue-700 hover:bg-blue-100">{item.title}</button>)}</div></div>; })}</div></section></>;
}

function AllContentView({ items, loading, query, setQuery, statusFilter, setStatusFilter, onEdit, onDelete, onCreate }: { items: ContentItem[]; loading: boolean; query: string; setQuery: (value: string) => void; statusFilter: string; setStatusFilter: (value: string) => void; onEdit: (item: ContentItem) => void; onDelete: (item: ContentItem) => void; onCreate: () => void }) {
  const [deleteTarget, setDeleteTarget] = useState<ContentItem | null>(null);
  return <><PageHeading eyebrow="Content library" title="All content" description="Search, review, and update every content item in one place." action={<Button onClick={onCreate} className="self-start rounded-xl bg-blue-600 hover:bg-blue-700"><Plus size={17} />New content</Button>} /><div className="mb-4 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title, pillar, campaign, platform, or PIC" className="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-none" /></div><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="h-11 w-full rounded-xl border-slate-200 bg-white sm:w-[190px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All">All statuses</SelectItem>{statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></div><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-slate-50/70"><TableHead className="min-w-[280px] pl-6">Title</TableHead><TableHead>Publish date</TableHead><TableHead>Pillar</TableHead><TableHead>Platform</TableHead><TableHead>PIC</TableHead><TableHead>Status</TableHead><TableHead className="pr-6 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={7} className="h-48 text-center text-slate-400">Loading content…</TableCell></TableRow> : items.length === 0 ? <TableRow><TableCell colSpan={7} className="h-48 text-center"><FileText className="mx-auto mb-3 text-slate-300" /><p className="font-semibold text-slate-700">No content found</p><p className="mt-1 text-sm text-slate-400">Try another filter or add a new item.</p></TableCell></TableRow> : items.map((item) => <TableRow key={item.id} className="border-slate-100"><TableCell className="py-4 pl-6"><p className="font-semibold text-slate-800">{item.title}</p><p className="mt-1 text-xs text-slate-400">{item.campaign || "Always-on content"}</p></TableCell><TableCell className="text-sm text-slate-600">{readableDate(item.publishDate)}</TableCell><TableCell><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{item.pillar}</span></TableCell><TableCell className="text-sm text-slate-600">{item.platform}</TableCell><TableCell className="text-sm text-slate-600">{item.pic}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell className="pr-6"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => onEdit(item)} className="h-8 w-8" aria-label={`Edit ${item.title}`}><Pencil size={15} /></Button><Button variant="ghost" size="icon" onClick={() => setDeleteTarget(item)} className="h-8 w-8 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${item.title}`}><Trash2 size={15} /></Button></div></TableCell></TableRow>)}</TableBody></Table></div></section><AlertDialog open={Boolean(deleteTarget)} onOpenChange={(next) => !next && setDeleteTarget(null)}><AlertDialogContent className="rounded-2xl"><AlertDialogHeader><AlertDialogTitle>Delete this content item?</AlertDialogTitle><AlertDialogDescription>“{deleteTarget?.title}” will be permanently removed from your content plan.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel><AlertDialogAction className="rounded-xl bg-rose-600 text-white hover:bg-rose-700" onClick={() => { if (deleteTarget) void onDelete(deleteTarget); setDeleteTarget(null); }}>Delete content</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}

function ContentDialog({ open, setOpen, editing, form, setForm, saving, onSubmit }: { open: boolean; setOpen: (value: boolean) => void; editing: ContentItem | null; form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>; saving: boolean; onSubmit: (event: React.FormEvent) => void }) {
  const update = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl border-slate-200 bg-white p-0 sm:max-w-[720px]"><form onSubmit={onSubmit}><DialogHeader className="border-b border-slate-100 px-6 py-5"><DialogTitle className="text-xl">{editing ? "Edit content" : "Add new content"}</DialogTitle><DialogDescription>{editing ? "Update the details and workflow status." : "Add the essential details now. You can refine the copy later."}</DialogDescription></DialogHeader><div className="grid gap-5 px-6 py-5 sm:grid-cols-2"><Field label="Content title" className="sm:col-span-2"><Input required value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="What is this content about?" className="h-10 rounded-xl" /></Field><Field label="Publish date"><Input required type="date" value={form.publishDate} onChange={(event) => update("publishDate", event.target.value)} className="h-10 rounded-xl" /></Field><Field label="Content pillar"><Select value={form.pillar} onValueChange={(value) => update("pillar", value)}><SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{pillars.map((pillar) => <SelectItem key={pillar} value={pillar}>{pillar}</SelectItem>)}</SelectContent></Select></Field><Field label="Campaign"><Select value={form.campaign} onValueChange={(value) => update("campaign", value)}><SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{campaigns.map((campaign) => <SelectItem key={campaign} value={campaign}>{campaign}</SelectItem>)}</SelectContent></Select></Field><Field label="Platform"><Select value={form.platform} onValueChange={(value) => update("platform", value)}><SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{platforms.map((platform) => <SelectItem key={platform} value={platform}>{platform}</SelectItem>)}</SelectContent></Select></Field><Field label="PIC / person in charge"><Input required value={form.pic} onChange={(event) => update("pic", event.target.value)} placeholder="Name" className="h-10 rounded-xl" /></Field><Field label="Status"><Select value={form.status} onValueChange={(value) => update("status", value as Status)}><SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{statuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></Field><Field label="Caption" className="sm:col-span-2"><Textarea value={form.caption} onChange={(event) => update("caption", event.target.value)} placeholder="Write or paste the draft caption here…" className="min-h-24 rounded-xl" /></Field><Field label="Notes" className="sm:col-span-2"><Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Feedback, links, reminders, or creative direction…" className="min-h-20 rounded-xl" /></Field></div><DialogFooter className="border-t border-slate-100 bg-slate-50/70 px-6 py-4"><Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-xl">Cancel</Button><Button type="submit" disabled={saving} className="rounded-xl bg-blue-600 hover:bg-blue-700">{saving ? "Saving…" : editing ? "Save changes" : "Add content"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) { return <div className={className}><Label className="mb-2 block text-sm font-semibold text-slate-700">{label}</Label>{children}</div>; }
