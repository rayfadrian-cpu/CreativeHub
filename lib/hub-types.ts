export const statuses = ["Idea", "Writing", "Design", "Review", "Revision", "Approved", "Scheduled"] as const;
export const roles = ["Owner", "Admin", "Content Strategist", "Creative", "Designer", "Social Media", "Approver", "Viewer"] as const;
export const priorities = ["Low", "Normal", "High", "Urgent"] as const;
export const platforms = ["Instagram", "TikTok", "YouTube", "LinkedIn", "Facebook", "X / Twitter"] as const;
export const variantPlatforms = ["Instagram", "TikTok", "Facebook", "LinkedIn", "YouTube"] as const;
export const assetUsages = ["Main Asset", "Cover", "Thumbnail", "Supporting Asset", "Reference"] as const;
export const campaignStatuses = ["Draft", "Active", "Paused", "Completed", "Archived"] as const;
export const contentFormats = ["Post", "Carousel", "Story", "Reel", "Video", "Article", "Other"] as const;

export type Role = typeof roles[number];
export type Status = typeof statuses[number];
export type CampaignStatus = typeof campaignStatuses[number];
export type Member = { id: number; userId: string | null; workspaceId?: string; name: string; email: string; role: Role; status: string };
export type Actor = Member & { workspaceId: string };
export type Workspace = { id: string; name: string; slug: string; timezone: string; createdAt: string; updatedAt: string };
export type Brand = {
  id: number; workspaceId: string; name: string; description: string; slug: string; logo: string;
  timezone: string; archived: number; createdAt: string; updatedAt: string; usage: number;
};
export type Pillar = {
  id: number; brandId: number | null; name: string; description: string; objective: string;
  color: string; active: number; position: number; createdAt: string; updatedAt: string; usage: number;
};
export type Campaign = {
  id: number; brandId: number; brandName: string; name: string; description: string; objective: string;
  targetAudience: string; startDate: string; endDate: string; ownerMemberId: number | null; ownerName: string;
  status: CampaignStatus; archived: number; createdAt: string; updatedAt: string; usage: number;
};
export type ContentItem = {
  id: number; title: string; workspaceId?: string;
  brandId: number | null; brand: string; campaignId: number | null; campaign: string;
  pillarId: number | null; pillar: string; objective: string; brief: string; targetAudience: string;
  keyMessage: string; contentDirection: string; references: string;
  format: typeof contentFormats[number]; priority: typeof priorities[number]; pic: string; assigneeId: number | null;
  creatorMemberId: number | null; creatorName: string; deadline: string; publishDate: string; platform: string;
  status: Status; caption: string; copyHook: string; copyCta: string; copyNotes: string; notes: string; version: number; reviewDecision: string;
  createdAt: string; updatedAt: string;
};
export type MediaAsset = {
  id: number; fileName: string; originalName: string; kind: "image" | "video" | "document";
  mimeType: string; fileSize: number; storageKey: string; width: number | null; height: number | null;
  durationSeconds: number | null; uploaderMemberId: number | null; uploaderName: string; createdAt: string; updatedAt: string;
  attachmentCount: number;
};
export type ContentAsset = MediaAsset & { linkId: number; usage: typeof assetUsages[number]; position: number };
export type PlatformVariant = {
  id: number; contentId: number; platform: typeof variantPlatforms[number]; title: string; caption: string;
  description: string; hashtags: string; cta: string; notes: string; plannedPublishAt: string;
  status: Status; version: number; createdAt: string; updatedAt: string; assets: ContentAsset[];
};
export type Activity = {
  id: number; actorMemberId: number | null; actorName: string; action: string; entityType: string;
  entityId: string; entityTitle: string; summary: string; createdAt: string;
};
export type Comment = {
  id: number; contentId: number; authorMemberId: number | null; authorName: string; parentId: number | null;
  body: string; resolved: number; resolvedByMemberId: number | null; resolvedByName: string;
  resolvedAt: string; createdAt: string; updatedAt: string;
};
export type ApprovalRecord = {
  id: number; contentId: number; contentTitle?: string; contentStatus?: Status;
  requestedByMemberId: number | null; requestedByName: string; requestedAt: string;
  status: "pending" | "approved" | "revision" | "rejected" | "cancelled"; contentVersion: number;
  submissionNote: string; decisionByMemberId: number | null; decisionByName: string;
  decisionNote: string; decidedAt: string;
};
export type StatusHistory = {
  id: number; contentId: number; fromStatus: Status; toStatus: Status;
  actorMemberId: number | null; actorName: string; note: string; createdAt: string;
};
export type WorkspaceData = {
  actor: Actor; workspace: Workspace; members: Member[]; brands: Brand[]; pillars: Pillar[];
  campaigns: Campaign[]; items: ContentItem[];
};

export const permissionMessage = "You do not have permission to perform this action.";
export const managers = (role: Role) => role === "Owner" || role === "Admin";
export const strategists = (role: Role) => managers(role) || role === "Content Strategist";
export const canCreate = (role: Role) => strategists(role) || role === "Creative";
export const canDelete = (role: Role) => managers(role);
export const canUploadMedia = (role: Role) => !["Approver", "Viewer"].includes(role);
export const canManageLibraryAsset = (actor: Actor, asset?: Pick<MediaAsset, "uploaderMemberId">) => managers(actor.role) || actor.role === "Designer" && (!asset || asset.uploaderMemberId === actor.id);
export const canSee = (actor: Actor, item: ContentItem) => actor.role !== "Designer" || item.assigneeId === actor.id;
export const canComment = (actor: Actor, item: ContentItem) => canSee(actor, item) && actor.role !== "Viewer";
export const canResolveComment = (actor: Actor, item: ContentItem, authorMemberId?: number | null) => canSee(actor, item) &&
  (managers(actor.role) || actor.role === "Content Strategist" || actor.role === "Approver" || authorMemberId === actor.id);
export const canDecideApproval = (actor: Actor, item: ContentItem) => canSee(actor, item) && ["Owner", "Admin", "Approver"].includes(actor.role);
export const canSubmitReview = (actor: Actor, item: ContentItem) => {
  if (!canSee(actor, item) || ["Review", "Approved", "Scheduled"].includes(item.status)) return false;
  if (strategists(actor.role)) return true;
  if (actor.role === "Creative") return item.assigneeId === actor.id;
  if (actor.role === "Designer") return item.assigneeId === actor.id && item.status === "Design";
  return false;
};

export function canMove(actor: Actor, item: ContentItem, to: Status) {
  if (!statuses.includes(to) || !canSee(actor, item)) return false;
  if (item.status === to) return true;
  if (to === "Approved" || item.status === "Review" && to === "Revision") return false;
  if (to === "Scheduled") return item.status === "Approved" && (managers(actor.role) || actor.role === "Social Media");
  if (managers(actor.role)) return true;
  if (actor.role === "Content Strategist") return !["Approved", "Scheduled"].includes(item.status) && !["Approved", "Scheduled"].includes(to);
  if (actor.role === "Creative") return item.assigneeId === actor.id && !["Approved", "Scheduled"].includes(item.status) && !["Approved", "Scheduled"].includes(to);
  if (actor.role === "Designer") return item.assigneeId === actor.id && ["Design", "Review"].includes(item.status) && ["Design", "Review"].includes(to);
  return false;
}

export function editableFields(actor: Actor, item: ContentItem | null): string[] {
  const all = ["title", "brandId", "campaignId", "pillarId", "objective", "brief", "targetAudience", "keyMessage", "contentDirection", "references", "format", "priority", "assigneeId", "pic", "deadline", "publishDate", "platform", "caption", "copyHook", "copyCta", "copyNotes", "notes"];
  if (item && ["Review", "Approved", "Scheduled"].includes(item.status)) return [];
  if (strategists(actor.role)) return all;
  if (actor.role === "Creative" && (!item || (item.assigneeId === actor.id && !["Approved", "Scheduled"].includes(item.status)))) return all.filter(x => !["assigneeId", "pic"].includes(x));
  if (actor.role === "Designer" && item?.assigneeId === actor.id && ["Design", "Review"].includes(item.status)) return ["notes"];
  if (actor.role === "Social Media" && item) return ["caption", "platform", "publishDate"];
  return [];
}

export const canManageContentAssets = (actor: Actor, item: ContentItem) => !["Review", "Approved", "Scheduled"].includes(item.status) &&
  (managers(actor.role) || actor.role === "Content Strategist" || ["Creative", "Designer"].includes(actor.role) && item.assigneeId === actor.id);
export const canManageVariants = (actor: Actor, item: ContentItem) => !["Review", "Approved", "Scheduled"].includes(item.status) &&
  (managers(actor.role) || actor.role === "Content Strategist" || actor.role === "Social Media" || actor.role === "Creative" && item.assigneeId === actor.id);
