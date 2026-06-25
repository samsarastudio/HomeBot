/** Reliable vertical touch scroll for kiosk Chromium when nested rows block native pan. */
export function enableTouchScroll(panel: HTMLElement): void {
  let startY = 0;
  let startScroll = 0;
  let tracking = false;

  panel.addEventListener(
    "touchstart",
    (e) => {
      if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
      startY = e.touches[0]!.clientY;
      startScroll = panel.scrollTop;
      tracking = true;
    },
    { passive: true },
  );

  panel.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking) return;
      const dy = startY - e.touches[0]!.clientY;
      panel.scrollTop = startScroll + dy;
      panel.dataset.scrolling = "1";
    },
    { passive: true },
  );

  panel.addEventListener(
    "touchend",
    () => {
      tracking = false;
      window.setTimeout(() => {
        delete panel.dataset.scrolling;
      }, 200);
    },
    { passive: true },
  );

  panel.addEventListener(
    "touchcancel",
    () => {
      tracking = false;
    },
    { passive: true },
  );
}
