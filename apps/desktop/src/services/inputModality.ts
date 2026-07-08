/**
 * Tracks whether the user is currently interacting via keyboard or pointer and
 * reflects it on `<html data-modality="keyboard|mouse">`. CSS uses this to show
 * the editor focus ring ONLY on keyboard focus — the browser's `:focus-visible`
 * heuristic is unreliable for contenteditable on WebKitGTK (it fires on mouse
 * click too, leaving a box around the editor). Keyboard navigation keeps working
 * either way; only the visual ring is gated.
 */
let attached = false;

export function initInputModality(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  const set = (m: "keyboard" | "mouse") => document.documentElement.setAttribute("data-modality", m);
  // Only navigation/edit keys count as "keyboard" intent (not every keypress).
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" || e.key === "PageUp" || e.key === "PageDown") {
        set("keyboard");
      }
    },
    true,
  );
  window.addEventListener("mousedown", () => set("mouse"), true);
  window.addEventListener("pointerdown", () => set("mouse"), true);
  set("mouse");
}
