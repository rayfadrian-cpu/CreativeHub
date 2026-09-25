"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, GripVertical, Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { statuses, priorities, canMove, type ContentItem, type WorkspaceData } from "@/lib/hub-types";
import { Choice, PriorityBadge, StatusBadge } from "./hub-views";
import { dateLabel, initials } from "./creative-hub";

type Filters = { brand: string; campaign: string; pillar: string; platform: string; pic: string; priority: string };
const allFilters: Filters = { brand: "all", campaign: "all", pillar: "all", platform: "all", pic: "all", priority: "all" };
export function Kanban({ data, open, move, busyIds }: { data: WorkspaceData; open: (item: ContentItem) => void; move: (item: ContentItem, status: ContentItem["status"]) => Promise<void>; busyIds: number[] }) {
  const [query, setQuery] = useState(""); const [filters, setFilters] = useState(allFilters);
  const [drag, setDrag] = useState<{ item: ContentItem; x: number; y: number; over: string | null } | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ item: ContentItem; x: number; y: number; startX: number; startY: number; started: boolean; over: string | null; frame: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const unique = (key: keyof ContentItem) => [...new Set(data.items.map(x => String(x[key] ?? "")))].filter(Boolean).sort();
  const choices = (values: string[], label: string) => [{ value: "all", label: "All " + label }, ...values.map(x => ({ value: x, label: x }))];
  const filtered = data.items.filter(x => {
    return (query === "" || [x.title, x.caption, x.notes].join(" ").toLowerCase().includes(query.toLowerCase())) &&
      (filters.brand === "all" || x.brand === filters.brand) && (filters.campaign === "all" || x.campaign === filters.campaign) &&
      (filters.pillar === "all" || String(x.pillarId ?? "none") === filters.pillar) && (filters.platform === "all" || x.platform === filters.platform) &&
      (filters.pic === "all" || (x.pic || "Unassigned") === filters.pic) && (filters.priority === "all" || x.priority === filters.priority);
  });
  const filterOptions: [keyof Filters, string, { value: string; label: string }[]][] = [
    ["brand", "Brand", choices(unique("brand"), "brands")], ["campaign", "Campaign", choices(unique("campaign"), "campaigns")],
    ["pillar", "Content Pillar", [{ value: "all", label: "All pillars" }, { value: "none", label: "No pillar" }, ...data.pillars.map(x => ({ value: String(x.id), label: x.name + (x.active ? "" : " (inactive)") }))]],
    ["platform", "Platform", choices(unique("platform"), "platforms")], ["pic", "PIC", choices([...new Set(data.items.map(x => x.pic || "Unassigned"))], "people")],
    ["priority", "Priority", choices([...priorities], "priorities")],
  ];
  const hasFilters = query || Object.values(filters).some(x => x !== "all");
  function locate(x: number, y: number) {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-kanban-status]")?.dataset.kanbanStatus ?? null;
  }
  function paint() {
    const g = gesture.current; if (!g?.started) return;
    g.over = locate(g.x, g.y); setDrag({ item: g.item, x: g.x, y: g.y, over: g.over });
  }
  function autoScroll() {
    const g = gesture.current; if (!g) return;
    if (g.started && scroller.current) {
      const rect = scroller.current.getBoundingClientRect();
      if (g.x > rect.right - 65) scroller.current.scrollLeft += 14;
      else if (g.x < rect.left + 65) scroller.current.scrollLeft -= 14;
      const column = document.elementFromPoint(g.x, g.y)?.closest<HTMLElement>("[data-kanban-status]")?.querySelector<HTMLElement>(".kanban-card-list");
      if (column) { const box = column.getBoundingClientRect(); if (g.y > box.bottom - 55) column.scrollTop += 12; else if (g.y < box.top + 55) column.scrollTop -= 12; }
      paint();
    }
    g.frame = requestAnimationFrame(autoScroll);
  }
  function start(event: React.PointerEvent, item: ContentItem) {
    if (event.button !== 0 || busyIds.includes(item.id) || !statuses.some(s => s !== item.status && canMove(data.actor, item, s))) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { item, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, started: false, over: null, frame: 0 };
    gesture.current.frame = requestAnimationFrame(autoScroll);
  }
  function pointerMove(event: React.PointerEvent) {
    const g = gesture.current; if (!g) return;
    g.x = event.clientX; g.y = event.clientY;
    if (!g.started && Math.hypot(g.x - g.startX, g.y - g.startY) > 5) { g.started = true; setAnnouncement("Moving " + g.item.title); }
    paint();
  }
  function finish(cancel = false) {
    const g = gesture.current; if (!g) return;
    cancelAnimationFrame(g.frame); gesture.current = null; setDrag(null);
    if (!cancel && g.started && g.over && g.over !== g.item.status) {
      setAnnouncement("Saving " + g.item.title + " in " + g.over);
      void move(g.item, g.over as ContentItem["status"]);
    } else setAnnouncement("Move cancelled.");
  }
  // The handler intentionally reads the latest mutable drag gesture.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === "Escape") finish(true); }; window.addEventListener("keydown", escape); return () => { window.removeEventListener("keydown", escape); if (gesture.current) cancelAnimationFrame(gesture.current.frame); }; }, []);
  return <>
    <div className="kanban-controls"><div className="board-search"><Search size={16}/><Input aria-label="Search Kanban cards" placeholder="Find a content card…" value={query} onChange={e => setQuery(e.target.value)}/></div><span className="board-count">{filtered.length} of {data.items.length} items</span><div className="table-actions"><Button variant="outline" size="icon" aria-label="Scroll board left" onClick={() => scroller.current?.scrollBy({ left: -580, behavior: "smooth" })}><ChevronLeft size={16}/></Button><Button variant="outline" size="icon" aria-label="Scroll board right" onClick={() => scroller.current?.scrollBy({ left: 580, behavior: "smooth" })}><ChevronRight size={16}/></Button></div></div>
    <div className="kanban-filters">{filterOptions.map(([key, label, list]) => <Choice key={key} label={"Filter by " + label} value={filters[key]} options={list} onChange={value => { setFilters({ ...filters, [key]: value }); setLimits({}); }}/>)}
      {hasFilters && <Button variant="ghost" onClick={() => { setQuery(""); setFilters(allFilters); }}> <X size={14}/>Clear</Button>}
    </div>
    <p className="board-instruction">{data.actor.role === "Viewer" ? "Read-only access. Open any card to view its details." : "Drag using the grip, or use the status menu on a card. Available moves depend on your role."}</p>
    <div className="kanban-scroll" ref={scroller} aria-label="Content workflow board"><div className="kanban-board">
      {statuses.map(status => {
        const cards = filtered.filter(x => x.status === status); const over = drag?.over === status; const permitted = drag && canMove(data.actor, drag.item, status);
        return <section key={status} data-kanban-status={status} aria-label={status + " column"} className={"kanban-column" + (over ? permitted ? " drop-target" : " drop-forbidden" : "")}><header><StatusBadge status={status}/><span>{cards.length}</span></header><div className="kanban-card-list">
          {cards.slice(0, limits[status] ?? 40).map(item => { const movable = statuses.some(s => s !== item.status && canMove(data.actor, item, s)); const busy = busyIds.includes(item.id); return <article key={item.id} className={"kanban-card" + (drag?.item.id === item.id ? " dragging" : "") + (busy ? " card-saving" : "")} aria-label={item.title}>
            <div className="kanban-card-top"><span>{item.brand}</span>{movable && <button type="button" className="drag-handle" aria-label={"Drag " + item.title} title="Drag to another column. Use the status menu for keyboard navigation." disabled={busy} onPointerDown={e => start(e, item)} onPointerMove={pointerMove} onPointerUp={() => finish()} onPointerCancel={() => finish(true)}><GripVertical size={17}/></button>}</div>
            <button className="kanban-card-title" onClick={() => open(item)} disabled={busy}>{item.title}</button>
            <div className="card-tags"><span className="pillar-tag">{item.pillar || "No pillar"}</span><PriorityBadge priority={item.priority}/></div>
            <div className="card-platform">{item.platform}</div><div className="card-details"><span><CalendarDays size={14}/>{dateLabel(item.publishDate)}</span><span title={item.pic || "Unassigned"}><span className="mini-avatar">{item.pic ? initials(item.pic) : "—"}</span><span className="card-pic">{item.pic || "Unassigned"}</span></span></div>
            {item.reviewDecision === "rejected" && <span className="rejected-label">Rejected · needs revision</span>}
            {movable && <div className="card-status-control"><Choice label={"Move " + item.title} value={item.status} options={statuses.filter(s => s === item.status || canMove(data.actor, item, s)).map(s => ({ value: s, label: s === item.status ? busy ? "Saving…" : "Move from " + s : "Move to " + s }))} disabled={busy} onChange={s => void move(item, s as ContentItem["status"])}/></div>}
          </article>; })}
          {!cards.length && <div className="empty-column">{hasFilters ? "No matching content" : "No content yet"}</div>}
          {cards.length > (limits[status] ?? 40) && <Button variant="outline" className="column-more" onClick={() => setLimits({ ...limits, [status]: (limits[status] ?? 40) + 40 })}>Show 40 more</Button>}
        </div></section>;
      })}
    </div></div>
    <span className="sr-only" aria-live="polite">{announcement}</span>
    {drag && createPortal(<div className="drag-overlay" style={{ transform: "translate3d(" + (drag.x + 12) + "px," + (drag.y + 10) + "px,0)" }}><strong>{drag.item.title}</strong><span>{drag.over ? "Move to " + drag.over : "Choose a column"}</span></div>, document.body)}
  </>;
}
