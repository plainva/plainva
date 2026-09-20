import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWindowParams } from "./windowContext";
import { CAPTURE_WINDOW_LABEL } from "./quickCapture";

/**
 * The quick-capture window of the global shortcut (plan Journal, J7).
 *
 * Like the full second window, what has to hold for it fails SILENTLY when it
 * does not (see fullWindow.test.ts):
 *
 * 1. `?win=capture` parses as a client. Unrecognised, it would fall back to
 *    owner — and a tiny always-on-top window would boot a second set of
 *    background services on the same vault.
 * 2. Tauri assigns capabilities by window LABEL. The label the central window
 *    opens has to match the capture capability, or the window is dead.
 * 3. That capability stays what its description says: a window that holds a
 *    text. No filesystem, no SQL, no HTTP, no dialogs, no window creation — and
 *    the system-wide shortcut itself can be touched by the central window only.
 */
const CAPS = join(dirname(fileURLToPath(import.meta.url)), "../../src-tauri/capabilities");
const read = (file: string) => JSON.parse(readFileSync(join(CAPS, file), "utf8")) as { windows: string[]; permissions: Array<string | { identifier: string }> };
const ids = (cap: { permissions: Array<string | { identifier: string }> }) => cap.permissions.map((p) => (typeof p === "string" ? p : p.identifier));
const matches = (pattern: string, label: string) => (pattern.endsWith("*") ? label.startsWith(pattern.slice(0, -1)) : pattern === label);

describe("quick-capture window", () => {
  it("parses ?win=capture as a client window that belongs to no vault", () => {
    const p = parseWindowParams(`?win=capture&label=${CAPTURE_WINDOW_LABEL}`);
    expect(p).toMatchObject({ role: "capture", vaultPath: null, content: null, label: CAPTURE_WINDOW_LABEL });
  });

  it("is covered by exactly one capability, by label", () => {
    const covering = readdirSync(CAPS).filter((file) => file.endsWith(".json")).filter((file) => read(file).windows.some((w) => matches(w, CAPTURE_WINDOW_LABEL)));
    expect(covering).toEqual(["capture-window.json"]);
  });

  it("may read its look, close, focus and move itself — and nothing else", () => {
    expect(ids(read("capture-window.json")).sort()).toEqual([
      "core:default",
      "core:window:allow-close",
      "core:window:allow-set-focus",
      "core:window:allow-start-dragging",
      "store:default",
    ]);
  });

  it("leaves the system-wide shortcut to the central window", () => {
    for (const file of readdirSync(CAPS).filter((name) => name.endsWith(".json"))) {
      const cap = read(file);
      if (!ids(cap).some((id) => id.startsWith("global-shortcut:"))) continue;
      expect(cap.windows, `${file} grants global-shortcut permissions`).toEqual(["main"]);
    }
    expect(ids(read("global-quick-capture.json")).sort()).toEqual([
      "global-shortcut:allow-is-registered",
      "global-shortcut:allow-register",
      "global-shortcut:allow-unregister",
    ]);
  });
});
