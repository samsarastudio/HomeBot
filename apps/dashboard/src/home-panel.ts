import type { HaArea, HaAreasResponse, HaHealthResponse } from "@homebot/shared";
import { callHaService, fetchHaAreas, fetchHaHealth, toggleHaArea } from "./home-api";
import { showToast } from "./toast";

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

function renderEntityRow(entity: HaArea["entities"][number], scroll: HTMLElement): HTMLElement {
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
      await reloadPanel(scroll);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      toggle.disabled = false;
    }
  });
  row.append(label, toggle);
  return row;
}

function renderArea(area: HaArea, scroll: HTMLElement): HTMLElement {
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
    list.appendChild(renderEntityRow(entity, scroll));
  }

  header.addEventListener("click", async () => {
    header.disabled = true;
    try {
      await toggleHaArea(area.id, "toggle");
      await reloadPanel(scroll);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      header.disabled = false;
    }
  });

  section.append(header, list);
  return section;
}

function renderHomeBody(data: HaAreasResponse, scroll: HTMLElement): void {
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
    scroll.appendChild(renderArea(area, scroll));
  }
}

export function renderHomePanel(onClose: () => void): HTMLElement {
  const backdrop = el("div", "overlay-backdrop home-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) onClose();
  });

  const card = el("div", "overlay-card home-panel-card");
  const header = el("div", "home-panel-header");
  header.appendChild(el("div", "overlay-title", "HOME"));
  const closeBtn = el("button", "home-panel-close", "✕");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", onClose);
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
  refreshBtn.addEventListener("click", () => {
    void reloadPanel(scroll, healthStrip, refreshBtn);
  });
  actions.appendChild(refreshBtn);
  card.appendChild(actions);

  backdrop.appendChild(card);
  void reloadPanel(scroll, healthStrip, refreshBtn);
  return backdrop;
}

async function reloadPanel(
  scroll: HTMLElement,
  healthStrip?: HTMLElement,
  refreshBtn?: HTMLButtonElement,
): Promise<void> {
  const card = scroll.closest(".home-panel-card");
  let strip = healthStrip ?? card?.querySelector<HTMLElement>(".ha-health-strip") ?? undefined;
  const btn = refreshBtn ?? card?.querySelector<HTMLButtonElement>(".overlay-actions .btn");

  if (btn) btn.disabled = true;
  if (strip) {
    strip.className = "ha-health-strip loading";
    strip.replaceChildren(el("div", "ha-health-summary", "Checking Home Assistant…"));
  }
  scroll.replaceChildren(el("p", "ha-status-msg", "Loading…"));

  try {
    const [health, areas] = await Promise.all([fetchHaHealth(), fetchHaAreas()]);
    if (strip) {
      const rendered = renderHealthStrip(health);
      strip.replaceWith(rendered);
      strip = rendered;
    }
    renderHomeBody(areas, scroll);
  } catch (err) {
    if (strip) {
      strip.className = "ha-health-strip fail";
      strip.replaceChildren(el("div", "ha-health-line", String(err)));
    }
    scroll.replaceChildren(el("p", "ha-status-msg", String(err)));
  } finally {
    if (btn) btn.disabled = false;
  }
}
