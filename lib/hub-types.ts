export const statuses = ["Idea", "Writing", "Design", "Review", "Revision", "Approved", "Scheduled"] as const;
export const roles = ["Owner", "Admin", "Content Strategist", "Creative", "Designer", "Social Media", "Approver", "Viewer"] as const;
export const priorities = ["Low", "Normal", "High", "Urgent"] as const;
export const platforms = ["Instagram", "TikTok", "YouTube", "LinkedIn", "Facebook", "X / Twitter"];
export type Role = typeof roles[number];
export type Status = typeof statuses[number];
export type Member = { id: number; userId: string | null; name: string; email: string; role: Role; status: string };
export type Actor = Member & { workspaceId: string };
export type Pillar = { id: number; name: string; description: string; objective: string; color: string; active: number; position: number; usage: number };
export type Collection = { id: number; kind: "brand" | "campaign"; name: string; description: string };
export type ContentItem = {
  id: number; title: string; publishDate: string; pillar: string; pillarId: number | null;
  campaign: string; brand: string; platform: string; pic: string; assigneeId: number | null;
  priority: typeof priorities[number]; status: Status; caption: string; notes: string; version: number; reviewDecision: string;
};
export type WorkspaceData = { actor: Actor; workspace: { id: string; name: string }; members: Member[]; pillars: Pillar[]; collections: Collection[]; items: ContentItem[] };
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
  const all = ["title", "publishDate", "pillarId", "campaign", "brand", "platform", "pic", "assigneeId", "priority", "caption", "notes"];
  if (strategists(actor.role)) return all;
  if (actor.role === "Creative" && (!item || (item.assigneeId === actor.id && !["Approved", "Scheduled"].includes(item.status)))) return all.filter(x => !["assigneeId", "pic"].includes(x));
  if (actor.role === "Designer" && item?.assigneeId === actor.id && ["Design", "Review"].includes(item.status)) return ["notes"];
  if (actor.role === "Social Media" && item) return ["caption", "platform", "publishDate"];
  return [];
}
