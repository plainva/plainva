import { useSyncExternalStore } from "react";
import type { MailCanvas } from "./mailSanitize";

/**
 * The app theme's reading canvas for the mail frame (finding X3, review
 * 2026-11-10), read where both shells render a message.
 *
 * The frame is its own document: the theme's custom properties do not reach
 * it, so their COMPUTED values are handed in. They change with the mode, the
 * named theme and a personal design — all three are written onto the root
 * element (`data-theme`, `data-theme-name`, inline custom properties), which
 * is what the subscription below watches.
 */
export function readMailCanvas(root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement): MailCanvas | null {
  if (!root || typeof getComputedStyle !== "function") return null;
  const css = getComputedStyle(root);
  const text = css.getPropertyValue("--text-main").trim();
  const background = css.getPropertyValue("--bg-primary").trim();
  const link = css.getPropertyValue("--accent-color").trim();
  if (!text || !background || !link) return null;
  return { text, background, link, dark: root.getAttribute("data-theme") === "dark" };
}

let cached: MailCanvas | null = null;
let cachedKey = "";

function snapshot(): MailCanvas | null {
  const next = readMailCanvas();
  const key = next ? `${next.text}|${next.background}|${next.link}|${next.dark}` : "";
  if (key !== cachedKey) {
    cachedKey = key;
    cached = next;
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-name", "style", "class"] });
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  media?.addEventListener?.("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener?.("change", onChange);
  };
}

/** The current theme's mail canvas; re-renders when the theme changes. */
export function useMailCanvas(): MailCanvas | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
