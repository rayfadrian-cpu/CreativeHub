"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Ban, Camera, CheckCircle2, Clock3, ExternalLink, Link2, Link2Off, ListRestart, Play, Plus, RefreshCw, Send, ShieldCheck, TimerReset } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canManagePublishing, type Actor, type ContentItem, type PlatformVariant, type PublishJob, type PublishJobStatus, type PublishLog, type SocialAccount } from "@/lib/hub-types";
import { api } from "./creative-hub";
import { Confirm, EmptyState } from "./hub-views";

type QueueResult = { jobs: PublishJob[]; counts: Record<string, number>; permissions: { manage: boolean; run: boolean } };
type InstagramResult = { configured: boolean; account: SocialAccount | null; permissions: { manage: boolean }; redirectUri: string; capabilities: string[] };
const waiting = new Set<PublishJobStatus>(["scheduled", "queued", "retrying"]);
const statusLabel: Record<PublishJobStatus, string> = {
  scheduled: "Scheduled", queued: "Queued", processing: "Processing", retrying: "Retrying",
  blocked: "Needs connection", failed: "Failed", published: "Published", cancelled: "Cancelled",
};
const dateTime = (value: string) => value ? new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function PublishStatusBadge({ status }: { status: PublishJobStatus }) {
  return <span className={`publish-status publish-${status}`}>{statusLabel[status]}</span>;
}

export function PublishingView({ open, compose }: { open: (contentId: number) => void; compose: () => void }) {
  const [queue, setQueue] = useState<QueueResult | null>(null);
  const [logs, setLogs] = useState<PublishLog[]>([]);
  const [instagram, setInstagram] = useState<InstagramResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | PublishJobStatus>("all");
  const [cancel, setCancel] = useState<PublishJob | null>(null);
  const [reschedule, setReschedule] = useState<PublishJob | null>(null);
  const [disconnectInstagram, setDisconnectInstagram] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const [jobs, history, connection] = await Promise.all([
        api<QueueResult>("publishing/jobs"), api<{ logs: PublishLog[] }>("publishing/logs?limit=150"), api<InstagramResult>("integrations/instagram"),
      ]);
      setQueue(jobs); setLogs(history.logs); setInstagram(connection);
    } catch (error) { toast.error((error as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    Promise.all([api<QueueResult>("publishing/jobs"), api<{ logs: PublishLog[] }>("publishing/logs?limit=150"), api<InstagramResult>("integrations/instagram")])
      .then(([jobs, history, connection]) => { if (active) { setQueue(jobs); setLogs(history.logs); setInstagram(connection); } })
      .catch(error => { if (active) toast.error((error as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const jobs = useMemo(() => queue?.jobs.filter(job => filter === "all" || job.status === filter) ?? [], [queue, filter]);
  const count = (states: PublishJobStatus[]) => states.reduce((total, state) => total + Number(queue?.counts[state] ?? 0), 0);
  const run = async () => {
    setBusy(true);
    try {
      const result = await api<{ processed: number }>("publishing/run", "POST", {});
      await load();
      toast.success(result.processed ? `${result.processed} due job${result.processed === 1 ? "" : "s"} processed` : "No publishing jobs are due");
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };
  const act = async (job: PublishJob, action: "retry" | "cancel") => {
    setBusy(true);
    try { await api(`publishing/jobs/${job.id}/${action}`, "POST", {}); await load(); toast.success(action === "retry" ? "Job returned to the queue" : "Publishing job cancelled"); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); setCancel(null); }
  };
  const connect = async () => {
    setBusy(true);
    // A full document request lets the server create OAuth state and redirect to Instagram.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/api/hub/integrations/instagram/connect";
  };
  const disconnect = async () => {
    setBusy(true);
    try { await api("integrations/instagram/disconnect", "POST", {}); await load(); toast.success("Instagram account disconnected and its stored token removed"); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); setDisconnectInstagram(false); }
  };

  return <div className="publishing-view">
    <InstagramConnection integration={instagram} busy={busy} connect={connect} disconnect={() => setDisconnectInstagram(true)}/>
    <div className="publishing-notice"><div><Send/><span><strong>Instagram publishing is available</strong><small>Create posts in Composer. Approved single images, 2–10 image carousels, and short videos can be scheduled through the connected professional account.</small></span></div><div className="publishing-notice-actions"><Button variant="outline" onClick={compose}><Plus/>Create post</Button>{queue?.permissions.run && <Button disabled={busy} onClick={() => void run()}><Play/>{busy ? "Processing…" : "Process due jobs"}</Button>}</div></div>
    <div className="publishing-metrics">
      <button onClick={() => setFilter("scheduled")}><Clock3/><span>Upcoming</span><strong>{count(["scheduled", "queued"])}</strong></button>
      <button onClick={() => setFilter("retrying")}><RefreshCw/><span>Retrying</span><strong>{count(["retrying", "processing"])}</strong></button>
      <button onClick={() => setFilter("blocked")}><AlertTriangle/><span>Needs attention</span><strong>{count(["blocked", "failed"])}</strong></button>
      <button onClick={() => setFilter("published")}><CheckCircle2/><span>Published</span><strong>{count(["published"])}</strong></button>
    </div>
    <Tabs defaultValue="queue">
      <TabsList variant="line"><TabsTrigger value="queue">Publishing queue</TabsTrigger><TabsTrigger value="logs">Attempt logs</TabsTrigger></TabsList>
      <TabsContent value="queue">
        <div className="publishing-toolbar"><div className="publish-filters">{(["all", "scheduled", "retrying", "blocked", "failed", "published", "cancelled"] as const).map(state => <Button key={state} size="sm" variant={filter === state ? "default" : "outline"} onClick={() => setFilter(state)}>{state === "all" ? "All jobs" : statusLabel[state]}</Button>)}</div><Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw/>Refresh</Button></div>
        {loading ? <div className="media-loading">Loading publishing queue…</div> : !jobs.length ? <EmptyState title="No publishing jobs found" description={filter === "all" ? "Schedule an approved platform version to add the first job." : "No jobs match this status."}/> : <div className="publish-table-wrap"><table className="publish-table"><thead><tr><th>Content</th><th>Platform / account</th><th>Schedule</th><th>Status</th><th>Attempts</th><th>Last result</th><th aria-label="Actions"/></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td><button className="publish-content-link" onClick={() => open(job.contentId)}><strong>{job.contentTitle}</strong><span>{job.variantTitle}</span></button></td><td><strong>{job.platform}</strong><span>{job.accountLabel}</span></td><td>{dateTime(job.scheduledAt)}{job.status === "retrying" && <span>Next: {dateTime(job.nextAttemptAt)}</span>}</td><td><PublishStatusBadge status={job.status}/></td><td>{job.attemptCount} / {job.maxAttempts}</td><td><span className={job.lastErrorMessage ? "publish-error" : ""}>{job.lastErrorMessage || (job.status === "published" ? job.externalPostId || "Published successfully" : "—")}</span></td><td><div className="publish-actions">{["failed", "blocked"].includes(job.status) && queue?.permissions.manage && <Button size="icon" variant="ghost" aria-label={`Retry ${job.contentTitle}`} title="Retry" disabled={busy} onClick={() => void act(job, "retry")}><ListRestart/></Button>}{waiting.has(job.status) && queue?.permissions.manage && <><Button size="icon" variant="ghost" aria-label={`Reschedule ${job.contentTitle}`} title="Reschedule" onClick={() => setReschedule(job)}><TimerReset/></Button><Button size="icon" variant="ghost" aria-label={`Cancel ${job.contentTitle}`} title="Cancel" onClick={() => setCancel(job)}><Ban/></Button></>}{job.externalPostUrl && <Button size="icon" variant="ghost" asChild><a href={job.externalPostUrl} target="_blank" rel="noreferrer" aria-label="Open published post"><ExternalLink/></a></Button>}</div></td></tr>)}</tbody></table></div>}
      </TabsContent>
      <TabsContent value="logs">{!logs.length ? <EmptyState title="No publishing attempts yet" description="Logs appear when a due job is processed."/> : <div className="publish-table-wrap"><table className="publish-table publish-log-table"><thead><tr><th>Request / response</th><th>Content</th><th>Platform / account</th><th>Attempt</th><th>Result</th><th>External post</th></tr></thead><tbody>{logs.map(log => <tr key={log.id}><td>{dateTime(log.requestAt)}<span>{dateTime(log.responseAt)}</span></td><td><button className="publish-content-link" onClick={() => open(log.contentId)}>{log.contentTitle}</button></td><td><strong>{log.platform}</strong><span>{log.accountLabel}</span></td><td>#{log.attemptNumber}</td><td><strong>{log.status}</strong><span className={log.errorMessage ? "publish-error" : ""}>{log.errorCode}{log.errorCode && log.errorMessage ? " · " : ""}{log.errorMessage}</span></td><td>{log.externalPostId || "—"}</td></tr>)}</tbody></table></div>}
      </TabsContent>
    </Tabs>
    <Confirm open={!!cancel} close={() => setCancel(null)} title="Cancel this publishing job?" description="The content and platform version stay intact. The cancelled job remains in the audit history." label="Cancel job" action={() => act(cancel!, "cancel")}/>
    <Confirm open={disconnectInstagram} close={() => setDisconnectInstagram(false)} title="Disconnect Instagram?" description="Creative Hub will remove the stored access token. Existing content and publishing history will stay intact." label="Disconnect" action={disconnect}/>
    {reschedule && <RescheduleDialog job={reschedule} close={() => setReschedule(null)} saved={async () => { setReschedule(null); await load(); }}/>} 
  </div>;
}

function InstagramConnection({ integration, busy, connect, disconnect }: { integration: InstagramResult | null; busy: boolean; connect: () => Promise<void>; disconnect: () => void }) {
  if (!integration) return <div className="instagram-connection instagram-loading">Loading Instagram connection…</div>;
  const account = integration.account;
  return <section className={`instagram-connection ${account ? "is-connected" : ""}`}>
    <div className="instagram-mark"><Camera/></div>
    <div className="instagram-copy">
      <div className="instagram-heading"><strong>Instagram</strong>{account && <span><ShieldCheck/>Connected securely</span>}</div>
      {account ? <><p><b>{account.username ? `@${account.username}` : account.displayName || "Professional account"}</b> · {account.accountType || "Professional"}</p><small>Ready for single-image posts and Reels. Access token expires {dateTime(account.tokenExpiresAt)} and is refreshed automatically.</small></>
        : integration.configured ? <><p>Connect one Instagram Business or Creator account.</p><small>Creative Hub never exposes the access token in your browser.</small></>
        : <><p>Meta App credentials still need to be added by the workspace owner.</p><small>After setup, this button will open Instagram’s official authorization screen.</small></>}
    </div>
    {integration.permissions.manage && (account
      ? <Button variant="outline" disabled={busy} onClick={disconnect}><Link2Off/>Disconnect</Button>
      : <Button disabled={busy || !integration.configured} onClick={() => void connect()}><Link2/>{integration.configured ? "Connect Instagram" : "Setup required"}</Button>)}
  </section>;
}

function localValue(value: string) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60_000);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function RescheduleDialog({ job, close, saved }: { job: PublishJob; close: () => void; saved: () => Promise<void> }) {
  const [value, setValue] = useState(localValue(job.scheduledAt)); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Dialog open onOpenChange={next => !next && !busy && close()}><DialogContent><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { await api(`publishing/jobs/${job.id}/reschedule`, "PATCH", { scheduledAt: new Date(value).toISOString() }); await saved(); toast.success("Publishing job rescheduled"); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }}><DialogHeader><DialogTitle>Reschedule {job.platform}</DialogTitle><DialogDescription>Choose when this approved platform version should enter the publishing worker.</DialogDescription></DialogHeader><div className="dialog-field"><Label htmlFor="reschedule-at">Publish date & time</Label><Input id="reschedule-at" type="datetime-local" required value={value} onChange={event => setValue(event.target.value)}/>{error && <p className="form-error">{error}</p>}</div><DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : "Save schedule"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

export function ScheduleVariantButton({ actor, item, variant, scheduled }: { actor: Actor; item: ContentItem; variant: PlatformVariant; scheduled: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!canManagePublishing(actor.role) || !["Approved", "Scheduled"].includes(item.status)) return null;
  if (variant.platform !== "Instagram") return <Button size="sm" variant="outline" disabled title={`${variant.platform} publishing is not connected yet`}><Clock3/>Not connected</Button>;
  return <><Button size="sm" onClick={() => setOpen(true)}><Clock3/>Schedule</Button>{open && <ScheduleDialog item={item} variant={variant} close={() => setOpen(false)} saved={scheduled}/>}</>;
}

function ScheduleDialog({ item, variant, close, saved }: { item: ContentItem; variant: PlatformVariant; close: () => void; saved: () => Promise<void> }) {
  const seed = variant.plannedPublishAt ? localValue(variant.plannedPublishAt) : localValue(`${item.publishDate}T09:00:00`);
  const [value, setValue] = useState(seed); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Dialog open onOpenChange={next => !next && !busy && close()}><DialogContent><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { await api("publishing/jobs", "POST", { variantId: variant.id, scheduledAt: new Date(value).toISOString() }); await saved(); close(); toast.success(`${variant.platform} added to the publishing queue`); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }}><DialogHeader><DialogTitle>Schedule {variant.platform}</DialogTitle><DialogDescription>This creates a publishing job for “{item.title}” using the connected Instagram professional account.</DialogDescription></DialogHeader><div className="dialog-field"><Label htmlFor={`schedule-${variant.id}`}>Publish date & time</Label><Input id={`schedule-${variant.id}`} type="datetime-local" required value={value} onChange={event => setValue(event.target.value)}/><p className="field-help">Format: {variant.publishFormat}</p>{error && <p className="form-error">{error}</p>}</div><DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button disabled={busy}>{busy ? "Scheduling…" : "Add to queue"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
