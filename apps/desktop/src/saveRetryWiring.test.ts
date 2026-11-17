import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The editor's part of the save retry (decided 2026-11-17). The timer's own
 * rules are tested in `services/saveRetryTimer.test.ts`; the editor has no
 * render harness, so this holds the four places it hangs on: a failed save
 * plans a try, a save asked for now (Ctrl+S, the way out of the app, a step
 * that needs the note on disk) goes at once, and a pane that shows another
 * note or goes leaves no try behind.
 */

const editor = readFileSync(fileURLToPath(new URL("./components/Editor.tsx", import.meta.url)), "utf8");

/** The text between `from` and the next `until`. */
function between(from: string, until: string): string {
  const start = editor.indexOf(from);
  expect(start, `missing: ${from}`).toBeGreaterThanOrEqual(0);
  const end = editor.indexOf(until, start + from.length);
  return editor.slice(start, end < 0 ? undefined : end);
}

describe("the desktop editor tries a failed save again", () => {
  it("plans a try where a failed save sets its message, reading the pane's text when it comes", () => {
    const failure = between("setSaveError(e.message || String(error));", "throw error;");
    expect(failure).toMatch(/saveRetry\.failed\(\s*error,/);
    expect(failure).toMatch(/loadedPathRef\.current === path/);
    expect(failure).toMatch(/sessionRef\.current\?\.view\.state\.doc\.toString\(\)/);
  });

  it("lets a save that starts take the planned try's place, and resets after one went through", () => {
    expect(editor).toMatch(/setSaveError\(null\); \}\n\s*\/\/[^\n]*\n\s*if \(current\(\)\) saveRetry\.starting\(\);/);
    expect(editor).toMatch(/keep: keepTextBeside,\n\s*\}\);\n\s*\/\/[^\n]*\n\s*if \(current\(\)\) saveRetry\.reset\(\);/);
  });

  it("tries at once, not behind the timer, when a save is asked for now", () => {
    expect(between("const handleFlushRequest", "await persistText(")).toMatch(/saveRetry\.reset\(\);/);
  });

  it("starts at one second again when the person types", () => {
    expect(between("const scheduleSave = ", "saveTimeoutRef.current = window.setTimeout")).toMatch(/saveRetry\.reset\(\);/);
  });

  it("leaves no try behind when the pane shows another note, or goes", () => {
    expect(between("// The pane shows another note, or goes", "void persistText(text)")).toMatch(/saveRetry\.cancel\(\);/);
    expect(between("saveState.activate();", "}, [saveState, saveRetry]);")).toMatch(/saveRetry\.cancel\(\);\s*saveState\.deactivate\(\);/);
    expect(between("const captureTabDocument", "for (const timer of [saveTimeoutRef")).toMatch(/saveRetry\.cancel\(\);/);
  });
});
