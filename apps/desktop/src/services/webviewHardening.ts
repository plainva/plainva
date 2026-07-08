import { openContextMenu } from "./contextMenuStore";
import { findEditable, selectedText } from "../lib/editableField";

/**
 * Webview hardening (2026-07-07): make the shipped app feel like a native
 * desktop app and keep the single-page state stable.
 *
 *  - The native WebView right-click menu (Reload, Back, Save as, Inspect) is
 *    suppressed everywhere. The app's OWN context menus (file tree, tabs, table
 *    cells, block handles, graph) call preventDefault/stopPropagation first, so
 *    this bubble-phase listener leaves them untouched (`e.defaultPrevented`).
 *    Over plain text with a selection we open our own minimal "Copy" menu.
 *  - Reload keys (F5, Ctrl/Cmd+R) are swallowed: a reload throws away the whole
 *    in-memory app state (open tabs, unsaved buffers, split layout). Mod+Alt+R
 *    stays free — it toggles the right sidebar — because we require `!altKey`.
 *  - DevTools keys (F12, Ctrl/Cmd+Shift+I/J/C) are swallowed only in production.
 *    Release builds ship without devtools anyway; dev builds keep them so the
 *    maintainer can still debug.
 *
 * Idempotent — call once from main.tsx.
 */

let installed = false;

/** F5 or Ctrl/Cmd+R (but NOT Mod+Alt+R, the right-sidebar toggle). */
export function isReloadKey(e: KeyboardEvent): boolean {
  if (e.key === "F5") return true;
  const mod = e.ctrlKey || e.metaKey;
  return mod && !e.altKey && e.key.toLowerCase() === "r";
}

/** F12 or Ctrl/Cmd+Shift+I / J / C. */
export function isDevtoolsKey(e: KeyboardEvent): boolean {
  if (e.key === "F12") return true;
  const mod = e.ctrlKey || e.metaKey;
  return mod && e.shiftKey && ["i", "j", "c"].includes(e.key.toLowerCase());
}

function onKeyDown(e: KeyboardEvent): void {
  if (isReloadKey(e) || (import.meta.env.PROD && isDevtoolsKey(e))) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onContextMenu(e: MouseEvent): void {
  // An app-owned context menu already handled this right-click — leave it be.
  if (e.defaultPrevented) return;
  // Kill the native WebView menu everywhere else.
  e.preventDefault();
  const editable = findEditable(e.target);
  const selection = selectedText(editable);
  // Over an editable field we always offer Paste; over plain text we only offer
  // Copy when there is a selection. Otherwise nothing shows.
  if (!editable && !selection) return;
  openContextMenu({ x: e.clientX, y: e.clientY, selection, editable });
}

export function initWebviewHardening(): void {
  if (installed) return;
  installed = true;
  // Capture phase so we win before app/webview handlers see reload/devtools keys.
  window.addEventListener("keydown", onKeyDown, true);
  // Bubble phase so app context menus (which run first) can opt out via preventDefault.
  document.addEventListener("contextmenu", onContextMenu);
}

/** Test hook. */
export function resetWebviewHardeningForTests(): void {
  installed = false;
  window.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("contextmenu", onContextMenu);
}
