import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The main window's place, from start to quit (Sammelplan § 3.132 Nr. 2 and 3).
 *
 * Both rules live in the Rust shell and in the window configs, where no unit
 * test of the app reaches - and the native smoke only sees a window that
 * stands, not where it stood a moment before. So this reads the sources.
 *
 * - Nr. 2: a window config that creates the main window visible shows it at
 *   its configured place (centred, 1280 x 832) until `setup` has moved it to
 *   the remembered one - the window jumped on every start. Every config that
 *   names the main window creates it hidden, and `setup` shows it after the
 *   restore. Tauri merges a platform config's `windows` array as a whole, so
 *   each one has to say it.
 * - Nr. 3: "Quit" in the tray menu (`app.exit`) ends the process without a
 *   close request, and the place was only written on one: a move in the last
 *   half second before quitting was lost. The run loop writes it on
 *   `ExitRequested`.
 */
const TAURI = resolve(__dirname, "../src-tauri");
const read = (p: string) => readFileSync(p, "utf8");

describe("the main window from start to quit", () => {
  it("is created hidden by every window config", () => {
    const configs = readdirSync(TAURI).filter((name) => /^tauri.*\.conf\.json$/.test(name));
    const withWindows = configs.filter((name) => Array.isArray(JSON.parse(read(join(TAURI, name)))?.app?.windows));
    expect(withWindows).toContain("tauri.conf.json");
    for (const name of withWindows) {
      const windows = JSON.parse(read(join(TAURI, name))).app.windows as Array<Record<string, unknown>>;
      const main = windows.filter((w) => w.label === undefined || w.label === "main");
      expect(main.length, name).toBe(1);
      expect(main[0].visible, `${name}: the main window must start hidden`).toBe(false);
    }
  });

  it("is shown in setup once its place is restored", () => {
    const lib = read(join(TAURI, "src/lib.rs"));
    const setup = lib.slice(lib.indexOf(".setup(|app|"), lib.indexOf(".on_window_event("));
    const restore = setup.indexOf("window_state::restore(");
    const show = setup.indexOf("window_state::show_main(");
    expect(restore).toBeGreaterThan(-1);
    expect(show).toBeGreaterThan(restore);
  });

  it("writes its place when the app quits, not only when the window closes", () => {
    const lib = read(join(TAURI, "src/lib.rs"));
    const runLoop = lib.slice(lib.indexOf(".build(tauri::generate_context!())"));
    expect(runLoop).toMatch(/RunEvent::ExitRequested[\s\S]{0,200}window_state::flush\(/);
    const state = read(join(TAURI, "src/window_state.rs"));
    expect(state).toMatch(/WindowEvent::CloseRequested \{ \.\. \} => flush\(app\)/);
  });
});
