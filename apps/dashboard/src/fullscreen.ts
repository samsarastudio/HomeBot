/** Request fullscreen when the browser allows it (fallback when not launched with --kiosk). */
export function ensureFullscreen(): void {
  // Chromium --kiosk is already fullscreen; calling requestFullscreen on first tap
  // shows "Press Esc to exit full screen" on touch-only displays.
  if (isLikelyKioskMode()) return;

  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  const request = () => {
    if (document.fullscreenElement) return;
    const fn =
      root.requestFullscreen?.bind(root) ??
      root.webkitRequestFullscreen?.bind(root);
    if (!fn) return;
    void Promise.resolve(fn()).catch(() => {});
  };

  request();

  // Browsers block autoplay fullscreen — first touch enters fullscreen in dev/windowed mode.
  const onInteract = () => {
    request();
    document.removeEventListener("pointerdown", onInteract);
  };
  document.addEventListener("pointerdown", onInteract, { passive: true });
}

export function isLikelyKioskMode(): boolean {
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  if (window.outerHeight >= screen.height - 80 && window.outerWidth >= screen.width - 80) {
    return true;
  }
  return false;
}
