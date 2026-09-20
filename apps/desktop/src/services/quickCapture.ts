import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "./settingsStore";

/**
 * The global quick capture (plan Journal, J7) — central window only.
 *
 * Opt-in, off by default: ONE system-wide shortcut opens a small window with
 * the journal's capture field, even while Plainva sits in the tray. The window
 * writes nothing itself: it hands what was typed to this window over the bus,
 * and the journal's one write path takes it from there.
 *
 * What this module keeps honest:
 *   - nothing is registered until the user switches it on, and switching it off
 *     (or picking another shortcut) releases the old one FIRST;
 *   - a shortcut the system refuses — taken by another application, not a key
 *     it knows — is reported with the reason, never left as a switch that is on
 *     and does nothing;
 *   - under Wayland the platform gives applications no system-wide key; that is
 *     said instead of tried (parity catalog: `global-quick-capture`).
 *
 * It is a DEVICE setting: a shortcut that is free on one machine is taken on
 * the next, so it stays out of the settings profile.
 */

export const QUICK_CAPTURE_ENABLED_KEY = "quickCaptureEnabled";
export const QUICK_CAPTURE_SHORTCUT_KEY = "quickCaptureShortcut";
/** Ctrl/Cmd+Alt+J: beside the in-app Ctrl/Cmd+Shift+J, and free in the usual browsers and editors. */
export const DEFAULT_QUICK_CAPTURE_SHORTCUT = "CommandOrControl+Alt+J";
export const CAPTURE_WINDOW_LABEL = "capture-main";

export interface QuickCaptureConfig { enabled: boolean; shortcut: string }

export type QuickCaptureFailure = "taken" | "invalid" | "wayland";

export type QuickCaptureState =
  | { status: "off" }
  | { status: "on"; shortcut: string }
  | { status: "failed"; shortcut: string; reason: QuickCaptureFailure; error?: string };

/* ------------------------------------------------------------ the shortcut */

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS", "Super", "Hyper", "Fn", "CapsLock"]);

/** `KeyboardEvent.code` → the key's name in an accelerator; only keys a global shortcut should end in. */
function keyOfCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (["Space", "Backquote", "Minus", "Equal", "Comma", "Period", "Slash", "Semicolon", "Quote", "BracketLeft", "BracketRight", "Backslash"].includes(code)) return code;
  return null;
}

export interface ShortcutKeyEvent { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

/**
 * What a key press means for the recorder.
 *   - `incomplete`: only modifiers so far — keep listening;
 *   - `needs-modifier`: a key without Ctrl, Alt or Cmd/Super — a bare (or merely
 *     shifted) key as a system-wide shortcut would take it away from every
 *     application;
 *   - `unsupported`: a key this recorder does not offer (Esc, Enter, arrows …).
 * Reads the physical key (`code`), so the shortcut is the same on every layout.
 */
export function acceleratorFromEvent(e: ShortcutKeyEvent, mac: boolean): { ok: true; accelerator: string } | { ok: false; reason: "incomplete" | "needs-modifier" | "unsupported" } {
  if (MODIFIER_KEYS.has(e.key)) return { ok: false, reason: "incomplete" };
  const key = keyOfCode(e.code);
  if (!key) return { ok: false, reason: "unsupported" };
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return { ok: false, reason: "needs-modifier" };
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push(mac ? "Command" : "Super");
  return { ok: true, accelerator: [...parts, key].join("+") };
}

const KEY_LABEL: Record<string, string> = {
  Space: "Space", Backquote: "`", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\",
};

/** The accelerator as key caps, in the platform's spelling (`Ctrl`/`⌘`, `Alt`/`⌥`). */
export function acceleratorLabels(accelerator: string, mac: boolean): string[] {
  return accelerator.split("+").filter(Boolean).map((part) => {
    switch (part) {
      case "CommandOrControl": case "CmdOrCtrl": return mac ? "⌘" : "Ctrl";
      case "Control": case "Ctrl": return mac ? "⌃" : "Ctrl";
      case "Alt": case "Option": return mac ? "⌥" : "Alt";
      case "Shift": return mac ? "⇧" : "Shift";
      case "Command": case "Cmd": return "⌘";
      case "Super": case "Meta": return mac ? "⌘" : "Win";
      default: return KEY_LABEL[part] ?? part;
    }
  });
}

/* ------------------------------------------------------------ registration */

export interface QuickCaptureDeps {
  register: (shortcut: string, onPressed: () => void) => Promise<void>;
  unregister: (shortcut: string) => Promise<void>;
  sessionKind: () => Promise<"wayland" | "other">;
  open: () => Promise<void>;
}

/** The real plugin, imported inside the functions (C20: nothing from Tauri while modules load). */
export const tauriQuickCaptureDeps: QuickCaptureDeps = {
  register: async (shortcut, onPressed) => {
    const { register } = await import("@tauri-apps/plugin-global-shortcut");
    // The plugin reports the key going down AND coming up; one window per press.
    await register(shortcut, (event) => { if (event.state === "Pressed") onPressed(); });
  },
  unregister: async (shortcut) => {
    const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
    await unregister(shortcut);
  },
  sessionKind: async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string>("desktop_session_kind")) === "wayland" ? "wayland" : "other";
  },
  open: () => openCaptureWindow(),
};

/** A refused registration, sorted: a key the system does not know, or one somebody else holds. */
export function classifyRegisterError(error: unknown): { reason: "taken" | "invalid"; error: string } {
  const text = error instanceof Error ? error.message : String(error);
  return { reason: /recogni[sz]e|parse|invalid|unknown|not a valid|empty/i.test(text) ? "invalid" : "taken", error: text };
}

let registered: string | null = null;
let state: QuickCaptureState = { status: "off" };
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<(state: QuickCaptureState) => void>();

export const quickCaptureState = (): QuickCaptureState => state;
export function onQuickCaptureState(listener: (state: QuickCaptureState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function apply(config: QuickCaptureConfig, deps: QuickCaptureDeps): Promise<QuickCaptureState> {
  // Release first, always: a shortcut that stayed registered after it was
  // switched off or replaced would keep opening the window.
  if (registered !== null && (!config.enabled || registered !== config.shortcut)) {
    const old = registered;
    registered = null;
    await deps.unregister(old).catch(() => undefined);
  }
  if (!config.enabled) return { status: "off" };
  if (registered === config.shortcut) return { status: "on", shortcut: config.shortcut };
  try {
    if ((await deps.sessionKind().catch(() => "other" as const)) === "wayland") {
      return { status: "failed", shortcut: config.shortcut, reason: "wayland" };
    }
    await deps.register(config.shortcut, () => { void deps.open().catch(() => undefined); });
    registered = config.shortcut;
    return { status: "on", shortcut: config.shortcut };
  } catch (error) {
    return { status: "failed", shortcut: config.shortcut, ...classifyRegisterError(error) };
  }
}

/**
 * Brings the registration in line with the configuration. Calls are queued, so
 * a fast off-on or a second shortcut never races the first.
 */
export function syncQuickCapture(config: QuickCaptureConfig, deps: QuickCaptureDeps = tauriQuickCaptureDeps): Promise<QuickCaptureState> {
  const run = queue.then(() => apply(config, deps)).then((next) => {
    state = next;
    listeners.forEach((listener) => listener(next));
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function readQuickCaptureConfig(): Promise<QuickCaptureConfig> {
  const store = await getSettingsStore();
  const shortcut = await store.get<string>(QUICK_CAPTURE_SHORTCUT_KEY);
  return {
    enabled: (await store.get<boolean>(QUICK_CAPTURE_ENABLED_KEY)) === true,
    shortcut: typeof shortcut === "string" && shortcut.trim() ? shortcut : DEFAULT_QUICK_CAPTURE_SHORTCUT,
  };
}

/** Stores the configuration and applies it. A refused shortcut stays stored: the setting shows why it is not active. */
export async function saveQuickCaptureConfig(config: QuickCaptureConfig, deps: QuickCaptureDeps = tauriQuickCaptureDeps): Promise<QuickCaptureState> {
  const store = await getSettingsStore();
  await store.set(QUICK_CAPTURE_ENABLED_KEY, config.enabled);
  await store.set(QUICK_CAPTURE_SHORTCUT_KEY, config.shortcut);
  await store.save();
  return syncQuickCapture(config, deps);
}

/** On start of the central window: register what was switched on in an earlier session. */
export async function initQuickCapture(deps: QuickCaptureDeps = tauriQuickCaptureDeps): Promise<QuickCaptureState> {
  const config = await readQuickCaptureConfig();
  // Off is the default and the common case: do not even load the plugin then.
  if (!config.enabled) return state;
  return syncQuickCapture(config, deps);
}

/* -------------------------------------------------------------- the window */

/** Opens the capture window, or brings the one that is open to the front. */
export async function openCaptureWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(CAPTURE_WINDOW_LABEL).catch(() => null);
  if (existing) {
    await existing.unminimize().catch(() => undefined);
    await existing.setFocus().catch(() => undefined);
    return;
  }
  const query = new URLSearchParams({ win: "capture", label: CAPTURE_WINDOW_LABEL });
  new WebviewWindow(CAPTURE_WINDOW_LABEL, {
    url: `index.html?${query.toString()}`,
    title: i18n.t("quickCapture.windowTitle"),
    width: 540,
    // Room for the field, the chip and a refusal of two lines under it.
    height: 256,
    center: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focus: true,
  });
}

/* ---------------------------------------------------------------- the sink */

export type QuickCaptureResult = { ok: true } | { ok: false; message: string };
export type QuickCaptureSink = (input: { text: string; task: boolean }) => Promise<QuickCaptureResult>;

let sink: QuickCaptureSink | null = null;

/** The shell with an open vault takes the captures; without one there is nowhere to write. */
export function setQuickCaptureSink(next: QuickCaptureSink | null): () => void {
  sink = next;
  return () => { if (sink === next) sink = null; };
}

/** What the bus handler runs for a capture that came in from the capture window. */
export async function runQuickCapture(input: { text: string; task: boolean }): Promise<QuickCaptureResult> {
  if (!sink) return { ok: false, message: i18n.t("quickCapture.noVault") };
  return sink(input);
}

/** Test seam. */
export function resetQuickCaptureForTest(): void {
  registered = null;
  state = { status: "off" };
  queue = Promise.resolve();
  listeners.clear();
  sink = null;
}
