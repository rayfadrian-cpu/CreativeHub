"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Reply, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  type Actor, type ApprovalRecord, type Comment, type ContentItem, type StatusHistory,
} from "@/lib/hub-types";
import { api } from "./creative-hub";
import { Choice, EmptyState, StatusBadge } from "./hub-views";

type CollaborationPermissions = {
  comment: boolean; submitReview: boolean; decideApproval: boolean; resolveAllComments: boolean;
};

const moment = (value: string) => value ? new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")).toLocaleString("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
}) : "—";

export function DiscussionPanel({ item, actor, comments, permissions, reload }: {
  item: ContentItem; actor: Actor; comments: Comment[]; permissions: CollaborationPermissions; reload: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);
  const roots = comments.filter(comment => !comment.parentId);
  const post = async () => {
    if (!message.trim()) return;
    setBusy(true);
    try {
      await api(`content/${item.id}/comments`, "POST", { body: message, ...(replyTo ? { parentId: replyTo.id } : {}) });
      setMessage(""); setReplyTo(null); await reload(); toast.success(replyTo ? "Reply added" : "Comment added");
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };
  const resolve = async (comment: Comment, resolved: boolean) => {
    try { await api(`comments/${comment.id}/resolve`, "PATCH", { resolved }); await reload(); toast.success(resolved ? "Discussion resolved" : "Discussion reopened"); }
    catch (error) { toast.error((error as Error).message); }
  };
  return <section className="workspace-section"><header><div><h2>Discussion</h2><p>Keep feedback, questions, and decisions next to the content.</p></div><span className="section-count">{roots.filter(x => !x.resolved).length} open</span></header>
    {permissions.comment && <div className="comment-composer">{replyTo && <div className="reply-context"><span>Replying to {replyTo.authorName}</span><Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>Cancel</Button></div>}<Textarea aria-label="Discussion comment" rows={3} maxLength={5000} placeholder={replyTo ? "Write a reply…" : "Add feedback or a question…"} value={message} onChange={event => setMessage(event.target.value)}/><div><span>{message.length}/5000</span><Button disabled={busy || !message.trim()} onClick={() => void post()}><Send/>{busy ? "Posting…" : replyTo ? "Post reply" : "Post comment"}</Button></div></div>}
    {!roots.length ? <EmptyState title="No discussion yet" description={permissions.comment ? "Start with a question or share feedback for the team." : "Comments from the team will appear here."}/> : <div className="discussion-list">{roots.map(comment => {
      const replies = comments.filter(reply => reply.parentId === comment.id);
      const canResolve = permissions.resolveAllComments || comment.authorMemberId === actor.id;
      return <article key={comment.id} className={`discussion-thread ${comment.resolved ? "is-resolved" : ""}`}><div className="comment-avatar">{comment.authorName.slice(0, 1).toUpperCase()}</div><div className="comment-body"><header><div><strong>{comment.authorName}</strong><span>{moment(comment.createdAt)}</span></div>{comment.resolved && <span className="resolved-chip"><CheckCircle2/>Resolved</span>}</header><p>{comment.body}</p><div className="comment-actions">{permissions.comment && <Button size="sm" variant="ghost" onClick={() => { setReplyTo(comment); setMessage(""); }}><Reply/>Reply</Button>}{canResolve && <Button size="sm" variant="ghost" onClick={() => void resolve(comment, !comment.resolved)}>{comment.resolved ? <><RotateCcw/>Reopen</> : <><CheckCircle2/>Resolve</>}</Button>}</div>{replies.length > 0 && <div className="reply-list">{replies.map(reply => <div key={reply.id} className="reply-item"><div className="comment-avatar">{reply.authorName.slice(0, 1).toUpperCase()}</div><div><header><strong>{reply.authorName}</strong><span>{moment(reply.createdAt)}</span></header><p>{reply.body}</p></div></div>)}</div>}</div></article>;
    })}</div>}
  </section>;
}

export function ApprovalPanel({ item, approvals, currentApproval, statusHistory, permissions, reload }: {
  item: ContentItem; approvals: ApprovalRecord[]; currentApproval: ApprovalRecord | null; statusHistory: StatusHistory[];
  permissions: CollaborationPermissions; reload: () => Promise<void>;
}) {
  const [submissionNote, setSubmissionNote] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api(`content/${item.id}/approval/submit`, "POST", { version: item.version, note: submissionNote }); setSubmissionNote(""); await reload(); toast.success("Submitted for review"); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };
  const decide = async (decision: "approved" | "revision" | "rejected") => {
    if (decision !== "approved" && !decisionNote.trim()) { toast.error("Add a note before requesting revision or rejecting."); return; }
    setBusy(true);
    try { await api(`content/${item.id}/approval/decide`, "POST", { version: item.version, decision, note: decisionNote }); setDecisionNote(""); await reload(); toast.success(decision === "approved" ? "Content approved" : decision === "revision" ? "Revision requested" : "Content rejected"); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="workspace-section"><header><div><h2>Approval</h2><p>Submit work for review and keep every decision with its note and timestamp.</p></div><StatusBadge status={item.status}/></header>
    {currentApproval ? <div className="current-review"><div><Clock3/><span><strong>Waiting for review</strong><small>Requested by {currentApproval.requestedByName} · {moment(currentApproval.requestedAt)}</small></span></div>{currentApproval.submissionNote && <p>{currentApproval.submissionNote}</p>}{permissions.decideApproval ? <div className="decision-box"><Textarea aria-label="Approval decision note" rows={3} maxLength={3000} placeholder="Decision note (required for revision or rejection)…" value={decisionNote} onChange={event => setDecisionNote(event.target.value)}/><div className="approval-actions"><Button disabled={busy} onClick={() => void decide("approved")}><CheckCircle2/>Approve</Button><Button variant="outline" disabled={busy || !decisionNote.trim()} onClick={() => void decide("revision")}>Request revision</Button><Button variant="destructive" disabled={busy || !decisionNote.trim()} onClick={() => void decide("rejected")}>Reject</Button></div></div> : <p className="empty-inline">An Owner, Admin, or Approver can make the decision.</p>}</div> : permissions.submitReview ? <div className="submit-review"><Textarea aria-label="Review submission note" rows={3} maxLength={3000} placeholder="Optional note for the approver…" value={submissionNote} onChange={event => setSubmissionNote(event.target.value)}/><Button disabled={busy} onClick={() => void submit()}><ShieldCheck/>{busy ? "Submitting…" : "Submit for review"}</Button></div> : <p className="empty-inline">No approval action is available for your role at this stage.</p>}
    <div className="approval-history"><h3>Decision history</h3>{approvals.length ? approvals.map(record => <article key={record.id}><span className={`approval-state state-${record.status}`}>{record.status}</span><div><strong>{record.status === "pending" ? `Requested by ${record.requestedByName}` : `${record.status === "approved" ? "Approved" : record.status === "revision" ? "Revision requested" : record.status === "rejected" ? "Rejected" : "Cancelled"} by ${record.decisionByName || "the workflow"}`}</strong><p>{record.decisionNote || record.submissionNote || "No note added."}</p><small>{moment(record.decidedAt || record.requestedAt)} · content v{record.contentVersion}</small></div></article>) : <p className="empty-inline">No review has been requested yet.</p>}</div>
    {statusHistory.length > 0 && <details className="status-history"><summary>Workflow history ({statusHistory.length})</summary><div>{statusHistory.map(entry => <p key={entry.id}><span>{entry.fromStatus} → {entry.toStatus}</span><small>{entry.actorName} · {moment(entry.createdAt)}{entry.note ? ` · ${entry.note}` : ""}</small></p>)}</div></details>}
  </section>;
}

export function ApprovalsView({ open }: { open: (contentId: number) => void }) {
  const [records, setRecords] = useState<ApprovalRecord[]>([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void api<{ approvals: ApprovalRecord[] }>(`approvals${filter === "all" ? "" : `?status=${filter}`}`)
      .then(value => { if (active) setRecords(value.approvals); })
      .catch(error => { if (active) toast.error((error as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter]);
  return <section className="panel approvals-page"><div className="panel-heading"><div><h2>Approval queue</h2><p>Review requests and past decisions across the workspace.</p></div><Choice label="Filter approvals" value={filter} options={[{ value: "pending", label: "Waiting for review" }, { value: "all", label: "All decisions" }, { value: "approved", label: "Approved" }, { value: "revision", label: "Revision" }, { value: "rejected", label: "Rejected" }]} onChange={value => { setLoading(true); setFilter(value); }}/></div>{loading ? <p className="media-loading">Loading approvals…</p> : records.length ? <div className="approval-queue">{records.map(record => <button key={record.id} onClick={() => open(record.contentId)}><span className={`approval-state state-${record.status}`}>{record.status}</span><div><strong>{record.contentTitle}</strong><p>{record.submissionNote || record.decisionNote || "No note added."}</p><small>{record.status === "pending" ? `Requested by ${record.requestedByName}` : `Decision by ${record.decisionByName || "the workflow"}`} · {moment(record.decidedAt || record.requestedAt)}</small></div><StatusBadge status={record.contentStatus || "Review"}/></button>)}</div> : <EmptyState title={filter === "pending" ? "The approval queue is clear" : "No approval records found"} description={filter === "pending" ? "New review requests will appear here." : "Try another approval filter."}/>}</section>;
}
