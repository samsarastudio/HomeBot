const QUERY_7IN = "(max-width: 800px) and (max-height: 500px)";

let layout7in = false;
let mql: MediaQueryList | null = null;

export function is7inLayout(): boolean {
  return layout7in;
}

export function tapMoveThreshold(): number {
  return layout7in ? 16 : 15;
}

export function initLayoutDetection(onChange?: () => void): void {
  mql = window.matchMedia(QUERY_7IN);
  const apply = () => {
    layout7in = mql!.matches;
    document.documentElement.dataset.layout = layout7in ? "7in" : "default";
    onChange?.();
  };
  apply();
  mql.addEventListener("change", apply);
}

export function isNightDeskHour(date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 22 || hour < 5;
}
