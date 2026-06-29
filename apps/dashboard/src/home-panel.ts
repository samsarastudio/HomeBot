import type { HaArea, HaAreasResponse, HaHealthResponse } from "@homebot/shared";
import { callHaService, fetchHaAreas, fetchHaHealth, toggleHaArea } from "./home-api";
import { showToast } from "./toast";

const POLL_MS = 8_000;
const POST_ACTION_REFRESH_MS = 450;
const POST_ACTION_RETRY_MS = 1_500;

interface ReloadOptions {
  silent?: boolean;
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function areaStateLabel(area: HaArea): "OFF" | "ON" | "MIXED" {
  const onCount = area.entities.filter((e) => e.on).length;
  if (area.entities.length === 0) return "OFF";
  if (onCount === 0) return "OFF";
  if (onCount === area.entities.length) return "ON";
  return "MIXED";
}

function renderHealthStrip(health: HaHealthResponse): HTMLElement {
  const strip = el("div", `ha-health-strip${health.ok ? " ok" : " fail"}`);

  const chips = el("div", "ha-health-chips");
  for (const item of health.checks) {
    const chip = el("span", `ha-health-chip${item.ok ? " ok" : " fail"}`, item.label.toUpperCase());
    if (item.detail) chip.title = item.detail;
    chips.appendChild(chip);
  }
  strip.appendChild(chips);

  const summary = el(
    "div",
    "ha-health-summary",
    `${health.url} · ${health.devices_in_areas} devices · ${health.areas_with_devices} areas`,
  );
  strip.appendChild(summary);

  const failed = health.checks.filter((c) => !c.ok);
  if (failed.length > 0 || health.error) {
    const detail = el("div", "ha-health-detail");
    for (const item of failed) {
      detail.appendChild(el("div", "ha-health-line", `${item.label}: ${item.detail ?? "failed"}`));
    }
    if (health.error && !failed.some((f) => f.detail === health.error)) {
      detail.appendChild(el("div", "ha-health-line", health.error));
    }
    strip.appendChild(detail);
  }

  return strip;
}

class HomePanelController {
  private pollTimer = 0;
  private reloadQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly scroll: HTMLElement,
    private readonly refreshBtn: HTMLButtonElement,
  ) {}

  startPolling(): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      void this.reload({ silent: true });
    }, POLL_MS);
  }

  stopPolling(): void {
    window.clearInterval(this.pollTimer);
    this.pollTimer = 0;
  }

  async reload(options: ReloadOptions = {}): Promise<void> {
    this.reloadQueue = this.reloadQueue.then(() => this.reloadNow(options));
    return this.reloadQueue;
  }

  async refreshAfterAction(): Promise<void> {
    await delay(POST_ACTION_REFRESH_MS);
    await this.reload({ silent: true });
    await delay(POST_ACTION_RETRY_MS);
    await this.reload({ silent: true });
  }

  private async reloadNow(options: ReloadOptions): Promise<void> {
    const card = this.scroll.closest(".home-panel-card");
    let strip = card?.querySelector<HTMLElement>(".ha-health-strip") ?? undefined;
    const scrollTop = this.scroll.scrollTop;
    const silent = options.silent === true;

    if (!silent) {
      this.refreshBtn.disabled = true;
      if (strip) {
        strip.className = "ha-health-strip loading";
        strip.replaceChildren(el("div", "ha-health-summary", "Checking Home Assistant…"));
      }
      this.scroll.replaceChildren(el("p", "ha-status-msg", "Loading…"));
    }

    try {
      const [health, areas] = await Promise.all([fetchHaHealth(), fetchHaAreas()]);
      if (strip) {
        const rendered = renderHealthStrip(health);
        strip.replaceWith(rendered);
        strip = rendered;
      }
      renderHomeBody(areas, this.scroll, this);
      if (silent) this.scroll.scrollTop = scrollTop;
    } catch (err) {
      if (strip) {
        strip.className = "ha-health-strip fail";
        strip.replaceChildren(el("div", "ha-health-line", String(err)));
      }
      if (!silent) {
        this.scroll.replaceChildren(el("p", "ha-status-msg", String(err)));
      }
    } finally {
      if (!silent) this.refreshBtn.disabled = false;
    }
  }
}

function renderEntityRow(entity: HaArea["entities"][number], panel: HomePanelController): HTMLElement {
  const row = el("div", `ha-entity-row${entity.on ? " on" : ""}`);
  const label = el("span", "ha-entity-name", entity.name);
  const toggle = el("button", `ha-toggle${entity.on ? " active" : ""}`, entity.on ? "ON" : "OFF");
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", entity.on ? "true" : "false");
  toggle.setAttribute("aria-label", `Toggle ${entity.name}`);
  toggle.addEventListener("click", async (e) => {
    e.stopPropagation();
    toggle.disabled = true;
    try {
      await callHaService(entity.entity_id, "toggle");
      await panel.refreshAfterAction();
    } catch (err) {
      showToast(String(err), "error");
      await panel.reload({ silent: true });
    } finally {
      toggle.disabled = false;
    }
  });
  row.append(label, toggle);
  return row;
}

function renderArea(area: HaArea, panel: HomePanelController): HTMLElement {
  const section = el("section", "ha-area");
  const state = areaStateLabel(area);
  const allOn = state === "ON";

  const header = el("button", `ha-area-header${allOn ? " on" : state === "MIXED" ? " mixed" : ""}`);
  header.type = "button";

  const titleWrap = el("div", "ha-area-title-wrap");
  titleWrap.appendChild(el("span", "ha-area-name", area.name));
  const countLabel =
    area.entities.length === 1 ? "1 device" : `${area.entities.length} devices`;
  titleWrap.appendChild(el("span", "ha-area-count", countLabel));
  header.appendChild(titleWrap);

  const badge = el(
    "span",
    `ha-area-state${allOn ? " active" : state === "MIXED" ? " mixed" : ""}`,
    state,
  );
  header.appendChild(badge);

  const list = el("div", "ha-entity-list");
  for (const entity of area.entities) {
    list.appendChild(renderEntityRow(entity, panel));
  }

  header.addEventListener("click", async () => {
    header.disabled = true;
    try {
      await toggleHaArea(area.id, "toggle");
      await panel.refreshAfterAction();
    } catch (err) {
      showToast(String(err), "error");
      await panel.reload({ silent: true });
    } finally {
      header.disabled = false;
    }
  });

  section.append(header, list);
  return section;
}

function renderHomeBody(
  data: HaAreasResponse,
  scroll: HTMLElement,
  panel: HomePanelController,
): void {
  scroll.replaceChildren();

  if (!data.configured) {
    scroll.appendChild(
      el(
        "p",
        "ha-status-msg",
        "Home Assistant not configured. Add a token at ~/.openclaw/secrets/ha-token",
      ),
    );
    return;
  }

  if (!data.reachable) {
    scroll.appendChild(
      el("p", "ha-status-msg", data.error ?? "Cannot reach Home Assistant"),
    );
    return;
  }

  if (data.areas.length === 0) {
    scroll.appendChild(
      el(
        "p",
        "ha-status-msg",
        "No controllable devices found. Check the health strip above — assign lights and switches to areas in Home Assistant.",
      ),
    );
    return;
  }

  for (const area of data.areas) {
    scroll.appendChild(renderArea(area, panel));
  }
}

export function renderHomePanel(onClose: () => void): HTMLElement {
  const backdrop = el("div", "overlay-backdrop home-backdrop");

  const card = el("div", "overlay-card home-panel-card");
  const header = el("div", "home-panel-header");
  header.appendChild(el("div", "overlay-title", "HOME"));
  const closeBtn = el("button", "home-panel-close", "✕");
  closeBtn.type = "button";
  header.appendChild(closeBtn);
  card.appendChild(header);

  const healthStrip = el("div", "ha-health-strip loading");
  healthStrip.appendChild(el("div", "ha-health-summary", "Checking Home Assistant…"));
  card.appendChild(healthStrip);

  const scroll = el("div", "home-panel-scroll");
  scroll.appendChild(el("p", "ha-status-msg", "Loading…"));
  card.appendChild(scroll);

  const actions = el("div", "overlay-actions");
  const refreshBtn = el("button", "btn btn-dismiss", "REFRESH");
  refreshBtn.type = "button";
  actions.appendChild(refreshBtn);
  card.appendChild(actions);

  const panel = new HomePanelController(scroll, refreshBtn);

  const handleClose = () => {
    panel.stopPolling();
    onClose();
  };

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) handleClose();
  });
  closeBtn.addEventListener("click", handleClose);

  refreshBtn.addEventListener("click", () => {
    void panel.reload();
  });

  backdrop.appendChild(card);

  void panel.reload().then(() => {
    panel.startPolling();
  });

  return backdrop;
}
