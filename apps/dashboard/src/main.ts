import type { CalendarNotification, DashboardData, PlanCategory, PlanItem } from "@homebot/shared";
import { dismissNotification, exitApp, togglePlanItem, updatePlanItem } from "./api";
import { gateway } from "./gateway/client";
import { startLiveDashboard } from "./live-dashboard";
import { ensureFullscreen } from "./fullscreen";
import { formatClock, formatDate, getGreeting } from "./utils/time";
import { isItemOverdue, sortPlanItems } from "./plan-utils";
import { createTouchCalendarPicker, createTouchClockPicker } from "./touch-pickers";
import "./styles/nexus.css";

interface CronPrompt {
  id?: string;
  jobId?: string;
  name?: string;
  status?: string;
  message?: string;
  dismissed?: boolean;
}

type PlanFilter = "all" | PlanCategory;

let dashboard: DashboardData | null = null;
let gatewayOnline = false;
let cronPrompts: CronPrompt[] = [];
let approval: import("@homebot/shared").ApprovalRequest | null = null;
let detailItem: PlanItem | null = null;
let activeNotification: CalendarNotification | null = null;
let planFilter: PlanFilter = "all";
let lastOverlayKey = "";

const app = document.getElementById("app")!;
const mainRoot = el("div", "dashboard-main");
const overlayRoot = el("div", "overlay-layer");
app.append(mainRoot, overlayRoot);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function todayYmd(): string {
  return dashboard?.todolist.plan.date ?? new Date().toISOString().slice(0, 10);
}

function filterItems(items: PlanItem[]): PlanItem[] {
  const sorted = sortPlanItems(items);
  if (planFilter === "all") return sorted;
  return sorted.filter((i) => (i.category ?? "personal") === planFilter);
}

function imageBase(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function thumbSrc(item: PlanItem): string | undefined {
  if (item.archivedImageUrl) return item.archivedImageUrl;
  if (item.thumbUrl) return item.thumbUrl;
  if (item.image) return `/api/media/thumb/${encodeURIComponent(imageBase(item.image))}?size=small`;
  return item.imageUrl;
}

function fullImageSrc(item: PlanItem): string | undefined {
  if (item.archivedImageUrl) return item.archivedImageUrl;
  if (item.imageUrl) return item.imageUrl;
  if (item.image) return `/api/media/image/${encodeURIComponent(item.image)}`;
  return undefined;
}

function itemHasImage(item: PlanItem): boolean {
  return Boolean(item.image || item.thumbUrl || item.imageUrl || item.archivedImageUrl);
}

function findPlanItem(data: DashboardData, index: number): PlanItem | undefined {
  return data.todolist.plan.items.find((i) => i.index === index);
}

function openDetail(item: PlanItem): void {
  detailItem = item;
  renderOverlay(true);
}

function bindTapOpen(target: HTMLElement, item: PlanItem): void {
  let startY = 0;
  let startX = 0;

  target.addEventListener(
    "touchstart",
    (e) => {
      startY = e.touches[0]!.clientY;
      startX = e.touches[0]!.clientX;
    },
    { passive: true },
  );

  target.addEventListener("touchend", (e) => {
    const dy = Math.abs(e.changedTouches[0]!.clientY - startY);
    const dx = Math.abs(e.changedTouches[0]!.clientX - startX);
    if (dy > 12 || dx > 12) return;
    openDetail(item);
  });

  target.addEventListener("click", (e) => {
    if (e.detail === 0) return;
    openDetail(item);
  });
}

function thumbForItem(item: PlanItem): HTMLElement {
  const wrap = el("div", "plan-thumb");
  const src = thumbSrc(item);
  if (src) {
    const img = document.createElement("img");
    img.className = "plan-thumb-img";
    img.src = src;
    img.alt = "";
    img.draggable = false;
    img.addEventListener("error", () => {
      const fallback = fullImageSrc(item);
      if (fallback && img.src !== fallback) {
        img.src = fallback;
        return;
      }
      img.replaceWith(el("div", "plan-thumb-fallback", "◇"));
    });
    wrap.appendChild(img);
  } else if (item.attachment) {
    wrap.appendChild(el("div", "plan-thumb-fallback", "📎"));
  }
  return wrap;
}

function renderPlanItems(items: PlanItem[], done: boolean): HTMLElement {
  const container = el("div");
  const filtered = filterItems(items);

  if (filtered.length === 0) {
    const msg =
      planFilter === "all"
        ? done
          ? "Nothing completed yet"
          : "No plan yet"
        : `No ${planFilter} items`;
    container.appendChild(el("div", "empty-state", msg));
    return container;
  }

  const ymd = todayYmd();

  for (const item of filtered) {
    const overdue = isItemOverdue(item, ymd);
    const row = el(
      "div",
      `plan-item${done ? " done-item" : ""}${overdue ? " overdue" : ""}${item.important ? " important" : ""}`,
    );

    const check = el("button", `plan-check${done ? " is-done" : ""}`, done ? "✓" : "");
    check.type = "button";
    check.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      check.classList.add("pulse");
      try {
        await togglePlanItem(item.index, !done);
      } catch (err) {
        console.error(err);
      }
    });

    const body = el("div", "plan-body");
    body.setAttribute("role", "button");
    body.tabIndex = 0;

    if (itemHasImage(item) || item.attachment) {
      body.appendChild(thumbForItem(item));
    }

    const textWrap = el("div", "plan-text");
    const meta = el("div", "plan-meta-row");

    if (item.time) meta.appendChild(el("span", `plan-time${overdue ? " overdue-text" : ""}`, item.time));
    if (item.dueDate) {
      const d = item.dueDate.slice(5).replace("-", "/");
      meta.appendChild(el("span", `plan-date${overdue ? " overdue-text" : ""}`, d));
    }
    if (item.important) meta.appendChild(el("span", "plan-badge important", "★"));
    if (item.category === "work") meta.appendChild(el("span", "plan-badge work", "WORK"));
    if (meta.childElementCount > 0) textWrap.appendChild(meta);

    textWrap.appendChild(el("div", `plan-title${overdue ? " overdue-text" : ""}`, item.title));
    if (item.description) textWrap.appendChild(el("div", "plan-desc", item.description));
    body.appendChild(textWrap);

    bindTapOpen(body, item);

    row.appendChild(check);
    row.appendChild(body);
    container.appendChild(row);
  }

  return container;
}

function appendDetailImage(body: HTMLElement, item: PlanItem): void {
  const src = fullImageSrc(item);
  if (!src) return;

  const img = document.createElement("img");
  img.className = "detail-image";
  img.src = src;
  img.alt = item.title;
  img.draggable = false;
  img.addEventListener("error", () => {
    img.style.display = "none";
  });
  body.appendChild(img);
}

function renderDetailOverlay(): HTMLElement | null {
  if (!detailItem) return null;

  const backdrop = el("div", "overlay-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      detailItem = null;
      renderOverlay(true);
    }
  });

  const card = el("div", "overlay-card detail-card");
  const header = el("div", "detail-header");
  header.appendChild(el("div", "overlay-title", "EDIT TASK"));
  const close = el("button", "detail-close", "✕");
  close.type = "button";
  close.addEventListener("click", () => {
    detailItem = null;
    renderOverlay(true);
  });
  header.appendChild(close);
  card.appendChild(header);

  const body = el("div", "detail-card-body scroll-themed");
  body.appendChild(el("div", "detail-title", detailItem.title));
  if (detailItem.description) body.appendChild(el("div", "detail-desc", detailItem.description));

  body.appendChild(el("div", "picker-section-label", "TIME"));
  const clock = createTouchClockPicker(detailItem.time);
  body.appendChild(clock.element);

  body.appendChild(el("div", "picker-section-label", "DATE"));
  const cal = createTouchCalendarPicker(detailItem.dueDate ?? null);
  body.appendChild(cal.element);

  const tagRow = el("div", "detail-tag-row");
  let category: PlanCategory = detailItem.category ?? "personal";
  let important = Boolean(detailItem.important);

  const personalBtn = el("button", "filter-chip", "PERSONAL");
  const workBtn = el("button", "filter-chip", "WORK");
  const importantBtn = el("button", "filter-chip", "★ IMPORTANT");
  personalBtn.type = "button";
  workBtn.type = "button";
  importantBtn.type = "button";

  const syncTags = () => {
    personalBtn.classList.toggle("active", category === "personal");
    workBtn.classList.toggle("active", category === "work");
    importantBtn.classList.toggle("active", important);
  };
  personalBtn.addEventListener("click", () => {
    category = "personal";
    syncTags();
  });
  workBtn.addEventListener("click", () => {
    category = "work";
    syncTags();
  });
  importantBtn.addEventListener("click", () => {
    important = !important;
    syncTags();
  });
  syncTags();
  tagRow.append(personalBtn, workBtn, importantBtn);
  body.appendChild(tagRow);

  appendDetailImage(body, detailItem);

  if (detailItem.attachmentUrl) {
    const link = el("a", "detail-attachment", `Attachment: ${detailItem.attachment}`);
    link.href = detailItem.attachmentUrl;
    link.target = "_blank";
    body.appendChild(link);
  }

  const actions = el("div", "overlay-actions");
  const saveBtn = el("button", "btn btn-dismiss", "SAVE");
  saveBtn.type = "button";
  saveBtn.addEventListener("click", async () => {
    try {
      const timeVal = clock.hasTime() ? clock.getTime() : null;
      const dateVal = cal.getDate();
      await updatePlanItem({
        index: detailItem!.index,
        time: timeVal,
        dueDate: dateVal,
        category,
        important,
      });
      detailItem = null;
      renderOverlay(true);
    } catch (err) {
      console.error(err);
    }
  });

  const toggleBtn = el("button", "btn btn-dismiss", detailItem.done ? "MARK PENDING" : "MARK DONE");
  toggleBtn.type = "button";
  toggleBtn.addEventListener("click", async () => {
    try {
      await togglePlanItem(detailItem!.index, !detailItem!.done);
      detailItem = null;
      renderOverlay(true);
    } catch (err) {
      console.error(err);
    }
  });
  actions.append(saveBtn, toggleBtn);
  card.appendChild(body);
  card.appendChild(actions);
  backdrop.appendChild(card);

  return backdrop;
}

function renderNotificationOverlay(): HTMLElement | null {
  if (!activeNotification) return null;

  const backdrop = el("div", "overlay-backdrop notification-backdrop");
  const card = el("div", "overlay-card notification-card");
  card.appendChild(el("div", "overlay-title", activeNotification.kind === "upcoming" ? "UPCOMING" : "NOW"));

  if (activeNotification.thumbUrl || activeNotification.imageUrl) {
    const img = document.createElement("img");
    img.className = "notification-thumb";
    img.src = activeNotification.thumbUrl ?? activeNotification.imageUrl!;
    img.alt = "";
    img.draggable = false;
    card.appendChild(img);
  }

  card.appendChild(el("div", "overlay-body", activeNotification.title));
  if (activeNotification.notes) card.appendChild(el("div", "overlay-meta", activeNotification.notes));

  const dismiss = el("button", "btn btn-dismiss", "DISMISS");
  dismiss.type = "button";
  dismiss.addEventListener("click", async () => {
    const id = activeNotification!.id;
    activeNotification = null;
    await dismissNotification(id).catch(() => {});
    renderOverlay(true);
  });
  const actions = el("div", "overlay-actions");
  actions.appendChild(dismiss);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function renderApprovalOverlay(): HTMLElement | null {
  if (!approval) return null;

  const backdrop = el("div", "overlay-backdrop");
  const card = el("div", "overlay-card");
  card.appendChild(el("div", "overlay-title", approval.kind === "exec" ? "EXEC APPROVAL" : "PLUGIN APPROVAL"));
  card.appendChild(el("div", "overlay-body", approval.title));

  const actions = el("div", "overlay-actions");
  const approve = el("button", "btn btn-approve", "APPROVE");
  approve.type = "button";
  approve.addEventListener("click", async () => {
    try {
      if (approval!.kind === "exec") await gateway.resolveExecApproval(approval!.requestId, true);
      else await gateway.resolvePluginApproval(approval!.requestId, true);
      approval = null;
      renderOverlay(true);
    } catch (err) {
      console.error(err);
    }
  });
  const deny = el("button", "btn btn-deny", "DENY");
  deny.type = "button";
  deny.addEventListener("click", async () => {
    try {
      if (approval!.kind === "exec") await gateway.resolveExecApproval(approval!.requestId, false);
      else await gateway.resolvePluginApproval(approval!.requestId, false);
      approval = null;
      renderOverlay(true);
    } catch (err) {
      console.error(err);
    }
  });
  actions.append(approve, deny);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function renderCronOverlay(): HTMLElement | null {
  const activeCron = cronPrompts.find((p) => !p.dismissed && p.status !== "completed");
  if (!activeCron) return null;

  const backdrop = el("div", "overlay-backdrop");
  const card = el("div", "overlay-card");
  card.appendChild(el("div", "overlay-title", "CRON JOB"));
  card.appendChild(el("div", "overlay-body", activeCron.name ?? activeCron.jobId ?? "Scheduled task"));

  const dismiss = el("button", "btn btn-dismiss", "DISMISS");
  dismiss.type = "button";
  dismiss.addEventListener("click", () => {
    activeCron.dismissed = true;
    renderOverlay(true);
  });
  const actions = el("div", "overlay-actions");
  actions.appendChild(dismiss);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function overlayKey(): string {
  if (approval) return `approval:${approval.requestId}`;
  if (activeNotification) return `notif:${activeNotification.id}`;
  if (detailItem) return `detail:${detailItem.index}`;
  const activeCron = cronPrompts.find((p) => !p.dismissed && p.status !== "completed");
  if (activeCron) return `cron:${activeCron.jobId ?? activeCron.id}`;
  return "";
}

function buildOverlay(): HTMLElement | null {
  return (
    renderApprovalOverlay() ??
    renderNotificationOverlay() ??
    (detailItem ? renderDetailOverlay() : null) ??
    renderCronOverlay()
  );
}

function renderOverlay(force = false): void {
  const key = overlayKey();
  if (!force && key === lastOverlayKey) return;
  lastOverlayKey = key;
  overlayRoot.replaceChildren();
  const overlay = buildOverlay();
  if (overlay) overlayRoot.appendChild(overlay);
}

function renderFilterBar(): HTMLElement {
  const bar = el("div", "filter-bar");
  for (const f of ["all", "personal", "work"] as const) {
    const btn = el("button", `filter-chip${planFilter === f ? " active" : ""}`, f === "all" ? "ALL" : f.toUpperCase());
    btn.type = "button";
    btn.addEventListener("click", () => {
      planFilter = f;
      renderMain();
    });
    bar.appendChild(btn);
  }
  return bar;
}

function renderInfoStrip(): HTMLElement {
  const strip = el("div", "info-strip scroll-themed");
  const gw = el("span", `info-chip ${gatewayOnline ? "online" : "offline"}`);
  gw.appendChild(el("span", "dot"));
  gw.appendChild(document.createTextNode(gatewayOnline ? "ONLINE" : "OFFLINE"));
  strip.appendChild(gw);

  const done = dashboard?.todolist.completed ?? 0;
  const pending = dashboard?.todolist.pending ?? 0;
  strip.appendChild(el("span", "info-chip", `${done}/${done + pending}`));

  return strip;
}

function renderMain(): void {
  mainRoot.replaceChildren();

  const topBar = el("header", "top-bar");
  const closeBtn = el("button", "close-btn", "✕");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", () => void exitApp());
  topBar.appendChild(closeBtn);

  const center = el("div", "header-center");
  center.appendChild(el("div", "greeting", getGreeting()));
  center.appendChild(el("div", "date-line", formatDate()));
  topBar.appendChild(center);

  const clock = el("div", "clock", formatClock());
  clock.id = "clock";
  topBar.appendChild(clock);

  mainRoot.appendChild(topBar);
  mainRoot.appendChild(renderInfoStrip());
  mainRoot.appendChild(renderFilterBar());

  const grid = el("main", "main-grid");

  const pendingPanel = el("section", "panel");
  pendingPanel.appendChild(el("div", "panel-header", "TODAY'S PLAN"));
  const pendingBody = el("div", "panel-body scroll-themed");
  pendingBody.appendChild(renderPlanItems(dashboard?.todolist.plan.pending ?? [], false));
  pendingPanel.appendChild(pendingBody);
  grid.appendChild(pendingPanel);

  const donePanel = el("section", "panel panel-done");
  donePanel.appendChild(el("div", "panel-header", "DONE TODAY"));
  const doneBody = el("div", "panel-body scroll-themed");
  doneBody.appendChild(renderPlanItems(dashboard?.todolist.plan.done ?? [], true));
  donePanel.appendChild(doneBody);
  grid.appendChild(donePanel);

  mainRoot.appendChild(grid);
}

function applyDashboardData(data: DashboardData): void {
  dashboard = data;
  gatewayOnline = data.gateway.online;

  if (detailItem) {
    detailItem = findPlanItem(data, detailItem.index) ?? detailItem;
  }

  if (!activeNotification && data.pending_notifications.length > 0) {
    activeNotification = data.pending_notifications[0]!;
    renderOverlay(true);
  }

  renderMain();
  if (detailItem) return;
  renderOverlay();
}

function bootstrap(): void {
  ensureFullscreen();
  setupGateway();
  setupClock();

  startLiveDashboard(
    (data) => applyDashboardData(data),
    (notification) => {
      activeNotification = notification;
      renderOverlay(true);
    },
    5000,
  );
}

function setupGateway(): void {
  gateway.on("cron", (payload) => {
    const event = gateway.parseCronEvent(payload);
    if (!event.jobId && !event.id) return;
    cronPrompts.unshift({ ...event, dismissed: false });
    cronPrompts = cronPrompts.slice(0, 10);
    renderOverlay(true);
  });

  gateway.on("exec.approval.requested", (payload) => {
    approval = gateway.parseApproval("exec.approval.requested", payload);
    renderOverlay(true);
  });

  gateway.on("plugin.approval.requested", (payload) => {
    approval = gateway.parseApproval("plugin.approval.requested", payload);
    renderOverlay(true);
  });

  gateway.connect();
}

function setupClock(): void {
  setInterval(() => {
    const clock = document.getElementById("clock");
    if (clock) clock.textContent = formatClock();
  }, 1000);
}

void bootstrap();
