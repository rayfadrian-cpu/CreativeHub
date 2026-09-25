"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Archive, ChevronLeft, ChevronRight, FileText, History, LockKeyhole, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  campaignStatuses, contentFormats, roles, statuses, priorities, platforms, managers, strategists,
  canMove, editableFields, canDelete,
  type Activity, type Actor, type Brand, type Campaign, type ContentItem, type Pillar, type WorkspaceData, type Member,
} from "@/lib/hub-types";
import { api, dateLabel, initials } from "./creative-hub";

type Reload = () => Promise<WorkspaceData>;
type FilterState = { brandId: string; campaignId: string; pillarId: string; status: string; platform: string; pic: string; dateFrom: string; dateTo: string };
const emptyFilters: FilterState = { brandId: "all", campaignId: "all", pillarId: "all", status: "all", platform: "all", pic: "all", dateFrom: "", dateTo: "" };

export function Choice({ id, label, value, options, onChange, disabled }: { id?: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger id={id} aria-label={label} className="w-full"><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>;
}

export const options = (list: readonly string[]) => list.map(x => ({ value: x, label: x }));

export function Field({ label, id, children, wide }: { label: string; id: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? "form-field field-wide" : "form-field"}><Label htmlFor={id}>{label}</Label>{children}</div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <Empty className="hub-empty"><FileText size={24}/><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>;
}

export function StatusBadge({ status }: { status: ContentItem["status"] }) {
  return <span className={"status-badge status-" + status.toLowerCase()}><i/>{status}</span>;
}

export function PriorityBadge({ priority }: { priority: ContentItem["priority"] }) {
  return <span className={"priority priority-" + priority.toLowerCase()}>{priority === "Urgent" ? "!! " : priority === "High" ? "↑ " : ""}{priority}</span>;
}

export function Confirm({ open, close, title, description, label, action }: { open: boolean; close: () => void; title: string; description: string; label: string; action: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <AlertDialog open={open} onOpenChange={value => { if (!value && !busy) { setError(""); close(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>{error && <p role="alert" className="form-error">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await action(); close(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Working…" : label}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function Filters({ data, value, change, includeDates = false }: { data: WorkspaceData; value: FilterState; change: (next: FilterState) => void; includeDates?: boolean }) {
  const campaigns = data.campaigns.filter(x => value.brandId === "all" || String(x.brandId) === value.brandId);
  const pillars = data.pillars.filter(x => value.brandId === "all" || String(x.brandId) === value.brandId);
  const select = (key: keyof FilterState, next: string) => {
    const result = { ...value, [key]: next };
    if (key === "brandId") { result.campaignId = "all"; result.pillarId = "all"; }
    change(result);
  };
  const people = [...new Set(data.items.map(x => x.pic || "Unassigned"))].sort();
  return <div className="content-filters">
    <Choice label="Filter by Brand" value={value.brandId} options={[{ value: "all", label: "All Brands" }, ...data.brands.map(x => ({ value: String(x.id), label: x.name + (x.archived ? " · archived" : "") }))]} onChange={v => select("brandId", v)}/>
    <Choice label="Filter by Campaign" value={value.campaignId} options={[{ value: "all", label: "All Campaigns" }, ...campaigns.map(x => ({ value: String(x.id), label: x.name }))]} onChange={v => select("campaignId", v)}/>
    <Choice label="Filter by Content Pillar" value={value.pillarId} options={[{ value: "all", label: "All Pillars" }, ...pillars.map(x => ({ value: String(x.id), label: x.name }))]} onChange={v => select("pillarId", v)}/>
    <Choice label="Filter by status" value={value.status} options={[{ value: "all", label: "All statuses" }, ...options(statuses)]} onChange={v => select("status", v)}/>
    <Choice label="Filter by platform" value={value.platform} options={[{ value: "all", label: "All platforms" }, ...options(platforms)]} onChange={v => select("platform", v)}/>
    <Choice label="Filter by PIC" value={value.pic} options={[{ value: "all", label: "All people" }, ...options(people)]} onChange={v => select("pic", v)}/>
    {includeDates && <><Input aria-label="Publish date from" type="date" value={value.dateFrom} onChange={e => select("dateFrom", e.target.value)}/><Input aria-label="Publish date to" type="date" value={value.dateTo} onChange={e => select("dateTo", e.target.value)}/></>}
    {Object.entries(value).some(([key, v]) => key.startsWith("date") ? v : v !== "all") && <Button variant="ghost" onClick={() => change(emptyFilters)}><X size={14}/>Clear</Button>}
  </div>;
}

export function ContentEditor({ item, data, close, save }: { item: ContentItem | null; data: WorkspaceData; close: () => void; save: (payload: Record<string, unknown>) => Promise<void> }) {
  const fields = editableFields(data.actor, item);
  const firstBrand = data.brands.find(x => !x.archived) ?? data.brands[0];
  const [form, setForm] = useState({
    title: item?.title ?? "", brandId: item?.brandId ?? firstBrand?.id ?? null, campaignId: item?.campaignId ?? null,
    pillarId: item?.pillarId ?? null, objective: item?.objective ?? "", brief: item?.brief ?? "",
    targetAudience: item?.targetAudience ?? "", format: item?.format ?? "Post", priority: item?.priority ?? "Normal",
    assigneeId: item?.assigneeId ?? (data.actor.role === "Creative" ? data.actor.id : null),
    pic: item?.pic ?? (data.actor.role === "Creative" ? data.actor.name : ""), deadline: item?.deadline ?? "",
    publishDate: item?.publishDate ?? new Date().toLocaleDateString("en-CA"), platform: item?.platform ?? "Instagram",
    status: item?.status ?? "Idea", caption: item?.caption ?? "", notes: item?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabled = (key: string) => fields.includes(key);
  const moves = item ? statuses.filter(x => x === item.status || canMove(data.actor, item, x)) : ["Idea"];
  const canSave = fields.length > 0 || !!item && moves.length > 1;
  const readonly = !canSave;
  const campaigns = data.campaigns.filter(x => x.brandId === form.brandId && (!x.archived || x.id === item?.campaignId));
  const pillars = data.pillars.filter(x => x.brandId === form.brandId && (x.active || x.id === item?.pillarId));
  function update(key: string, value: unknown) { setForm(current => ({ ...current, [key]: value })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload: Record<string, unknown> = item ? { version: item.version } : { ...form };
      if (item) for (const [key, value] of Object.entries(form)) if (fields.includes(key) || key === "status" && moves.length > 1) payload[key] = value;
      await save(payload);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={value => !value && !busy && close()}><DialogContent className="content-modal"><form onSubmit={submit}><DialogHeader><DialogTitle>{item ? readonly ? "Content details" : "Edit content" : "New content"}</DialogTitle><DialogDescription>{readonly ? "You have read-only access to this item." : "Plan the master content record. Publishing remains manual."}</DialogDescription></DialogHeader>
    <div className="modal-scroll"><div className="form-grid">
      <Field label="Content title" id="content-title" wide><Input id="content-title" maxLength={200} required disabled={!enabled("title")} value={form.title} onChange={e => update("title", e.target.value)}/></Field>
      <Field label="Brand" id="content-brand"><Choice id="content-brand" label="Brand" value={form.brandId == null ? "" : String(form.brandId)} options={data.brands.filter(x => !x.archived || x.id === item?.brandId).map(x => ({ value: String(x.id), label: x.name }))} disabled={!enabled("brandId")} onChange={v => setForm(current => ({ ...current, brandId: Number(v), campaignId: null, pillarId: null }))}/></Field>
      <Field label="Campaign" id="content-campaign"><Choice id="content-campaign" label="Campaign" value={form.campaignId == null ? "_none" : String(form.campaignId)} options={[{ value: "_none", label: "No Campaign" }, ...campaigns.map(x => ({ value: String(x.id), label: x.name }))]} disabled={!enabled("campaignId")} onChange={v => update("campaignId", v === "_none" ? null : Number(v))}/></Field>
      <Field label="Content Pillar" id="content-pillar"><Choice id="content-pillar" label="Content Pillar" value={form.pillarId == null ? "_none" : String(form.pillarId)} options={[{ value: "_none", label: "No Pillar" }, ...pillars.map(x => ({ value: String(x.id), label: x.name + (x.active ? "" : " · inactive") }))]} disabled={!enabled("pillarId")} onChange={v => update("pillarId", v === "_none" ? null : Number(v))}/></Field>
      <Field label="Format" id="content-format"><Choice id="content-format" label="Format" value={form.format} options={options(contentFormats)} disabled={!enabled("format")} onChange={v => update("format", v)}/></Field>
      <Field label="Platform" id="content-platform"><Choice id="content-platform" label="Platform" value={form.platform} options={options([...new Set([...platforms, form.platform])])} disabled={!enabled("platform")} onChange={v => update("platform", v)}/></Field>
      <Field label="Planned publish date" id="content-date"><Input id="content-date" type="date" required disabled={!enabled("publishDate")} value={form.publishDate} onChange={e => update("publishDate", e.target.value)}/></Field>
      <Field label="Deadline" id="content-deadline"><Input id="content-deadline" type="date" disabled={!enabled("deadline")} value={form.deadline} onChange={e => update("deadline", e.target.value)}/></Field>
      <Field label="Priority" id="content-priority"><Choice id="content-priority" label="Priority" value={form.priority} options={options(priorities)} disabled={!enabled("priority")} onChange={v => update("priority", v)}/></Field>
      <Field label="Assigned team member" id="content-assignee"><Choice id="content-assignee" label="Assigned team member" value={form.assigneeId == null ? "_none" : String(form.assigneeId)} options={[{ value: "_none", label: "Unassigned / existing PIC" }, ...data.members.filter(x => x.status !== "Inactive" || x.id === item?.assigneeId).map(x => ({ value: String(x.id), label: x.name }))]} disabled={!enabled("assigneeId")} onChange={v => { update("assigneeId", v === "_none" ? null : Number(v)); if (v !== "_none") update("pic", data.members.find(x => x.id === Number(v))?.name ?? ""); }}/></Field>
      <Field label="Workflow status" id="content-status"><Choice id="content-status" label="Workflow status" value={form.status} options={options(moves)} disabled={moves.length < 2} onChange={v => update("status", v)}/></Field>
      {form.assigneeId == null && <Field label="PIC / person in charge" id="content-pic" wide><Input id="content-pic" maxLength={120} disabled={!enabled("pic")} value={form.pic} onChange={e => update("pic", e.target.value)} placeholder="Name of the person responsible"/></Field>}
      <Field label="Objective" id="content-objective" wide><Textarea id="content-objective" maxLength={2000} rows={2} disabled={!enabled("objective")} value={form.objective} onChange={e => update("objective", e.target.value)}/></Field>
      <Field label="Brief" id="content-brief" wide><Textarea id="content-brief" maxLength={10000} rows={4} disabled={!enabled("brief")} value={form.brief} onChange={e => update("brief", e.target.value)}/></Field>
      <Field label="Target audience" id="content-audience" wide><Textarea id="content-audience" maxLength={2000} rows={2} disabled={!enabled("targetAudience")} value={form.targetAudience} onChange={e => update("targetAudience", e.target.value)}/></Field>
      <Field label="Master caption / copy" id="content-caption" wide><Textarea id="content-caption" maxLength={15000} rows={5} disabled={!enabled("caption")} value={form.caption} onChange={e => update("caption", e.target.value)}/></Field>
      <Field label="Notes" id="content-notes" wide><Textarea id="content-notes" maxLength={15000} rows={3} disabled={!enabled("notes")} value={form.notes} onChange={e => update("notes", e.target.value)}/></Field>
    </div>{item?.reviewDecision === "rejected" && <p className="form-error">Rejected — this content has been returned for revision.</p>}{item && <p className="record-meta">Created {item.createdAt || "—"} · Last updated {item.updatedAt || "—"}{item.creatorName ? " · By " + item.creatorName : ""}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      {item?.status === "Review" && <p className="record-meta">Open the Content workspace Approval tab to approve, request revision, or reject with a recorded note.</p>}
    </div><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>{readonly ? "Close" : "Cancel"}</Button>{canSave && <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save content"}</Button>}</DialogFooter></form>
  </DialogContent></Dialog>;
}

export function ContentTable({ items, actor, open, remove, compact = false }: { items: ContentItem[]; actor: Actor; open: (item: ContentItem) => void; remove?: (item: ContentItem) => void; compact?: boolean }) {
  if (!items.length) return <EmptyState title="No content to show" description="Try another filter, or add a new content item."/>;
  return <div className={compact ? "" : "panel table-scroll"}><Table><TableHeader><TableRow><TableHead>Content title</TableHead><TableHead>Publish date</TableHead><TableHead>PIC</TableHead><TableHead>Status</TableHead>{!compact && <><TableHead>Priority</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></>}</TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.id}><TableCell className="title-cell"><button onClick={() => open(item)}>{item.title}</button><span>{item.brand} · {item.platform}{item.pillar ? " · " + item.pillar : ""}</span></TableCell><TableCell className="nowrap">{dateLabel(item.publishDate)}</TableCell><TableCell>{item.pic || "Unassigned"}</TableCell><TableCell><StatusBadge status={item.status}/></TableCell>{!compact && <><TableCell><PriorityBadge priority={item.priority}/></TableCell><TableCell><div className="table-actions"><Button size="icon" variant="ghost" aria-label={"Open " + item.title} onClick={() => open(item)}><Pencil size={15}/></Button>{canDelete(actor.role) && remove && <Button size="icon" variant="ghost" aria-label={"Delete " + item.title} onClick={() => remove(item)}><Trash2 size={15}/></Button>}</div></TableCell></>}</TableRow>)}</TableBody></Table></div>;
}

export function AllContentView({ data, open, remove, refreshKey }: { data: WorkspaceData; open: (item: ContentItem) => void; remove: (item: ContentItem) => void; refreshKey: string }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ items: ContentItem[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 40;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
      if (query.trim()) params.set("query", query.trim());
      for (const [key, value] of Object.entries(filters)) if (value && value !== "all") params.set(key, value);
      setLoading(true);
      try { setResult(await api("content?" + params.toString())); setError(""); }
      catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 220);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, filters, page, refreshKey]);
  return <><div className="library-search"><Search size={17}/><Input aria-label="Search all content" placeholder="Search titles, captions, notes, or briefs…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></div><Filters data={data} value={filters} change={next => { setFilters(next); setPage(0); }} includeDates/>
    <div className="result-summary"><span>{loading ? "Loading content…" : `${result.total} content items`}</span>{error && <span className="form-error">{error}</span>}</div>
    {!loading && !error && <ContentTable items={result.items} actor={data.actor} open={open} remove={remove}/>}<div className="pagination-bar"><Button variant="outline" disabled={loading || page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page + 1} of {Math.max(1, Math.ceil(result.total / pageSize))}</span><Button variant="outline" disabled={loading || (page + 1) * pageSize >= result.total} onClick={() => setPage(page + 1)}>Next</Button></div>
  </>;
}

export function PillarsView({ data, reload }: { data: WorkspaceData; reload: Reload }) {
  const [edit, setEdit] = useState<Pillar | "new" | null>(null);
  const [remove, setRemove] = useState<Pillar | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = strategists(data.actor.role);
  async function reorder(index: number, offset: number) {
    const ids = data.pillars.map(x => x.id); [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    setBusy(true); try { await api("pillars/reorder", "PATCH", { ids }); await reload(); toast.success("Pillar order saved"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return <><div className="section-toolbar"><span>{data.pillars.length} Pillars · {data.pillars.filter(x => x.active).length} active</span>{allowed && <Button onClick={() => setEdit("new")}><Plus size={16}/>Add Pillar</Button>}</div><div className="pillar-grid">{data.pillars.map((pillar, index) => <article className={"panel pillar-card" + (pillar.active ? "" : " inactive-pillar")} key={pillar.id}><div className="pillar-card-top"><span className="pillar-swatch" style={{ background: pillar.color }}/><span className={"subtle-badge" + (pillar.active ? "" : " muted")}>{pillar.active ? "Active" : "Inactive"}</span>{allowed && <div className="pillar-order"><Button size="icon" variant="ghost" aria-label={"Move " + pillar.name + " up"} disabled={busy || !index} onClick={() => void reorder(index, -1)}><ArrowUp size={15}/></Button><Button size="icon" variant="ghost" aria-label={"Move " + pillar.name + " down"} disabled={busy || index === data.pillars.length - 1} onClick={() => void reorder(index, 1)}><ArrowDown size={15}/></Button></div>}</div><h2>{pillar.name}</h2><p>{data.brands.find(x => x.id === pillar.brandId)?.name || "No Brand"} · {pillar.description || "No description yet."}</p><div className="pillar-objective"><span>OBJECTIVE</span><p>{pillar.objective || "Not set"}</p></div><footer><span>{pillar.usage} content {pillar.usage === 1 ? "item" : "items"}</span>{allowed && <div className="table-actions"><Button size="sm" variant="ghost" onClick={() => setEdit(pillar)}>Edit</Button><Button size="icon" variant="ghost" aria-label={"Delete Pillar " + pillar.name} onClick={() => setRemove(pillar)}><Trash2 size={15}/></Button></div>}</footer></article>)}</div>{!data.pillars.length && <EmptyState title="Define your first Content Pillar" description="Pillars organize the recurring themes for each Brand."/>}
    {edit && <PillarEditor data={data} pillar={edit === "new" ? null : edit} close={() => setEdit(null)} saved={reload}/>}<Confirm open={!!remove} close={() => setRemove(null)} title="Delete this Pillar?" description={(remove?.usage ?? 0) + " content items use “" + (remove?.name ?? "") + "”. They will be kept without a Pillar."} label="Delete Pillar" action={async () => { await api("pillars/" + remove!.id, "DELETE", { confirm: true }); await reload(); toast.success("Pillar deleted. Content preserved."); }}/>
  </>;
}

function PillarEditor({ data, pillar, close, saved }: { data: WorkspaceData; pillar: Pillar | null; close: () => void; saved: Reload }) {
  const firstBrand = data.brands.find(x => !x.archived);
  const [form, setForm] = useState({ brandId: pillar?.brandId ?? firstBrand?.id ?? null, name: pillar?.name ?? "", description: pillar?.description ?? "", objective: pillar?.objective ?? "", color: pillar?.color ?? "#2563eb", active: pillar ? !!pillar.active : true });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Dialog open onOpenChange={v => !v && !busy && close()}><DialogContent className="standard-modal"><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { await api("pillars" + (pillar ? "/" + pillar.id : ""), pillar ? "PUT" : "POST", form); await saved(); close(); toast.success("Pillar saved"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><DialogHeader><DialogTitle>{pillar ? "Edit Content Pillar" : "New Content Pillar"}</DialogTitle><DialogDescription>Each Pillar belongs to one Brand. Inactive Pillars stay on existing content.</DialogDescription></DialogHeader><div className="modal-scroll form-grid"><Field id="pillar-brand" label="Brand" wide><Choice id="pillar-brand" label="Brand" value={form.brandId == null ? "" : String(form.brandId)} options={data.brands.filter(x => !x.archived || x.id === pillar?.brandId).map(x => ({ value: String(x.id), label: x.name }))} onChange={v => setForm({ ...form, brandId: Number(v) })}/></Field><Field id="pillar-name" label="Name" wide><Input id="pillar-name" required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field id="pillar-description" label="Description" wide><Textarea id="pillar-description" maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></Field><Field id="pillar-objective" label="Objective" wide><Textarea id="pillar-objective" maxLength={1000} value={form.objective} onChange={e => setForm({ ...form, objective: e.target.value })}/></Field><Field id="pillar-color" label="Color"><div className="color-picker"><Input id="pillar-color" type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })}/><span>{form.color}</span></div></Field><Field id="pillar-active" label="Active"><Switch id="pillar-active" checked={form.active} onCheckedChange={active => setForm({ ...form, active })}/></Field>{error && <p role="alert" className="form-error field-wide">{error}</p>}</div><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : "Save Pillar"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function BrandsView({ data, reload }: { data: WorkspaceData; reload: Reload }) {
  const [edit, setEdit] = useState<Brand | "new" | null>(null);
  const [archive, setArchive] = useState<Brand | null>(null);
  const allowed = managers(data.actor.role);
  return <><div className="section-toolbar"><span>{data.brands.length} Brands · {data.brands.filter(x => !x.archived).length} active</span>{allowed && <Button onClick={() => setEdit("new")}><Plus size={16}/>Add Brand</Button>}</div><div className="collection-grid">{data.brands.map(brand => <article className={"panel collection-card" + (brand.archived ? " archived-card" : "")} key={brand.id}><div className="collection-top"><span className="collection-monogram">{initials(brand.name)}</span><span className="subtle-badge">{brand.archived ? "Archived" : "Active"}</span></div><h2>{brand.name}</h2><p>{brand.description || "No description yet."}</p><dl className="detail-list"><div><dt>Timezone</dt><dd>{brand.timezone}</dd></div><div><dt>Slug</dt><dd>{brand.slug}</dd></div></dl><div className="collection-count"><span>{brand.usage} content items</span><strong>{data.pillars.filter(x => x.brandId === brand.id).length} Pillars</strong></div>{allowed && <div className="card-actions"><Button size="sm" variant="outline" onClick={() => setEdit(brand)}>View / edit</Button><Button size="sm" variant="ghost" onClick={() => brand.archived ? void api(`brands/${brand.id}/archive`, "PATCH", { archived: false }).then(reload).then(() => toast.success("Brand restored")).catch(e => toast.error(e.message)) : setArchive(brand)}>{brand.archived ? <><RotateCcw size={14}/>Restore</> : <><Archive size={14}/>Archive</>}</Button></div>}</article>)}</div>{edit && <BrandEditor brand={edit === "new" ? null : edit} close={() => setEdit(null)} reload={reload}/>}<Confirm open={!!archive} close={() => setArchive(null)} title="Archive this Brand?" description="Campaigns, Pillars, and content will be preserved. The Brand cannot be selected for new content until restored." label="Archive Brand" action={async () => { await api(`brands/${archive!.id}/archive`, "PATCH", { archived: true }); await reload(); toast.success("Brand archived"); }}/></>;
}

function BrandEditor({ brand, close, reload }: { brand: Brand | null; close: () => void; reload: Reload }) {
  const [form, setForm] = useState({ name: brand?.name ?? "", description: brand?.description ?? "", slug: brand?.slug ?? "", logo: brand?.logo ?? "", timezone: brand?.timezone ?? "Asia/Jakarta" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Dialog open onOpenChange={v => !v && !busy && close()}><DialogContent className="standard-modal"><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { await api("brands" + (brand ? "/" + brand.id : ""), brand ? "PUT" : "POST", form); await reload(); close(); toast.success("Brand saved"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><DialogHeader><DialogTitle>{brand ? "Brand details" : "New Brand"}</DialogTitle><DialogDescription>Brand settings organize Campaigns, Pillars, and Content.</DialogDescription></DialogHeader><div className="modal-scroll form-grid"><Field label="Name" id="brand-name" wide><Input id="brand-name" required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field label="Description" id="brand-description" wide><Textarea id="brand-description" maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></Field><Field label="Slug" id="brand-slug"><Input id="brand-slug" maxLength={80} value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="created-from-name"/></Field><Field label="Timezone" id="brand-timezone"><Input id="brand-timezone" required maxLength={100} value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} placeholder="Asia/Jakarta"/></Field><Field label="Logo URL (optional)" id="brand-logo" wide><Input id="brand-logo" type="url" maxLength={1000} value={form.logo} onChange={e => setForm({ ...form, logo: e.target.value })} placeholder="https://…"/></Field>{error && <p role="alert" className="form-error field-wide">{error}</p>}</div><DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : "Save Brand"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function CampaignsView({ data, reload }: { data: WorkspaceData; reload: Reload }) {
  const [edit, setEdit] = useState<Campaign | "new" | null>(null);
  const [archive, setArchive] = useState<Campaign | null>(null);
  const [brand, setBrand] = useState("all");
  const allowed = strategists(data.actor.role);
  const list = data.campaigns.filter(x => brand === "all" || String(x.brandId) === brand);
  return <><div className="section-toolbar"><Choice label="Filter Campaigns by Brand" value={brand} options={[{ value: "all", label: "All Brands" }, ...data.brands.map(x => ({ value: String(x.id), label: x.name }))]} onChange={setBrand}/>{allowed && <Button onClick={() => setEdit("new")}><Plus size={16}/>Add Campaign</Button>}</div><div className="collection-grid">{list.map(campaign => { const ready = data.items.filter(i => i.campaignId === campaign.id && ["Approved", "Scheduled"].includes(i.status)).length; return <article className={"panel collection-card" + (campaign.archived ? " archived-card" : "")} key={campaign.id}><div className="collection-top"><span className="collection-monogram">{initials(campaign.name)}</span><span className="subtle-badge">{campaign.status}</span></div><h2>{campaign.name}</h2><p>{campaign.brandName} · {campaign.description || "No description yet."}</p><dl className="detail-list"><div><dt>Audience</dt><dd>{campaign.targetAudience || "Not set"}</dd></div><div><dt>Owner</dt><dd>{campaign.ownerName || "Unassigned"}</dd></div><div><dt>Dates</dt><dd>{campaign.startDate || "—"} to {campaign.endDate || "—"}</dd></div></dl><div className="collection-count"><span>{campaign.usage} content items</span><strong>{ready} ready</strong></div><Progress value={campaign.usage ? ready / campaign.usage * 100 : 0}/>{allowed && <div className="card-actions"><Button size="sm" variant="outline" onClick={() => setEdit(campaign)}>View / edit</Button><Button size="sm" variant="ghost" onClick={() => campaign.archived ? void api(`campaigns/${campaign.id}/archive`, "PATCH", { archived: false }).then(reload).then(() => toast.success("Campaign restored")).catch(e => toast.error(e.message)) : setArchive(campaign)}>{campaign.archived ? <><RotateCcw size={14}/>Restore</> : <><Archive size={14}/>Archive</>}</Button></div>}</article>; })}</div>{edit && <CampaignEditor data={data} campaign={edit === "new" ? null : edit} close={() => setEdit(null)} reload={reload}/>}<Confirm open={!!archive} close={() => setArchive(null)} title="Archive this Campaign?" description="Related content will be preserved. The Campaign cannot be selected for new content until restored." label="Archive Campaign" action={async () => { await api(`campaigns/${archive!.id}/archive`, "PATCH", { archived: true }); await reload(); toast.success("Campaign archived"); }}/></>;
}

function CampaignEditor({ data, campaign, close, reload }: { data: WorkspaceData; campaign: Campaign | null; close: () => void; reload: Reload }) {
  const firstBrand = data.brands.find(x => !x.archived);
  const [form, setForm] = useState({ brandId: campaign?.brandId ?? firstBrand?.id ?? null, name: campaign?.name ?? "", description: campaign?.description ?? "", objective: campaign?.objective ?? "", targetAudience: campaign?.targetAudience ?? "", startDate: campaign?.startDate ?? "", endDate: campaign?.endDate ?? "", ownerMemberId: campaign?.ownerMemberId ?? null, status: campaign?.status ?? "Draft" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Dialog open onOpenChange={v => !v && !busy && close()}><DialogContent className="content-modal"><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { await api("campaigns" + (campaign ? "/" + campaign.id : ""), campaign ? "PUT" : "POST", form); await reload(); close(); toast.success("Campaign saved"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><DialogHeader><DialogTitle>{campaign ? "Campaign details" : "New Campaign"}</DialogTitle><DialogDescription>Connect related content to one Brand and one campaign objective.</DialogDescription></DialogHeader><div className="modal-scroll form-grid"><Field label="Brand" id="campaign-brand"><Choice id="campaign-brand" label="Brand" value={form.brandId == null ? "" : String(form.brandId)} options={data.brands.filter(x => !x.archived || x.id === campaign?.brandId).map(x => ({ value: String(x.id), label: x.name }))} onChange={v => setForm({ ...form, brandId: Number(v) })}/></Field><Field label="Status" id="campaign-status"><Choice id="campaign-status" label="Status" value={form.status} options={options(campaignStatuses)} onChange={v => setForm({ ...form, status: v as Campaign["status"] })}/></Field><Field label="Name" id="campaign-name" wide><Input id="campaign-name" required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field label="Description" id="campaign-description" wide><Textarea id="campaign-description" maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></Field><Field label="Objective" id="campaign-objective" wide><Textarea id="campaign-objective" maxLength={2000} value={form.objective} onChange={e => setForm({ ...form, objective: e.target.value })}/></Field><Field label="Target audience" id="campaign-audience" wide><Textarea id="campaign-audience" maxLength={2000} value={form.targetAudience} onChange={e => setForm({ ...form, targetAudience: e.target.value })}/></Field><Field label="Start date" id="campaign-start"><Input id="campaign-start" type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })}/></Field><Field label="End date" id="campaign-end"><Input id="campaign-end" type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })}/></Field><Field label="Owner" id="campaign-owner" wide><Choice id="campaign-owner" label="Campaign owner" value={form.ownerMemberId == null ? "_none" : String(form.ownerMemberId)} options={[{ value: "_none", label: "Unassigned" }, ...data.members.filter(x => x.status !== "Inactive" || x.id === campaign?.ownerMemberId).map(x => ({ value: String(x.id), label: x.name }))]} onChange={v => setForm({ ...form, ownerMemberId: v === "_none" ? null : Number(v) })}/></Field>{error && <p role="alert" className="form-error field-wide">{error}</p>}</div><DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : "Save Campaign"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function CalendarView({ data, open }: { data: WorkspaceData; open: (item: ContentItem) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const filtered = useMemo(() => data.items.filter(x => (filters.brandId === "all" || String(x.brandId) === filters.brandId) && (filters.campaignId === "all" || String(x.campaignId) === filters.campaignId) && (filters.pillarId === "all" || String(x.pillarId) === filters.pillarId) && (filters.status === "all" || x.status === filters.status) && (filters.platform === "all" || x.platform === filters.platform) && (filters.pic === "all" || (x.pic || "Unassigned") === filters.pic)), [data.items, filters]);
  const year = month.getFullYear(), m = month.getMonth(), days = new Date(year, m + 1, 0).getDate();
  const count = Math.ceil((month.getDay() + days) / 7) * 7;
  const dayString = (day: number) => year + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  const monthItems = filtered.filter(x => x.publishDate.startsWith(dayString(1).slice(0, 7)));
  const showItems = selected ? filtered.filter(x => x.publishDate === selected) : monthItems;
  return <><Filters data={data} value={filters} change={setFilters}/><div className="section-toolbar calendar-toolbar"><h2>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2><div className="table-actions"><Button variant="outline" size="icon" aria-label="Previous month" onClick={() => { setMonth(new Date(year, m - 1, 1)); setSelected(null); }}><ChevronLeft size={17}/></Button><Button variant="outline" onClick={() => { setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); setSelected(null); }}>Today</Button><Button variant="outline" size="icon" aria-label="Next month" onClick={() => { setMonth(new Date(year, m + 1, 1)); setSelected(null); }}><ChevronRight size={17}/></Button></div></div><div className="panel calendar-panel"><div className="calendar-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(x => <div key={x}>{x}</div>)}</div><div className="calendar-grid">{Array.from({ length: count }, (_, i) => { const day = i - month.getDay() + 1; const valid = day > 0 && day <= days; const date = valid ? dayString(day) : ""; const list = filtered.filter(x => x.publishDate === date); return <div className={"calendar-day" + (!valid ? " outside-month" : "") + (date === new Date().toLocaleDateString("en-CA") ? " today" : "")} key={i}>{valid && <><button className="day-number" aria-label={"Show content for " + date} onClick={() => setSelected(selected === date ? null : date)}>{day}</button><div className="calendar-posts">{list.slice(0, 3).map(x => <button key={x.id} className={"calendar-post status-" + x.status.toLowerCase()} onClick={() => open(x)} title={x.title}>{x.title}</button>)}{list.length > 3 && <button className="calendar-more" onClick={() => setSelected(date)}>+{list.length - 3} more</button>}</div>{!!list.length && <span className="mobile-day-count">{list.length}</span>}</>}</div>; })}</div></div><section className={"calendar-agenda panel" + (selected ? " agenda-selected" : "")}><div className="panel-heading"><h2>{selected ? dateLabel(selected) : "This month"} · {showItems.length} items</h2>{selected && <Button variant="ghost" onClick={() => setSelected(null)}>Show month</Button>}</div>{!showItems.length ? <EmptyState title="Nothing planned" description="Content with a planned publish date in this period appears here."/> : showItems.map(x => <button className="agenda-row" key={x.id} onClick={() => open(x)}><span>{dateLabel(x.publishDate)}</span><strong>{x.title}</strong><StatusBadge status={x.status}/></button>)}</section></>;
}

export function ActivityView() {
  const [items, setItems] = useState<Activity[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void api<{ activities: Activity[] }>("activity?limit=100").then(x => setItems(x.activities)).catch(e => setError(e.message)); }, []);
  return <section className="panel activity-panel"><div className="panel-heading"><h2>Recent workspace activity</h2><History size={18}/></div>{error && <p className="form-error">{error}</p>}{!items.length && !error ? <EmptyState title="No activity yet" description="Important changes will appear here."/> : <div className="activity-list">{items.map(item => <article key={item.id}><span className="activity-icon"><History size={15}/></span><div><strong>{item.actorName}</strong><p>{item.summary || item.action.replaceAll("_", " ")}</p><small>{item.entityTitle} · {new Date(item.createdAt + (item.createdAt.includes("Z") ? "" : "Z")).toLocaleString()}</small></div></article>)}</div>}</section>;
}

export function TeamView({ data, reload }: { data: WorkspaceData; reload: Reload }) {
  const [add, setAdd] = useState(false);
  if (!managers(data.actor.role)) return <EmptyState title="Team settings are restricted" description="Only the Owner and Admin can manage team members."/>;
  return <><div className="section-toolbar"><span>{data.members.length} workspace members</span><Button onClick={() => setAdd(true)}><Plus size={16}/>Add member</Button></div><div className="access-note"><LockKeyhole size={18}/><p>Adding a member creates their role in Creative Hub. The hosted Site currently allows public access to the login surface, but workspace data remains limited to members by the server.</p></div><section className="panel table-scroll"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{data.members.map(member => <MemberRow key={member.id + member.role + member.status} member={member} self={member.id === data.actor.id} reload={reload}/>)}</TableBody></Table></section>{add && <MemberEditor close={() => setAdd(false)} reload={reload}/>}</>;
}

function MemberRow({ member, self, reload }: { member: Member; self: boolean; reload: Reload }) {
  const [role, setRole] = useState(member.role); const [busy, setBusy] = useState(false); const [disable, setDisable] = useState(false);
  const protectedMember = member.role === "Owner" || self;
  async function update(values: Record<string, unknown>) { setBusy(true); try { await api("members/" + member.id, "PATCH", values); await reload(); toast.success("Member updated"); } finally { setBusy(false); } }
  return <TableRow><TableCell><div className="member-name"><span className="avatar">{initials(member.name)}</span><strong>{member.name}{self ? " (you)" : ""}</strong></div></TableCell><TableCell>{member.email}</TableCell><TableCell>{protectedMember ? <span className="owner-role">{member.role}<LockKeyhole size={13}/></span> : <Choice label={"Role for " + member.name} value={role} options={options(roles.filter(x => x !== "Owner"))} disabled={busy} onChange={v => setRole(v as Member["role"])}/>}</TableCell><TableCell><span className="subtle-badge">{member.status}</span></TableCell><TableCell>{!protectedMember && <div className="table-actions"><Button size="sm" variant="outline" disabled={busy || role === member.role} onClick={() => void update({ role }).catch(e => toast.error(e.message))}>Save role</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => member.status === "Inactive" ? void update({ status: member.userId ? "Active" : "Invited" }).catch(e => toast.error(e.message)) : setDisable(true)}>{member.status === "Inactive" ? "Reactivate" : "Disable"}</Button></div>}<Confirm open={disable} close={() => setDisable(false)} title={"Disable " + member.name + "?"} description="This member will lose workspace access. Their assigned content will be preserved." label="Disable member" action={() => update({ status: "Inactive" })}/></TableCell></TableRow>;
}

function MemberEditor({ close, reload }: { close: () => void; reload: Reload }) {
  const [form, setForm] = useState({ name: "", email: "", role: "Viewer" }); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Dialog open onOpenChange={v => !v && !busy && close()}><DialogContent className="standard-modal"><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { await api("members", "POST", form); await reload(); close(); toast.success("Member added"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><DialogHeader><DialogTitle>Add a team member</DialogTitle><DialogDescription>Use the email address they use to sign in with ChatGPT.</DialogDescription></DialogHeader><div className="modal-scroll form-grid"><Field id="member-name" label="Name" wide><Input id="member-name" required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field id="member-email" label="Email" wide><Input id="member-email" required type="email" maxLength={254} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></Field><Field id="member-role" label="Role" wide><Choice id="member-role" label="Role" value={form.role} options={options(roles.filter(x => x !== "Owner"))} onChange={role => setForm({ ...form, role })}/></Field>{error && <p className="form-error" role="alert">{error}</p>}</div><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Adding…" : "Add member"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function WorkspaceSettings({ data, reload }: { data: WorkspaceData; reload: Reload }) {
  const [form, setForm] = useState({ name: data.workspace.name, slug: data.workspace.slug, timezone: data.workspace.timezone });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  if (data.actor.role !== "Owner") return <EmptyState title="Workspace settings are restricted" description="Only the Owner can change these settings."/>;
  return <section className="panel settings-panel"><h2>Workspace details</h2><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { await api("workspace", "PATCH", form); await reload(); toast.success("Workspace saved"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><Field label="Workspace name" id="workspace-name"><Input id="workspace-name" maxLength={100} required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field label="Workspace slug" id="workspace-slug"><Input id="workspace-slug" maxLength={80} required value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })}/></Field><Field label="Timezone" id="workspace-timezone"><Input id="workspace-timezone" maxLength={100} required value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}/></Field><p>The Owner role is protected. It cannot be removed or reassigned here.</p>{error && <p className="form-error" role="alert">{error}</p>}<Button disabled={busy}>{busy ? "Saving…" : "Save workspace"}</Button></form></section>;
}
