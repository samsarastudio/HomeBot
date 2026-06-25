import type { CalendarNotification, DashboardData, PlanCategory, PlanItem } from "@homebot/shared";
import { dismissNotification, exitApp, togglePlanItem, updatePlanItem } from "./api";
import { gateway } from "./gateway/client";
import { startLiveDashboard } from "./live-dashboard";
import { ensureFullscreen } from "./fullscreen";
import { formatClock, formatDate, getGreeting } from "./utils/time";
import { formatAgeMinutes, isItemOverdue, sortPlanItems } from "./plan-utils";
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
let lastPlanKey = "";
let mainShellBuilt = false;
let pendingBodyEl: HTMLElement | null = null;
let doneBodyEl: HTMLElement | null = null;
let pendingHeaderEl: HTMLElement | null = null;
let doneHeaderEl: HTMLElement | null = null;
let gatewayChipEl: HTMLElement | null = null;
let cronChipEl: HTMLElement | null = null;
let runChipEl: HTMLElement | null = null;
let countChipEl: HTMLElement | null = null;
let cpuChipEl: HTMLElement | null = null;
let ramChipEl: HTMLElement | null = null;
let diskChipEl: HTMLElement | null = null;
const addedAtCache = new Map<string, string>();

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
  const sorted = sortPlanItems(items, todayYmd());
  if (planFilter === "all") return sorted;
  return sorted.filter((i) => (i.category ?? "personal") === planFilter);
}

function addedAtStorageKey(item: PlanItem): string {
  return `homebot-added-${todayYmd()}:${item.index}`;
}

function getItemAddedAt(item: PlanItem): string {
  if (item.addedAt) return item.addedAt;
  const key = addedAtStorageKey(item);
  if (addedAtCache.has(key)) return addedAtCache.get(key)!;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      addedAtCache.set(key, stored);
      return stored;
    }
  } catch {
    /* private mode */
  }
  const now = new Date().toISOString();
  addedAtCache.set(key, now);
  try {
    sessionStorage.setItem(key, now);
  } catch {
    /* ignore */
  }
  return now;
}

function planDataKey(): string {
  if (!dashboard) return "";
  const plan = dashboard.todolist.plan;
  const snap = (items: PlanItem[]) =>
    items.map((i) => ({
      index: i.index,
      done: i.done,
      time: i.time,
      dueDate: i.dueDate,
      title: i.title,
      category: i.category,
      important: i.important,
      addedAt: i.addedAt,
      carryFrom: i.carryFrom,
    }));
  return JSON.stringify({
    filter: planFilter,
    pending: snap(plan.pending),
    done: snap(plan.done),
  });
}

function preservePanelScroll(): Record<string, number> {
  const tops: Record<string, number> = {};
  for (const panel of mainRoot.querySelectorAll<HTMLElement>(".panel-body[data-scroll-id]")) {
    const id = panel.dataset.scrollId;
    if (id) tops[id] = panel.scrollTop;
  }
  return tops;
}

function restorePanelScroll(tops: Record<string, number>): void {
  for (const panel of mainRoot.querySelectorAll<HTMLElement>(".panel-body[data-scroll-id]")) {
    const id = panel.dataset.scrollId;
    if (id && tops[id] !== undefined) panel.scrollTop = tops[id];
  }
}

function attachPanelScrollGuard(panel: HTMLElement): void {
  let timer = 0;
  panel.addEventListener(
    "scroll",
    () => {
      panel.dataset.scrolling = "1";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        delete panel.dataset.scrolling;
      }, 200);
    },
    { passive: true },
  );
}

function bindTapOpen(target: HTMLElement, item: PlanItem, scrollParent: HTMLElement): void {
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
    if (scrollParent.dataset.scrolling === "1") return;
    const dy = Math.abs(e.changedTouches[0]!.clientY - startY);
    const dx = Math.abs(e.changedTouches[0]!.clientX - startX);
    if (dy > 15 || dx > 15) return;
    openDetail(item);
  });

  target.addEventListener("click", (e) => {
    if (e.detail === 0) return;
    if (scrollParent.dataset.scrolling === "1") return;
    openDetail(item);
  });
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

function renderPlanItems(items: PlanItem[], done: boolean, scrollParent: HTMLElement): HTMLElement {
  const container = el("div", "plan-list");
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
    const carryClass =
      !done && item.carryBand === "red"
        ? " carry-red"
        : !done && item.carryBand === "orange"
          ? " carry-orange"
          : "";
    const row = el(
      "div",
      `plan-item${done ? " done-item" : ""}${overdue ? " overdue" : ""}${carryClass}${item.important ? " important" : ""}`,
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

    if (itemHasImage(item) || item.attachment) {
      body.appendChild(thumbForItem(item));
    }

    const textWrap = el("div", "plan-text");
    const meta = el("div", "plan-meta-row");

    if (item.time) meta.appendChild(el("span", `plan-time${overdue && !done ? " overdue-text" : ""}`, item.time));
    if (!done && item.dueDate) {
      const d = item.dueDate.slice(5).replace("-", "/");
      meta.appendChild(el("span", `plan-date${overdue ? " overdue-text" : ""}`, d));
    }
    if (!done && item.important) meta.appendChild(el("span", "plan-badge important", "★"));
    if (!done && item.category === "work") meta.appendChild(el("span", "plan-badge work", "WORK"));
    if (!done && item.carryFrom) {
      const label =
        item.carriedDays === 1
          ? "YESTERDAY"
          : `FROM ${item.carryFrom.slice(5).replace("-", "/")}`;
      meta.appendChild(el("span", `plan-badge carry${item.carryBand === "red" ? " carry-late" : ""}`, label));
    }
    if (!done) {
      const addedAt = getItemAddedAt(item);
      const age = el("span", "plan-age");
      age.dataset.addedAt = addedAt;
      age.textContent = formatAgeMinutes(addedAt);
      meta.appendChild(age);
    }
    if (meta.childElementCount > 0) textWrap.appendChild(meta);

    textWrap.appendChild(el("div", `plan-title${overdue && !done ? " overdue-text" : ""}`, item.title));
    if (!done && item.description) textWrap.appendChild(el("div", "plan-desc", item.description));
    body.appendChild(textWrap);

    bindTapOpen(body, item, scrollParent);

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

  const body = el("div", "detail-card-body");
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

function updateAgeLabels(): void {
  const now = Date.now();
  for (const age of mainRoot.querySelectorAll<HTMLElement>(".plan-age[data-added-at]")) {
    const addedAt = age.dataset.addedAt;
    if (addedAt) age.textContent = formatAgeMinutes(addedAt, now);
  }
}

function updateInfoStrip(): void {
  const done = dashboard?.todolist.completed ?? 0;
  const pending = dashboard?.todolist.pending ?? 0;
  const cronCount = dashboard?.cron_jobs.filter((j) => j.enabled).length ?? 0;

  if (gatewayChipEl) {
    gatewayChipEl.className = `info-chip ${gatewayOnline ? "online" : "offline"}`;
    const label = gatewayChipEl.lastChild;
    if (label) label.textContent = gatewayOnline ? "ONLINE" : "OFFLINE";
  }
  if (cronChipEl) cronChipEl.textContent = `CRON ${cronCount}`;
  if (runChipEl) runChipEl.textContent = `RUN ${dashboard?.tasks.running ?? 0}`;
  if (countChipEl) countChipEl.textContent = `${done}/${done + pending}`;

  const sys = dashboard?.system;
  if (sys) {
    if (cpuChipEl) cpuChipEl.textContent = `CPU ${sys.cpu}`;
    if (ramChipEl) ramChipEl.textContent = `RAM ${sys.ram}`;
    if (diskChipEl) diskChipEl.textContent = `DISK ${sys.disk}`;
  }
}

function updatePanelHeaders(): void {
  const pendingCount = filterItems(dashboard?.todolist.plan.pending ?? []).length;
  const doneCount = filterItems(dashboard?.todolist.plan.done ?? []).length;
  if (pendingHeaderEl) pendingHeaderEl.textContent = `TODAY'S PLAN (${pendingCount})`;
  if (doneHeaderEl) doneHeaderEl.textContent = `DONE TODAY (${doneCount})`;
}

function updatePlanPanels(): void {
  const key = planDataKey();
  if (key === lastPlanKey) {
    updateAgeLabels();
    return;
  }

  const scrollTops = preservePanelScroll();
  lastPlanKey = key;

  if (pendingBodyEl) {
    pendingBodyEl.replaceChildren();
    pendingBodyEl.appendChild(renderPlanItems(dashboard?.todolist.plan.pending ?? [], false, pendingBodyEl));
  }
  if (doneBodyEl) {
    doneBodyEl.replaceChildren();
    doneBodyEl.appendChild(renderPlanItems(dashboard?.todolist.plan.done ?? [], true, doneBodyEl));
  }

  restorePanelScroll(scrollTops);
  updatePanelHeaders();
  updateAgeLabels();
  updateInfoStrip();
}

function renderFilterBar(): HTMLElement {
  const bar = el("div", "filter-bar");
  for (const f of ["all", "personal", "work"] as const) {
    const btn = el("button", `filter-chip${planFilter === f ? " active" : ""}`, f === "all" ? "ALL" : f.toUpperCase());
    btn.type = "button";
    btn.addEventListener("click", () => {
      planFilter = f;
      lastPlanKey = "";
      for (const chip of bar.querySelectorAll(".filter-chip")) chip.classList.remove("active");
      btn.classList.add("active");
      updatePlanPanels();
    });
    bar.appendChild(btn);
  }
  return bar;
}

function renderInfoStrip(): HTMLElement {
  const strip = el("div", "info-strip");
  gatewayChipEl = el("span", `info-chip ${gatewayOnline ? "online" : "offline"}`);
  gatewayChipEl.appendChild(el("span", "dot"));
  gatewayChipEl.appendChild(document.createTextNode(gatewayOnline ? "ONLINE" : "OFFLINE"));
  strip.appendChild(gatewayChipEl);

  const cronCount = dashboard?.cron_jobs.filter((j) => j.enabled).length ?? 0;
  cronChipEl = el("span", "info-chip", `CRON ${cronCount}`);
  strip.appendChild(cronChipEl);

  runChipEl = el("span", "info-chip", `RUN ${dashboard?.tasks.running ?? 0}`);
  strip.appendChild(runChipEl);

  const done = dashboard?.todolist.completed ?? 0;
  const pending = dashboard?.todolist.pending ?? 0;
  countChipEl = el("span", "info-chip", `${done}/${done + pending}`);
  strip.appendChild(countChipEl);

  const sys = dashboard?.system;
  if (sys) {
    cpuChipEl = el("span", "info-chip", `CPU ${sys.cpu}`);
    ramChipEl = el("span", "info-chip", `RAM ${sys.ram}`);
    diskChipEl = el("span", "info-chip", `DISK ${sys.disk}`);
    strip.append(cpuChipEl, ramChipEl, diskChipEl);
  }

  return strip;
}

function buildMainShell(): void {
  mainRoot.replaceChildren();

  const topBar = el("header", "top-bar");
  const closeBtn = el("button", "close-btn", "✕");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", () => void exitApp());
  topBar.appendChild(closeBtn);

  const center = el("div", "header-center");
  const greeting = el("div", "greeting", getGreeting());
  greeting.id = "greeting";
  center.appendChild(greeting);
  const dateLine = el("div", "date-line", formatDate());
  dateLine.id = "date-line";
  center.appendChild(dateLine);
  topBar.appendChild(center);

  const clock = el("div", "clock", formatClock());
  clock.id = "clock";
  topBar.appendChild(clock);

  mainRoot.appendChild(topBar);
  mainRoot.appendChild(renderInfoStrip());
  mainRoot.appendChild(renderFilterBar());

  const grid = el("main", "main-grid");

  const pendingPanel = el("section", "panel");
  pendingHeaderEl = el("div", "panel-header", "TODAY'S PLAN");
  pendingPanel.appendChild(pendingHeaderEl);
  pendingBodyEl = el("div", "panel-body");
  pendingBodyEl.dataset.scrollId = "pending";
  attachPanelScrollGuard(pendingBodyEl);
  pendingPanel.appendChild(pendingBodyEl);
  grid.appendChild(pendingPanel);

  const donePanel = el("section", "panel panel-done");
  doneHeaderEl = el("div", "panel-header", "DONE TODAY");
  donePanel.appendChild(doneHeaderEl);
  doneBodyEl = el("div", "panel-body");
  doneBodyEl.dataset.scrollId = "done";
  attachPanelScrollGuard(doneBodyEl);
  donePanel.appendChild(doneBodyEl);
  grid.appendChild(donePanel);

  mainRoot.appendChild(grid);
  mainShellBuilt = true;
}

function renderMain(): void {
  if (!mainShellBuilt) {
    buildMainShell();
    refreshHeaderTime();
  }
  updatePlanPanels();
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
  updateInfoStrip();
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

function refreshHeaderTime(now = new Date()): void {
  const clock = document.getElementById("clock");
  if (clock) clock.textContent = formatClock(now);

  const greeting = document.getElementById("greeting");
  if (greeting) greeting.textContent = getGreeting(now);

  const dateLine = document.getElementById("date-line");
  if (dateLine) dateLine.textContent = formatDate(now);
}

function setupClock(): void {
  refreshHeaderTime();

  setInterval(() => {
    refreshHeaderTime();
  }, 1000);

  setInterval(() => {
    updateAgeLabels();
  }, 60_000);
}

void bootstrap();
