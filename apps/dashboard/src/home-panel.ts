import type { HaArea, HaAreasResponse, HaHealthResponse, HaMood, HaMoodsResponse } from "@homebot/shared";
import {
  applyHaMood,
  callHaService,
  fetchHaAreas,
  fetchHaHealth,
  fetchHaMoods,
  runWarmStartup,
  toggleHaArea,
  turnOffAllLights,
} from "./home-api";
import { showToast } from "./toast";

const POLL_MS = 8_000;
const POST_ACTION_REFRESH_MS = 450;
const POST_ACTION_RETRY_MS = 1_500;
const STARTUP_REFRESH_MS = [2000, 5000, 9000];

const LIGHT_QUICK_MOODS: Array<{ id: string; label: string }> = [
  { id: "cozy", label: "Warm" },
  { id: "candle", label: "Candle" },
  { id: "party", label: "Party" },
];

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
  private moods: HaMoodsResponse | null = null;
  private busy = false;

  constructor(
    private readonly scroll: HTMLElement,
    private readonly refreshBtn: HTMLButtonElement,
    private readonly moodBar: HTMLElement,
  ) {}

  setBusy(on: boolean): void {
    this.busy = on;
    this.moodBar.querySelectorAll("button").forEach((btn) => {
      (btn as HTMLButtonElement).disabled = on;
    });
  }

  async ensureMoods(): Promise<HaMoodsResponse> {
    if (!this.moods) this.moods = await fetchHaMoods();
    return this.moods;
  }

  renderMoodBar(): void {
    void this.ensureMoods()
      .then((data) => {
        this.moodBar.replaceChildren();
        this.moodBar.appendChild(renderMoodBarContent(data, this));
      })
      .catch((err) => {
        this.moodBar.replaceChildren(el("div", "ha-mood-error", String(err)));
      });
  }

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

  async refreshAfterStartup(): Promise<void> {
    for (const ms of STARTUP_REFRESH_MS) {
      await delay(ms);
      await this.reload({ silent: true });
    }
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

function renderMoodBarContent(data: HaMoodsResponse, panel: HomePanelController): HTMLElement {
  const wrap = el("div", "ha-mood-bar-inner");

  const actionsRow = el("div", "ha-scene-actions");
  const startupBtn = el("button", "ha-mood-btn ha-startup-btn", `${data.startup.emoji} ${data.startup.name}`);
  startupBtn.type = "button";
  startupBtn.title = `${data.startup.description} — uses all lights in your areas`;
  startupBtn.addEventListener("click", () => {
    void (async () => {
      panel.setBusy(true);
      try {
        await runWarmStartup();
        showToast("Warm welcome started");
        void panel.refreshAfterStartup();
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        panel.setBusy(false);
      }
    })();
  });
  actionsRow.appendChild(startupBtn);

  const allOffBtn = el("button", "ha-mood-btn ha-all-off-btn", "🌙 All Off");
  allOffBtn.type = "button";
  allOffBtn.title = "Turn off every light in all areas";
  allOffBtn.addEventListener("click", () => {
    void (async () => {
      panel.setBusy(true);
      try {
        const result = await turnOffAllLights();
        showToast(result.count > 0 ? `${result.count} lights off` : "All lights off");
        await panel.refreshAfterAction();
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        panel.setBusy(false);
      }
    })();
  });
  actionsRow.appendChild(allOffBtn);
  wrap.appendChild(actionsRow);

  const moodsRow = el("div", "ha-mood-row");
  for (const mood of data.moods) {
    moodsRow.appendChild(renderMoodButton(mood, panel));
  }
  wrap.appendChild(moodsRow);
  return wrap;
}

function renderMoodButton(mood: HaMood, panel: HomePanelController): HTMLElement {
  const btn = el("button", "ha-mood-btn", `${mood.emoji} ${mood.name}`);
  btn.type = "button";
  btn.title = mood.description;
  btn.addEventListener("click", () => {
    void (async () => {
      panel.setBusy(true);
      try {
        await applyHaMood(mood.id);
        showToast(`${mood.name} mood applied`);
        await panel.refreshAfterAction();
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        panel.setBusy(false);
      }
    })();
  });
  return btn;
}

function renderEntityRow(entity: HaArea["entities"][number], panel: HomePanelController): HTMLElement {
  const block = el("div", "ha-entity-block");
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
  block.appendChild(row);

  if (entity.domain === "light") {
    const quick = el("div", "ha-light-quick");
    for (const preset of LIGHT_QUICK_MOODS) {
      const chip = el("button", "ha-light-chip", preset.label);
      chip.type = "button";
      chip.addEventListener("click", async (e) => {
        e.stopPropagation();
        chip.disabled = true;
        try {
          await applyHaMood(preset.id, { entity_id: entity.entity_id });
          await panel.refreshAfterAction();
        } catch (err) {
          showToast(String(err), "error");
        } finally {
          chip.disabled = false;
        }
      });
      quick.appendChild(chip);
    }
    block.appendChild(quick);
  }

  return block;
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

  const moodBar = el("div", "ha-mood-bar");
  moodBar.appendChild(el("div", "ha-health-summary", "Loading moods…"));
  card.appendChild(moodBar);

  const scroll = el("div", "home-panel-scroll");
  scroll.appendChild(el("p", "ha-status-msg", "Loading…"));
  card.appendChild(scroll);

  const actions = el("div", "overlay-actions");
  const refreshBtn = el("button", "btn btn-dismiss", "REFRESH");
  refreshBtn.type = "button";
  actions.appendChild(refreshBtn);
  card.appendChild(actions);

  const panel = new HomePanelController(scroll, refreshBtn, moodBar);

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
    panel.renderMoodBar();
    panel.startPolling();
  });

  return backdrop;
}
