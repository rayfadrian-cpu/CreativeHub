export const statuses = ["Idea", "Writing", "Design", "Review", "Revision", "Approved", "Scheduled"] as const;
export const roles = ["Owner", "Admin", "Content Strategist", "Creative", "Designer", "Social Media", "Approver", "Viewer"] as const;
export const priorities = ["Low", "Normal", "High", "Urgent"] as const;
export const platforms = ["Instagram", "TikTok", "YouTube", "LinkedIn", "Facebook", "X / Twitter"] as const;
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
  format: typeof contentFormats[number]; priority: typeof priorities[number]; pic: string; assigneeId: number | null;
  creatorMemberId: number | null; creatorName: string; deadline: string; publishDate: string; platform: string;
  status: Status; caption: string; notes: string; version: number; reviewDecision: string;
  createdAt: string; updatedAt: string;
};
export type Activity = {
  id: number; actorMemberId: number | null; actorName: string; action: string; entityType: string;
  entityId: string; entityTitle: string; summary: string; createdAt: string;
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
export const canSee = (actor: Actor, item: ContentItem) => actor.role !== "Designer" || item.assigneeId === actor.id;

export function canMove(actor: Actor, item: ContentItem, to: Status) {
  if (!statuses.includes(to) || !canSee(actor, item)) return false;
  if (item.status === to) return true;
  if (managers(actor.role)) return true;
  if (actor.role === "Content Strategist") return !["Approved", "Scheduled"].includes(item.status) && !["Approved", "Scheduled"].includes(to);
  if (actor.role === "Creative") return item.assigneeId === actor.id && !["Approved", "Scheduled"].includes(item.status) && !["Approved", "Scheduled"].includes(to);
  if (actor.role === "Designer") return item.assigneeId === actor.id && ["Design", "Review"].includes(item.status) && ["Design", "Review"].includes(to);
  if (actor.role === "Approver") return item.status === "Review" && ["Approved", "Revision"].includes(to);
  if (actor.role === "Social Media") return item.status === "Approved" && to === "Scheduled";
  return false;
}

export function editableFields(actor: Actor, item: ContentItem | null): string[] {
  const all = ["title", "brandId", "campaignId", "pillarId", "objective", "brief", "targetAudience", "format", "priority", "assigneeId", "pic", "deadline", "publishDate", "platform", "caption", "notes"];
  if (strategists(actor.role)) return all;
  if (actor.role === "Creative" && (!item || (item.assigneeId === actor.id && !["Approved", "Scheduled"].includes(item.status)))) return all.filter(x => !["assigneeId", "pic"].includes(x));
  if (actor.role === "Designer" && item?.assigneeId === actor.id && ["Design", "Review"].includes(item.status)) return ["notes"];
  if (actor.role === "Social Media" && item) return ["caption", "platform", "publishDate"];
  return [];
}
