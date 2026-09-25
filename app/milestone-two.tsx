/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowDown, ArrowUp, Download, File, Film, Grid2X2, Image as ImageIcon, List, Paperclip, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  assetUsages, canManageLibraryAsset, canUploadMedia, contentFormats, editableFields, priorities, statuses, variantPlatforms,
  type Activity, type ApprovalRecord, type Comment, type ContentAsset, type ContentItem, type MediaAsset,
  type PlatformVariant, type StatusHistory, type WorkspaceData,
} from "@/lib/hub-types";
import { api, dateLabel } from "./creative-hub";
import { Choice, Confirm, EmptyState, Field, PriorityBadge, StatusBadge, options } from "./hub-views";
import { ApprovalPanel, DiscussionPanel } from "./milestone-three";

type Detail = {
  item: ContentItem; variants: PlatformVariant[]; assets: ContentAsset[]; activities: Activity[];
  comments: Comment[]; approvals: ApprovalRecord[]; statusHistory: StatusHistory[]; currentApproval: ApprovalRecord | null;
  permissions: {
    manageAssets: boolean; manageVariants: boolean; uploadMedia: boolean; approve: boolean;
    comment: boolean; submitReview: boolean; decideApproval: boolean; resolveAllComments: boolean;
  };
};

const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
const mediaIcon = (kind: MediaAsset["kind"]) => kind === "image" ? <ImageIcon/> : kind === "video" ? <Film/> : <File/>;

async function metadata(file: File) {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return {};
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = reject; image.src = url;
    });
    return await new Promise<{ width: number; height: number; durationSeconds: number }>((resolve, reject) => {
      const video = document.createElement("video"); video.preload = "metadata"; video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight, durationSeconds: Math.round(video.duration || 0) }); video.onerror = reject; video.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

async function uploadFile(file: File): Promise<MediaAsset> {
  const details = await metadata(file).catch(() => ({}));
  const params = new URLSearchParams({ fileName: file.name });
  for (const [key, value] of Object.entries(details)) params.set(key, String(value));
  const response = await fetch(`/api/hub/media/upload?${params}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  const result = await response.json() as { asset?: MediaAsset; error?: string };
  if (!response.ok || !result.asset) throw new Error(result.error || "The file could not be uploaded.");
  return result.asset;
}

export function MediaLibraryView({ data }: { data: WorkspaceData }) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  const [rename, setRename] = useState<MediaAsset | null>(null);
  const [remove, setRemove] = useState<MediaAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(); if (query.trim()) params.set("query", query.trim()); if (kind !== "all") params.set("kind", kind);
      setAssets((await api<{ assets: MediaAsset[] }>("media?" + params)).assets);
    } catch (error) { toast.error((error as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { const timer = setTimeout(() => void load(), 180); return () => clearTimeout(timer); }, [query, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { for (const file of Array.from(files)) await uploadFile(file); await load(); toast.success(`${files.length} file${files.length === 1 ? "" : "s"} uploaded`); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <>
    <div className="media-toolbar">
      <div className="library-search"><Search size={17}/><Input aria-label="Search Media Library" placeholder="Search files…" value={query} onChange={e => setQuery(e.target.value)}/></div>
      <Choice label="Filter media by type" value={kind} options={[{ value: "all", label: "All file types" }, { value: "image", label: "Images" }, { value: "video", label: "Videos" }, { value: "document", label: "Documents" }]} onChange={setKind}/>
      <div className="view-toggle"><Button size="icon" variant={view === "grid" ? "default" : "outline"} aria-label="Grid view" onClick={() => setView("grid")}><Grid2X2/></Button><Button size="icon" variant={view === "list" ? "default" : "outline"} aria-label="List view" onClick={() => setView("list")}><List/></Button></div>
      {canUploadMedia(data.actor.role) && <><input ref={input} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,text/csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx" onChange={e => void upload(e.target.files)}/><Button disabled={busy} onClick={() => input.current?.click()}><Upload/>{busy ? "Uploading…" : "Upload files"}</Button></>}
    </div>
    <p className="upload-guidance">Images and documents up to 25 MB. Videos up to 75 MB. Files stay private to signed-in workspace members.</p>
    {loading ? <div className="media-loading">Loading Media Library…</div> : !assets.length ? <EmptyState title="No files found" description="Upload an image, video, or document to start the Media Library."/> :
      <div className={view === "grid" ? "media-grid" : "media-list"}>{assets.map(asset => <article className="media-card" key={asset.id}>
        <button className="media-preview-button" onClick={() => setPreview(asset)}>{asset.kind === "image" ? <img src={`/api/hub/media/${asset.id}/file`} alt=""/> : <span className={`media-kind media-${asset.kind}`}>{mediaIcon(asset.kind)}</span>}</button>
        <div className="media-card-copy"><strong title={asset.fileName}>{asset.fileName}</strong><span>{asset.kind} · {bytes(asset.fileSize)}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</span><span>{asset.uploaderName || "Unknown uploader"} · {dateLabel(asset.createdAt.slice(0, 10))}</span></div>
        <div className="media-card-actions"><Button size="sm" variant="ghost" onClick={() => setPreview(asset)}>Preview</Button>{canManageLibraryAsset(data.actor, asset) && <><Button size="icon" variant="ghost" aria-label={`Rename ${asset.fileName}`} onClick={() => setRename(asset)}><Pencil/></Button><Button size="icon" variant="ghost" aria-label={`Delete ${asset.fileName}`} onClick={() => setRemove(asset)}><Trash2/></Button></>}</div>
      </article>)}</div>}
    <MediaPreview asset={preview} close={() => setPreview(null)}/>
    {rename && <RenameAsset asset={rename} close={() => setRename(null)} saved={async () => { setRename(null); await load(); }}/>} 
    <Confirm open={!!remove} close={() => setRemove(null)} title="Delete this file?" description={remove?.attachmentCount ? `This file is attached in ${remove.attachmentCount} place(s). Detach it first.` : "The original file will be permanently removed from Media Library."} label="Delete file" action={async () => { await api(`media/${remove!.id}`, "DELETE", {}); await load(); toast.success("File deleted"); }}/>
  </>;
}

function RenameAsset({ asset, close, saved }: { asset: MediaAsset; close: () => void; saved: () => Promise<void> }) {
  const [name, setName] = useState(asset.fileName); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Dialog open onOpenChange={value => !value && !busy && close()}><DialogContent><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { await api(`media/${asset.id}`, "PUT", { fileName: name }); await saved(); toast.success("File renamed"); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }}><DialogHeader><DialogTitle>Rename file</DialogTitle><DialogDescription>The stored file stays in place. Only its display name changes.</DialogDescription></DialogHeader><div className="dialog-field"><Label htmlFor="rename-file">File name</Label><Input id="rename-file" required maxLength={180} value={name} onChange={e => setName(e.target.value)}/>{error && <p className="form-error">{error}</p>}</div><DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : "Save name"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function MediaPreview({ asset, close }: { asset: MediaAsset | null; close: () => void }) {
  if (!asset) return null;
  const source = `/api/hub/media/${asset.id}/file`;
  return <Dialog open onOpenChange={value => !value && close()}><DialogContent className="media-preview-dialog"><DialogHeader><DialogTitle>{asset.fileName}</DialogTitle><DialogDescription>{asset.mimeType} · {bytes(asset.fileSize)}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}{asset.durationSeconds ? ` · ${asset.durationSeconds}s` : ""}</DialogDescription></DialogHeader><div className="media-full-preview">{asset.kind === "image" ? <img src={source} alt={asset.fileName}/> : asset.kind === "video" ? <video src={source} controls preload="metadata"/> : <div className="document-preview"><File/><p>Preview this document in a new tab or download it.</p></div>}</div><DialogFooter><Button variant="outline" onClick={close}>Close</Button><Button asChild><a href={`${source}?download=1`} target="_blank" rel="noreferrer"><Download/>Open / download</a></Button></DialogFooter></DialogContent></Dialog>;
}

export function ContentWorkspace({ contentId, data, back, changed }: { contentId: number; data: WorkspaceData; back: () => void; changed: () => Promise<WorkspaceData> }) {
  const [detail, setDetail] = useState<Detail | null>(null); const [error, setError] = useState("");
  const load = async () => { try { setDetail(await api<Detail>(`content/${contentId}/workspace`)); setError(""); } catch (issue) { setError((issue as Error).message); } };
  useEffect(() => {
    let active = true;
    api<Detail>(`content/${contentId}/workspace`)
      .then(value => { if (active) { setDetail(value); setError(""); } })
      .catch(issue => { if (active) setError((issue as Error).message); });
    return () => { active = false; };
  }, [contentId]);
  if (error) return <div className="error-banner"><span>{error}</span><Button variant="outline" onClick={back}>Back to All Content</Button></div>;
  if (!detail) return <div className="media-loading">Loading creative workspace…</div>;
  const item = detail.item;
  const fields = editableFields(data.actor, item);
  const save = async (payload: Record<string, unknown>) => { await api(`content/${item.id}`, "PUT", { version: item.version, ...payload }); await Promise.all([load(), changed()]); toast.success("Content updated"); };
  return <div className="creative-workspace">
    <div className="detail-header"><Button variant="ghost" onClick={back}><ArrowLeft/>All Content</Button><div className="detail-title"><div><span>{item.brand}{item.campaign ? ` · ${item.campaign}` : ""}</span><h1>{item.title}</h1></div><div className="detail-badges"><StatusBadge status={item.status}/><PriorityBadge priority={item.priority}/></div></div></div>
    <Tabs defaultValue="overview" className="workspace-tabs"><TabsList variant="line" className="workspace-tab-list">{["Overview", "Brief", "Copy", "Platforms", "Assets", "Discussion", "Approval", "Activity"].map(label => <TabsTrigger key={label} value={label.toLowerCase()}>{label}</TabsTrigger>)}</TabsList>
      <TabsContent value="overview"><Overview item={item} data={data} fields={fields} save={save}/></TabsContent>
      <TabsContent value="brief"><Brief item={item} fields={fields} save={save}/></TabsContent>
      <TabsContent value="copy"><Copy item={item} fields={fields} save={save}/></TabsContent>
      <TabsContent value="platforms"><PlatformVersions detail={detail} reload={load}/></TabsContent>
      <TabsContent value="assets"><AssetAttachments contentId={item.id} assets={detail.assets} canManage={detail.permissions.manageAssets} canUpload={detail.permissions.uploadMedia} reload={load}/></TabsContent>
      <TabsContent value="discussion"><DiscussionPanel item={item} actor={data.actor} comments={detail.comments} permissions={detail.permissions} reload={load}/></TabsContent>
      <TabsContent value="approval"><ApprovalPanel item={item} approvals={detail.approvals} currentApproval={detail.currentApproval} statusHistory={detail.statusHistory} permissions={detail.permissions} reload={async () => { await load(); await changed(); }}/></TabsContent>
      <TabsContent value="activity"><ActivityTimeline activities={detail.activities}/></TabsContent>
    </Tabs>
  </div>;
}

function Overview({ item, data, fields, save }: { item: ContentItem; data: WorkspaceData; fields: string[]; save: (payload: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ title: item.title, brandId: item.brandId, campaignId: item.campaignId, pillarId: item.pillarId, status: item.status, priority: item.priority, assigneeId: item.assigneeId, pic: item.pic, format: item.format, deadline: item.deadline, publishDate: item.publishDate });
  const [busy, setBusy] = useState(false); const enabled = (name: string) => fields.includes(name);
  const campaigns = data.campaigns.filter(x => x.brandId === form.brandId && (!x.archived || x.id === item.campaignId));
  const pillars = data.pillars.filter(x => x.brandId === form.brandId && (x.active || x.id === item.pillarId));
  const update = (key: string, value: unknown) => setForm(current => ({ ...current, [key]: value }));
  return <Section title="Content overview" description="The essential planning and ownership details for this content."><form className="detail-form" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await save(form); } catch (issue) { toast.error((issue as Error).message); } finally { setBusy(false); } }}>
    <Field label="Content title" id="detail-title" wide><Input id="detail-title" value={form.title} disabled={!enabled("title")} onChange={e => update("title", e.target.value)}/></Field>
    <Field label="Brand" id="detail-brand"><Choice id="detail-brand" label="Brand" value={String(form.brandId ?? "")} disabled={!enabled("brandId")} options={data.brands.map(x => ({ value: String(x.id), label: x.name }))} onChange={value => setForm({ ...form, brandId: Number(value), campaignId: null, pillarId: null })}/></Field>
    <Field label="Campaign" id="detail-campaign"><Choice id="detail-campaign" label="Campaign" value={form.campaignId == null ? "_none" : String(form.campaignId)} disabled={!enabled("campaignId")} options={[{ value: "_none", label: "No Campaign" }, ...campaigns.map(x => ({ value: String(x.id), label: x.name }))]} onChange={value => update("campaignId", value === "_none" ? null : Number(value))}/></Field>
    <Field label="Content Pillar" id="detail-pillar"><Choice id="detail-pillar" label="Content Pillar" value={form.pillarId == null ? "_none" : String(form.pillarId)} disabled={!enabled("pillarId")} options={[{ value: "_none", label: "No Pillar" }, ...pillars.map(x => ({ value: String(x.id), label: x.name }))]} onChange={value => update("pillarId", value === "_none" ? null : Number(value))}/></Field>
    <Field label="Status" id="detail-status"><Choice id="detail-status" label="Status" value={form.status} disabled options={options([item.status])} onChange={value => update("status", value)}/></Field>
    <Field label="Priority" id="detail-priority"><Choice id="detail-priority" label="Priority" value={form.priority} disabled={!enabled("priority")} options={options(priorities)} onChange={value => update("priority", value)}/></Field>
    <Field label="PIC / owner" id="detail-assignee"><Choice id="detail-assignee" label="PIC / owner" value={form.assigneeId == null ? "_none" : String(form.assigneeId)} disabled={!enabled("assigneeId")} options={[{ value: "_none", label: "Unassigned / named PIC" }, ...data.members.filter(x => x.status !== "Inactive").map(x => ({ value: String(x.id), label: x.name }))]} onChange={value => { const id = value === "_none" ? null : Number(value); setForm({ ...form, assigneeId: id, pic: id ? data.members.find(x => x.id === id)?.name ?? "" : form.pic }); }}/></Field>
    {form.assigneeId == null && <Field label="Named PIC" id="detail-pic"><Input id="detail-pic" value={form.pic} disabled={!enabled("pic")} onChange={e => update("pic", e.target.value)}/></Field>}
    <Field label="Creator" id="detail-creator"><Input id="detail-creator" value={item.creatorName || "Unknown"} disabled/></Field>
    <Field label="Content format" id="detail-format"><Choice id="detail-format" label="Content format" value={form.format} disabled={!enabled("format")} options={options(contentFormats)} onChange={value => update("format", value)}/></Field>
    <Field label="Deadline" id="detail-deadline"><Input id="detail-deadline" type="date" value={form.deadline} disabled={!enabled("deadline")} onChange={e => update("deadline", e.target.value)}/></Field>
    <Field label="Planned publish date" id="detail-publish"><Input id="detail-publish" type="date" value={form.publishDate} disabled={!enabled("publishDate")} onChange={e => update("publishDate", e.target.value)}/></Field>
    <div className="record-summary field-wide"><span><strong>Platforms</strong>{item.platform}</span><span><strong>Created</strong>{item.createdAt || "—"}</span><span><strong>Updated</strong>{item.updatedAt || "—"}</span></div>
    {fields.length > 0 && <div className="detail-save field-wide"><Button disabled={busy}>{busy ? "Saving…" : "Save overview"}</Button></div>}
  </form></Section>;
}

function Brief({ item, fields, save }: { item: ContentItem; fields: string[]; save: (payload: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ objective: item.objective, targetAudience: item.targetAudience, keyMessage: item.keyMessage, contentDirection: item.contentDirection, brief: item.brief, references: item.references, notes: item.notes });
  return <StructuredForm title="Creative brief" description="Give the team one clear source for the intent, audience, and direction." form={form} setForm={setForm} fields={fields} save={save} labels={{ objective: "Objective", targetAudience: "Target audience", keyMessage: "Key message", contentDirection: "Content direction", brief: "Creative brief", references: "References", notes: "Notes" }} rows={{ objective: 2, targetAudience: 2, keyMessage: 3, contentDirection: 4, brief: 6, references: 3, notes: 3 }} button="Save brief"/>;
}

function Copy({ item, fields, save }: { item: ContentItem; fields: string[]; save: (payload: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ caption: item.caption, copyHook: item.copyHook, copyCta: item.copyCta, copyNotes: item.copyNotes });
  return <StructuredForm title="Master Copy" description="The central copy that platform versions can adapt without changing the original." form={form} setForm={setForm} fields={fields} save={save} labels={{ caption: "Main caption / copy", copyHook: "Hook", copyCta: "CTA", copyNotes: "Copy notes" }} rows={{ caption: 8, copyHook: 3, copyCta: 2, copyNotes: 4 }} button="Save Master Copy"/>;
}

function StructuredForm<T extends Record<string, string>>({ title, description, form, setForm, fields, save, labels, rows, button }: { title: string; description: string; form: T; setForm: React.Dispatch<React.SetStateAction<T>>; fields: string[]; save: (payload: Record<string, unknown>) => Promise<void>; labels: Record<string, string>; rows: Record<string, number>; button: string }) {
  const [busy, setBusy] = useState(false); const editable = Object.keys(form).some(key => fields.includes(key));
  return <Section title={title} description={description}><form className="structured-form" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await save(form); } catch (issue) { toast.error((issue as Error).message); } finally { setBusy(false); } }}>{Object.entries(form).map(([key, value]) => <Field key={key} label={labels[key]} id={`field-${key}`} wide><Textarea id={`field-${key}`} rows={rows[key]} disabled={!fields.includes(key)} value={value} onChange={e => setForm(current => ({ ...current, [key]: e.target.value } as T))}/></Field>)}{editable && <div className="detail-save"><Button disabled={busy}>{busy ? "Saving…" : button}</Button></div>}</form></Section>;
}

function PlatformVersions({ detail, reload }: { detail: Detail; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState<PlatformVariant | "new" | null>(null); const [remove, setRemove] = useState<PlatformVariant | null>(null);
  return <Section title="Platform versions" description="Prepare channel-specific copy and assets without changing the Master Copy.">
    <div className="section-toolbar"><span>{detail.variants.length} platform version{detail.variants.length === 1 ? "" : "s"}</span>{detail.permissions.manageVariants && <Button onClick={() => setEdit("new")}><Plus/>Add version</Button>}</div>
    <div className="variant-grid">{detail.variants.map(variant => <article className="variant-card" key={variant.id}><header><span className="platform-chip">{variant.platform}</span><StatusBadge status={variant.status}/></header><h3>{variant.title || detail.item.title}</h3><p>{variant.caption || variant.description || "No platform copy yet."}</p><div className="variant-meta"><span>{variant.plannedPublishAt ? variant.plannedPublishAt.replace("T", " · ") : "No publish time"}</span><span>{variant.assets.length} assets</span></div><footer><Button size="sm" variant="ghost" onClick={() => setEdit(variant)}>{detail.permissions.manageVariants ? "Edit" : "View"}</Button>{detail.permissions.manageVariants && <Button size="icon" variant="ghost" aria-label={`Delete ${variant.platform} version`} onClick={() => setRemove(variant)}><Trash2/></Button>}</footer></article>)}</div>
    {!detail.variants.length && <EmptyState title="No platform versions yet" description="Add Instagram, TikTok, Facebook, LinkedIn, or YouTube preparation records."/>}
    {edit && <VariantEditor item={detail.item} variant={edit === "new" ? null : edit} canManage={detail.permissions.manageVariants} close={() => setEdit(null)} saved={async () => { setEdit(null); await reload(); }}/>} 
    <Confirm open={!!remove} close={() => setRemove(null)} title="Delete this platform version?" description="Its Media Library files will be preserved." label="Delete version" action={async () => { await api(`variants/${remove!.id}`, "DELETE", {}); await reload(); toast.success("Platform version deleted"); }}/>
  </Section>;
}

function VariantEditor({ item, variant, canManage, close, saved }: { item: ContentItem; variant: PlatformVariant | null; canManage: boolean; close: () => void; saved: () => Promise<void> }) {
  const [form, setForm] = useState({ platform: variant?.platform ?? "Instagram", title: variant?.title ?? "", caption: variant?.caption ?? "", description: variant?.description ?? "", hashtags: variant?.hashtags ?? "", cta: variant?.cta ?? "", notes: variant?.notes ?? "", plannedPublishAt: variant?.plannedPublishAt ?? "", status: variant?.status ?? "Idea" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const update = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }));
  return <Dialog open onOpenChange={value => !value && !busy && close()}><DialogContent className="variant-dialog"><form onSubmit={async e => { e.preventDefault(); if (!canManage) return; setBusy(true); setError(""); try { await api(variant ? `variants/${variant.id}` : `content/${item.id}/variants`, variant ? "PUT" : "POST", variant ? { ...form, version: variant.version } : form); await saved(); toast.success("Platform version saved"); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }}><DialogHeader><DialogTitle>{variant ? `${variant.platform} version` : "New platform version"}</DialogTitle><DialogDescription>Prepare copy, timing, and assets. No social account is connected and nothing is published automatically.</DialogDescription></DialogHeader><div className="modal-scroll detail-form">
    <Field label="Platform" id="variant-platform"><Choice id="variant-platform" label="Platform" value={form.platform} disabled={!canManage || !!variant} options={options(variantPlatforms)} onChange={value => update("platform", value)}/></Field><Field label="Status" id="variant-status"><Choice id="variant-status" label="Status" value={form.status} disabled={!canManage} options={options(statuses)} onChange={value => update("status", value)}/></Field><Field label="Planned publish date & time" id="variant-date" wide><Input id="variant-date" type="datetime-local" disabled={!canManage} value={form.plannedPublishAt} onChange={e => update("plannedPublishAt", e.target.value)}/></Field>
    <Field label={form.platform === "YouTube" ? "YouTube title" : "Version title"} id="variant-title" wide><Input id="variant-title" disabled={!canManage} value={form.title} onChange={e => update("title", e.target.value)}/></Field><Field label="Caption" id="variant-caption" wide><Textarea id="variant-caption" rows={5} disabled={!canManage} value={form.caption} onChange={e => update("caption", e.target.value)}/></Field><Field label={form.platform === "YouTube" ? "YouTube description" : "Description"} id="variant-description" wide><Textarea id="variant-description" rows={5} disabled={!canManage} value={form.description} onChange={e => update("description", e.target.value)}/></Field><Field label="Hashtags" id="variant-hashtags" wide><Textarea id="variant-hashtags" rows={2} disabled={!canManage} value={form.hashtags} onChange={e => update("hashtags", e.target.value)}/></Field><Field label="CTA" id="variant-cta" wide><Textarea id="variant-cta" rows={2} disabled={!canManage} value={form.cta} onChange={e => update("cta", e.target.value)}/></Field><Field label="Notes" id="variant-notes" wide><Textarea id="variant-notes" rows={3} disabled={!canManage} value={form.notes} onChange={e => update("notes", e.target.value)}/></Field>{variant && <div className="field-wide"><AssetAttachments contentId={item.id} variant={variant} assets={variant.assets} canManage={canManage} canUpload={canManage} reload={saved}/></div>}{error && <p className="form-error field-wide">{error}</p>}
  </div><DialogFooter><Button type="button" variant="outline" onClick={close}>{canManage ? "Cancel" : "Close"}</Button>{canManage && <Button disabled={busy}>{busy ? "Saving…" : "Save version"}</Button>}</DialogFooter></form></DialogContent></Dialog>;
}

function AssetAttachments({ contentId, variant, assets, canManage, canUpload, reload }: { contentId: number; variant?: PlatformVariant; assets: ContentAsset[]; canManage: boolean; canUpload: boolean; reload: () => Promise<void> }) {
  const [library, setLibrary] = useState<MediaAsset[]>([]); const [selected, setSelected] = useState(""); const [purpose, setPurpose] = useState<(typeof assetUsages)[number]>("Supporting Asset"); const [preview, setPreview] = useState<MediaAsset | null>(null); const [busy, setBusy] = useState(false); const input = useRef<HTMLInputElement>(null);
  const refreshLibrary = async () => setLibrary((await api<{ assets: MediaAsset[] }>("media")).assets);
  useEffect(() => {
    let active = true;
    api<{ assets: MediaAsset[] }>("media").then(value => { if (active) setLibrary(value.assets); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const endpoint = variant ? `variants/${variant.id}/assets` : `content/${contentId}/assets`;
  const attach = async (assetId: number) => { setBusy(true); try { await api(endpoint, "POST", { mediaAssetId: assetId, usage: purpose }); await reload(); await refreshLibrary(); toast.success("Asset attached"); } catch (issue) { toast.error((issue as Error).message); } finally { setBusy(false); } };
  const upload = async (files: FileList | null) => { if (!files?.length) return; setBusy(true); try { for (const file of Array.from(files)) { const asset = await uploadFile(file); await api(endpoint, "POST", { mediaAssetId: asset.id, usage: purpose }); } await reload(); await refreshLibrary(); toast.success("Uploaded and attached"); } catch (issue) { toast.error((issue as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ""; } };
  const reorder = async (index: number, offset: number) => { const ids = assets.map(x => x.linkId); [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]; await api(`content/${contentId}/assets/reorder`, "PATCH", { ids }); await reload(); };
  return <div className="asset-attachments"><div className="asset-attach-toolbar"><strong>{variant ? `${variant.platform} assets` : "Content assets"}</strong>{canManage && <><Choice label="Asset purpose" value={purpose} options={options(assetUsages)} onChange={value => setPurpose(value as typeof purpose)}/><Select value={selected} onValueChange={setSelected}><SelectTrigger aria-label="Choose a Media Library file"><SelectValue placeholder="Choose from Media Library"/></SelectTrigger><SelectContent>{library.filter(asset => !assets.some(attached => attached.id === asset.id)).map(asset => <SelectItem key={asset.id} value={String(asset.id)}>{asset.fileName}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={!selected || busy} onClick={() => void attach(Number(selected))}><Paperclip/>Attach</Button>{canUpload && <><input hidden ref={input} type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,text/csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx" onChange={e => void upload(e.target.files)}/><Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload/>Upload new</Button></>}</>}</div>
    <div className="attached-grid">{assets.map((asset, index) => <article key={asset.linkId} className="attached-card"><button className="attached-thumb" onClick={() => setPreview(asset)}>{asset.kind === "image" ? <img src={`/api/hub/media/${asset.id}/file`} alt=""/> : mediaIcon(asset.kind)}</button><div><strong>{asset.fileName}</strong><span>{asset.usage} · {bytes(asset.fileSize)}</span></div>{canManage && <div className="attached-actions">{!variant && <><Button size="icon" variant="ghost" disabled={!index} aria-label="Move asset up" onClick={() => void reorder(index, -1)}><ArrowUp/></Button><Button size="icon" variant="ghost" disabled={index === assets.length - 1} aria-label="Move asset down" onClick={() => void reorder(index, 1)}><ArrowDown/></Button></>}<Button size="icon" variant="ghost" aria-label={`Detach ${asset.fileName}`} onClick={async () => { await api(`${endpoint}/${asset.linkId}`, "DELETE", {}); await reload(); await refreshLibrary(); toast.success("Asset detached; library file preserved"); }}><X/></Button></div>}</article>)}</div>
    {!assets.length && <p className="empty-inline">No assets attached yet.</p>}<MediaPreview asset={preview} close={() => setPreview(null)}/>
  </div>;
}

function ActivityTimeline({ activities }: { activities: Activity[] }) {
  return <Section title="Content activity" description="Important changes to this content are recorded here.">{activities.length ? <div className="activity-timeline">{activities.map(entry => <article key={entry.id}><i/><div><strong>{entry.actorName}</strong><p>{entry.summary}</p><span>{entry.createdAt}</span></div></article>)}</div> : <EmptyState title="No content activity yet" description="Updates to this content will appear here."/>}</Section>;
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="workspace-section"><header><div><h2>{title}</h2><p>{description}</p></div></header>{children}</section>;
}
