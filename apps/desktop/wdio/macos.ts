import { execFileSync } from "node:child_process";

/**
 * Real input on macOS for the native smoke (WebDriver_Smoke.md, "macOS").
 *
 * The embedded WebDriver server drives WKWebView with SYNTHETIC events: its
 * click calls `el.click()` and then `el.focus()`, its keys are
 * `new KeyboardEvent(…)` handed to `dispatchEvent`. That proves what the page
 * does with an event, not that the event arrives — issue #123 (a clicked button
 * gets no focus in WebKit on macOS) would have passed through it unseen, and a
 * system-wide shortcut is no event in the page at all.
 *
 * What is real here goes through the system: a mouse click posted as a
 * CoreGraphics HID event (JavaScript for Automation, `osascript -l JavaScript`),
 * keys through System Events. Both are built into macOS — nothing to install.
 * On GitHub's macOS runners `/usr/bin/osascript` is granted Accessibility and
 * Apple Events to System Events in the runner image; if a new image takes that
 * away, the call fails with the system's own words ("not allowed assistive
 * access", "not authorized to send Apple events"), and `osa` puts them in the
 * error so the job log says so.
 */

export const APP_ID = "com.plainva.desktop";

/** Runs an AppleScript (or JXA) and returns its output; the system's refusal stays in the error. */
export function osa(script: string, language: "AppleScript" | "JavaScript" = "AppleScript"): string {
  const args = language === "JavaScript" ? ["-l", "JavaScript", "-e", script] : ["-e", script];
  try {
    return execFileSync("/usr/bin/osascript", args, { encoding: "utf8", timeout: 30_000 }).trim();
  } catch (error) {
    const e = error as { stderr?: string | Buffer; message?: string };
    const stderr = typeof e.stderr === "string" ? e.stderr : e.stderr?.toString("utf8") ?? "";
    throw new Error(
      `osascript failed (${language}): ${stderr.trim() || e.message}\n` +
        "If this says 'not allowed assistive access' or 'not authorized to send Apple events', the runner image " +
        "no longer grants osascript the Accessibility / Automation rights the macOS smoke relies on " +
        "(see docs/engineering/WebDriver_Smoke.md, \"macOS\"; the fallback would be Appium Mac2, a new dependency decision).",
      { cause: error },
    );
  }
}

const app = `(first application process whose bundle identifier is "${APP_ID}")`;

/** Brings Plainva to the front, the way a click into its window would. */
export function activatePlainva(): void {
  osa(`tell application "System Events" to set frontmost of ${app} to true`);
}

/** Brings the Finder to the front: Plainva is then in the background, as for a system-wide shortcut. */
export function activateFinder(): void {
  osa(`tell application "System Events" to set frontmost of process "Finder" to true`);
}

/** The name of the application process in front. */
export function frontmostProcess(): string {
  return osa(`tell application "System Events" to get name of first application process whose frontmost is true`);
}

/** Position and size of Plainva's front window, in screen points. */
export function frontWindowFrame(): { x: number; y: number; width: number; height: number } {
  const out = osa(
    `tell application "System Events" to tell ${app}\n` +
      `  set p to position of window 1\n` +
      `  set s to size of window 1\n` +
      `  return ((item 1 of p) as text) & "," & ((item 2 of p) as text) & "," & ((item 1 of s) as text) & "," & ((item 2 of s) as text)\n` +
      `end tell`,
  );
  const [x, y, width, height] = out.split(",").map((v) => Number(v.trim()));
  if (![x, y, width, height].every((v) => Number.isFinite(v))) throw new Error(`unexpected window frame from System Events: "${out}"`);
  return { x: x!, y: y!, width: width!, height: height! };
}

/**
 * A real left click at a screen point: mouse moved, pressed and released as
 * HID events — what a person's click is, focus rules of WebKit included.
 */
export function clickAt(x: number, y: number): void {
  // kCGEventMouseMoved 5, kCGEventLeftMouseDown 1, kCGEventLeftMouseUp 2,
  // kCGMouseButtonLeft 0, kCGHIDEventTap 0 — numbers, because JXA does not
  // bridge every CoreGraphics constant.
  osa(
    `ObjC.import("CoreGraphics");\n` +
      `const p = { x: ${x}, y: ${y} };\n` +
      `for (const type of [5, 1, 2]) {\n` +
      `  const e = $.CGEventCreateMouseEvent(null, type, p, 0);\n` +
      `  $.CGEventPost(0, e);\n` +
      `  delay(0.08);\n` +
      `}\n` +
      `"clicked"`,
    "JavaScript",
  );
}

/** A real key press with modifiers, sent through System Events to the app in front. */
export function keystroke(key: string, modifiers: Array<"command" | "control" | "option" | "shift">): void {
  const using = modifiers.length ? ` using {${modifiers.map((m) => `${m} down`).join(", ")}}` : "";
  osa(`tell application "System Events" to keystroke "${key}"${using}`);
}

/** A real key by its virtual key code (125 is the down arrow), with modifiers. */
export function keyCode(code: number, modifiers: Array<"command" | "control" | "option" | "shift"> = []): void {
  const using = modifiers.length ? ` using {${modifiers.map((m) => `${m} down`).join(", ")}}` : "";
  osa(`tell application "System Events" to key code ${code}${using}`);
}

/** Real typing: the characters as key presses, through System Events, to the app in front. */
export function typeText(text: string): void {
  const quoted = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  osa(`tell application "System Events" to keystroke "${quoted}"`);
}

/**
 * A real Return key, to the app in front. A synthetic Enter reaches a field's
 * key handlers but never submits its form: implicit submission belongs to
 * trusted events only.
 */
export function pressReturn(): void {
  osa(`tell application "System Events" to key code 36`);
}

/** `defaults read <domain> <key>`, or null when the key is not set. */
export function readDefault(key: string): string | null {
  try {
    return execFileSync("/usr/bin/defaults", ["read", APP_ID, key], { encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}
