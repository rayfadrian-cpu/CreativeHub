/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, CircleAlert, FileVideo, Image as ImageIcon, LoaderCircle, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canCreate, canUploadMedia, priorities, type ContentItem, type MediaAsset, type PlatformVariant, type SocialAccount, type WorkspaceData } from "@/lib/hub-types";
import { api } from "./creative-hub";
import { Choice, EmptyState, Field, options } from "./hub-views";
import { uploadFile } from "./milestone-two";

type InstagramResult = {
  configured: boolean;
  account: SocialAccount | null;
  permissions: { manage: boolean };
  capabilities: string[];
};

type ComposerForm = {
  title: string;
  brandId: number | null;
  campaignId: number | null;
  pillarId: number | null;
  assigneeId: number | null;
  pic: string;
  priority: ContentItem["priority"];
  postType: "Single image" | "Reel";
  plannedPublishAt: string;
  caption: string;
  hashtags: string;
  cta: string;
  brief: string;
  notes: string;
};

const localDateTime = () => {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  const offset = next.getTimezoneOffset() * 60_000;
  return new Date(next.getTime() - offset).toISOString().slice(0, 16);
};

const bytes = (value: number) => value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
const instagramCompatible = (asset: MediaAsset | null) => !!asset && ["image/jpeg", "video/mp4", "video/quicktime"].includes(asset.mimeType);

export function ComposerView({ data, saved }: { data: WorkspaceData; saved: (contentId: number) => Promise<void> | void }) {
  const firstBrand = data.brands.find(brand => !brand.archived) ?? data.brands[0];
  const [form, setForm] = useState<ComposerForm>({
    title: "", brandId: firstBrand?.id ?? null, campaignId: null, pillarId: null,
    assigneeId: null, pic: "", priority: "Normal", postType: "Single image",
    plannedPublishAt: localDateTime(), caption: "", hashtags: "", cta: "", brief: "", notes: "",
  });
  const [instagram, setInstagram] = useState<InstagramResult | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const allowed = canCreate(data.actor.role);
  const selectedAsset = assets.find(asset => asset.id === selectedAssetId) ?? null;
  const campaigns = data.campaigns.filter(campaign => campaign.brandId === form.brandId && !campaign.archived);
  const pillars = data.pillars.filter(pillar => pillar.brandId === form.brandId && pillar.active);
  const compatibleMedia = instagramCompatible(selectedAsset);

  const load = async () => {
    setLoading(true);
    try {
      const [connection, library] = await Promise.all([
        api<InstagramResult>("integrations/instagram"),
        api<{ assets: MediaAsset[] }>("media"),
      ]);
      setInstagram(connection);
      setAssets(library.assets.filter(asset => asset.kind === "image" || asset.kind === "video"));
    } catch (issue) { setError((issue as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const checks = useMemo(() => [
    { label: "Content title and Brand", ready: !!form.title.trim() && !!form.brandId },
    { label: "Instagram account", ready: !!instagram?.account },
    { label: "Instagram-compatible media", ready: compatibleMedia },
    { label: "Platform caption", ready: !!form.caption.trim() },
    { label: "Planned publish time", ready: !!form.plannedPublishAt },
  ], [compatibleMedia, form, instagram]);
  const reviewReady = checks.every(check => check.ready);
  const draftReady = !!form.title.trim() && !!form.brandId && !!form.plannedPublishAt;

  function update<K extends keyof ComposerForm>(key: K, value: ComposerForm[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function selectAsset(id: number) {
    const asset = assets.find(item => item.id === id);
    setSelectedAssetId(id);
    if (asset?.kind === "video") update("postType", "Reel");
    if (asset?.kind === "image") update("postType", "Single image");
  }

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true); setError("");
    try {
      const asset = await uploadFile(file);
      setAssets(current => [asset, ...current.filter(item => item.id !== asset.id)]);
      setSelectedAssetId(asset.id);
      update("postType", asset.kind === "video" ? "Reel" : "Single image");
      toast.success("Media uploaded to the library and selected");
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); if (uploadInput.current) uploadInput.current.value = ""; }
  }

  async function save(mode: "draft" | "review") {
    if (!draftReady || mode === "review" && !reviewReady) return;
    setBusy(true); setError("");
    let createdId: number | null = null;
    try {
      const member = data.members.find(item => item.id === form.assigneeId);
      const created = await api<{ item: ContentItem }>("content", "POST", {
        title: form.title, brandId: form.brandId, campaignId: form.campaignId, pillarId: form.pillarId,
        objective: "", brief: form.brief, targetAudience: "", keyMessage: "", contentDirection: "", references: "",
        format: form.postType === "Reel" ? "Reel" : "Post", priority: form.priority,
        assigneeId: form.assigneeId, pic: member?.name ?? form.pic, deadline: "",
        publishDate: form.plannedPublishAt.slice(0, 10), platform: "Instagram", status: "Idea",
        caption: form.caption, copyHook: "", copyCta: form.cta, copyNotes: "", notes: form.notes,
      });
      createdId = created.item.id;
      const result = await api<{ variant: PlatformVariant }>(`content/${created.item.id}/variants`, "POST", {
        platform: "Instagram", title: form.title, caption: form.caption, description: "",
        hashtags: form.hashtags, cta: form.cta, notes: form.notes,
        plannedPublishAt: form.plannedPublishAt, status: "Idea",
      });
      if (selectedAsset) await api(`variants/${result.variant.id}/assets`, "POST", { mediaAssetId: selectedAsset.id, usage: "Main Asset" });
      if (mode === "review") await api(`content/${created.item.id}/approval/submit`, "POST", { version: created.item.version, note: "Submitted from Unified Composer." });
      toast.success(mode === "review" ? "Post created and sent for approval" : "Post draft saved");
      await saved(created.item.id);
    } catch (issue) {
      const message = (issue as Error).message;
      setError(createdId ? `${message} The master content was saved; open it from All Content to finish the setup.` : message);
    } finally { setBusy(false); }
  }

  if (!allowed) return <EmptyState title="Composer access is restricted" description="Ask an Owner, Admin, Content Strategist, or Creative member to create the post."/>;
  if (loading) return <div className="media-loading">Loading Composer…</div>;

  return <div className="composer-layout">
    <main className="composer-main">
      <section className="panel composer-section">
        <div className="composer-section-heading"><span>1</span><div><h2>Plan the content</h2><p>This creates the master record used by All Content, Calendar, approvals, and publishing.</p></div></div>
        <div className="form-grid">
          <Field label="Content title" id="composer-title" wide><Input id="composer-title" required maxLength={200} value={form.title} onChange={event => update("title", event.target.value)} placeholder="Give the post a clear internal title"/></Field>
          <Field label="Brand" id="composer-brand"><Choice id="composer-brand" label="Brand" value={String(form.brandId ?? "")} options={data.brands.filter(brand => !brand.archived).map(brand => ({ value: String(brand.id), label: brand.name }))} onChange={value => setForm(current => ({ ...current, brandId: Number(value), campaignId: null, pillarId: null }))}/></Field>
          <Field label="Campaign" id="composer-campaign"><Choice id="composer-campaign" label="Campaign" value={form.campaignId == null ? "_none" : String(form.campaignId)} options={[{ value: "_none", label: "No Campaign" }, ...campaigns.map(campaign => ({ value: String(campaign.id), label: campaign.name }))]} onChange={value => update("campaignId", value === "_none" ? null : Number(value))}/></Field>
          <Field label="Content Pillar" id="composer-pillar"><Choice id="composer-pillar" label="Content Pillar" value={form.pillarId == null ? "_none" : String(form.pillarId)} options={[{ value: "_none", label: "No Pillar" }, ...pillars.map(pillar => ({ value: String(pillar.id), label: pillar.name }))]} onChange={value => update("pillarId", value === "_none" ? null : Number(value))}/></Field>
          <Field label="PIC / owner" id="composer-owner"><Choice id="composer-owner" label="PIC / owner" value={form.assigneeId == null ? "_none" : String(form.assigneeId)} options={[{ value: "_none", label: "Named PIC" }, ...data.members.filter(member => member.status !== "Inactive").map(member => ({ value: String(member.id), label: member.name }))]} onChange={value => update("assigneeId", value === "_none" ? null : Number(value))}/></Field>
          {form.assigneeId == null && <Field label="PIC name" id="composer-pic"><Input id="composer-pic" maxLength={120} value={form.pic} onChange={event => update("pic", event.target.value)} placeholder="Person responsible"/></Field>}
          <Field label="Priority" id="composer-priority"><Choice id="composer-priority" label="Priority" value={form.priority} options={options(priorities)} onChange={value => update("priority", value as ContentItem["priority"])}/></Field>
          <Field label="Planned publish date & time" id="composer-date"><Input id="composer-date" type="datetime-local" required value={form.plannedPublishAt} onChange={event => update("plannedPublishAt", event.target.value)}/></Field>
          <Field label="Brief" id="composer-brief" wide><Textarea id="composer-brief" rows={3} maxLength={10000} value={form.brief} onChange={event => update("brief", event.target.value)} placeholder="What should this post achieve?"/></Field>
        </div>
      </section>

      <section className="panel composer-section">
        <div className="composer-section-heading"><span>2</span><div><h2>Choose destination</h2><p>The platform version stays linked to the same master content.</p></div></div>
        <div className="destination-grid">
          <div className="destination-card selected"><Camera/><div><strong>Instagram</strong><span>{instagram?.account ? `@${instagram.account.username}` : "No account connected"}</span><small>{instagram?.account ? `${instagram.account.accountType} · connected securely` : "Connect an account from Publishing before submitting."}</small></div><Check/></div>
          <Field label="Post type" id="composer-type"><Choice id="composer-type" label="Post type" value={form.postType} options={options(["Single image", "Reel"])} disabled={!!selectedAsset} onChange={value => update("postType", value as ComposerForm["postType"])}/></Field>
        </div>
      </section>

      <section className="panel composer-section">
        <div className="composer-section-heading"><span>3</span><div><h2>Add media</h2><p>Choose a reusable Media Library file or upload a new one.</p></div></div>
        <div className="composer-media-toolbar">
          <Choice label="Media Library file" value={selectedAssetId == null ? "_none" : String(selectedAssetId)} options={[{ value: "_none", label: "Choose a Media Library file" }, ...assets.map(asset => ({ value: String(asset.id), label: `${asset.fileName} · ${asset.kind}${instagramCompatible(asset) ? "" : " · unsupported for publishing"}` }))]} onChange={value => value === "_none" ? setSelectedAssetId(null) : selectAsset(Number(value))}/>
          {canUploadMedia(data.actor.role) && <><input ref={uploadInput} hidden type="file" accept="image/jpeg,video/mp4,video/quicktime" onChange={event => void upload(event.target.files)}/><Button type="button" variant="outline" disabled={busy} onClick={() => uploadInput.current?.click()}><Upload/>Upload new</Button></>}
        </div>
        {selectedAsset ? <div className="composer-selected-media">
          <div className="composer-media-preview">{selectedAsset.kind === "image" ? <img src={`/api/hub/media/${selectedAsset.id}/file`} alt=""/> : <video src={`/api/hub/media/${selectedAsset.id}/file`} controls preload="metadata"/>}</div>
          <div><span>{selectedAsset.kind === "video" ? <FileVideo/> : <ImageIcon/>}</span><strong>{selectedAsset.fileName}</strong><p>{selectedAsset.mimeType} · {bytes(selectedAsset.fileSize)}{selectedAsset.width && selectedAsset.height ? ` · ${selectedAsset.width}×${selectedAsset.height}` : ""}</p><small>{compatibleMedia ? "Ready for Instagram publishing. The original stays in Media Library if detached." : "This format can be saved as a draft, but Instagram publishing requires JPG, MP4, or MOV."}</small></div>
        </div> : <div className="composer-media-empty"><ImageIcon/><span>No media selected yet</span></div>}
      </section>

      <section className="panel composer-section">
        <div className="composer-section-heading"><span>4</span><div><h2>Write the Instagram version</h2><p>This copy is saved on the Instagram platform version and remains linked to the master content.</p></div></div>
        <div className="form-grid">
          <Field label="Caption" id="composer-caption" wide><Textarea id="composer-caption" rows={7} maxLength={15000} value={form.caption} onChange={event => update("caption", event.target.value)} placeholder="Write the caption that will be published…"/></Field>
          <Field label="Hashtags" id="composer-hashtags" wide><Textarea id="composer-hashtags" rows={2} maxLength={4000} value={form.hashtags} onChange={event => update("hashtags", event.target.value)} placeholder="#creativehub #contentplanning"/></Field>
          <Field label="Call to action" id="composer-cta" wide><Input id="composer-cta" maxLength={2000} value={form.cta} onChange={event => update("cta", event.target.value)} placeholder="Save this post for later"/></Field>
          <Field label="Internal notes" id="composer-notes" wide><Textarea id="composer-notes" rows={2} maxLength={10000} value={form.notes} onChange={event => update("notes", event.target.value)}/></Field>
        </div>
      </section>
    </main>

    <aside className="composer-side">
      <section className="panel composer-preview">
        <div className="composer-preview-account"><span className="instagram-avatar">{instagram?.account?.profilePictureUrl ? <img src={instagram.account.profilePictureUrl} alt=""/> : <Camera/>}</span><div><strong>{instagram?.account?.username ? `@${instagram.account.username}` : "Instagram account"}</strong><small>{form.postType}</small></div></div>
        <div className="composer-preview-media">{selectedAsset?.kind === "image" ? <img src={`/api/hub/media/${selectedAsset.id}/file`} alt="Post preview"/> : selectedAsset?.kind === "video" ? <video src={`/api/hub/media/${selectedAsset.id}/file`} controls preload="metadata"/> : <ImageIcon/>}</div>
        <div className="composer-preview-copy"><strong>{instagram?.account?.username ? `@${instagram.account.username}` : "Caption preview"}</strong><p>{form.caption || "Your Instagram caption will appear here."}</p>{form.hashtags && <span>{form.hashtags}</span>}{form.cta && <p>{form.cta}</p>}</div>
      </section>
      <section className="panel composer-readiness">
        <h2>Publishing readiness</h2>
        <div>{checks.map(check => <span key={check.label} className={check.ready ? "ready" : "missing"}>{check.ready ? <Check/> : <CircleAlert/>}{check.label}</span>)}</div>
        <p>Scheduling becomes available after an approver approves this exact content version.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button variant="outline" disabled={busy || !draftReady} onClick={() => void save("draft")}>{busy && <LoaderCircle className="spin"/>}Save draft</Button>
        <Button disabled={busy || !reviewReady} onClick={() => void save("review")}>{busy && <LoaderCircle className="spin"/>}Save & submit for review</Button>
      </section>
    </aside>
  </div>;
}
