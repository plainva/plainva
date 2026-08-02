import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isDensity } from "./services/density";

/**
 * The touch density is what lets both shells build on the same primitives: a
 * control's size is a property of the INPUT, not of the component, so mobile
 * gets a third density instead of a parallel set of controls.
 *
 * These pin the two halves of "strictly additive": every value the touch block
 * changes must already exist as a default (otherwise a primitive would only be
 * sized on one shell), and the desktop must never be able to select it.
 */

const CSS = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/ui/src/styles/tokens.css");

function blockVars(source: string, selector: string): Map<string, string> {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  const body = source.slice(start, source.indexOf("\n}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-zA-Z0-9-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

describe("touch density", () => {
  const css = readFileSync(CSS, "utf8");
  const root = blockVars(css, ":root");
  const touch = blockVars(css, '[data-density="touch"]');
  const compact = blockVars(css, '[data-density="compact"]');

  it("only overrides tokens the default already defines", () => {
    // A token introduced by the touch block alone would leave the pointer
    // shells with an undefined variable wherever a primitive consumes it.
    for (const name of touch.keys()) {
      expect(root.has(name), `${name} has no default in :root`).toBe(true);
    }
  });

  it("actually opens the layout up rather than repeating the defaults", () => {
    for (const [name, value] of touch) {
      expect(value, `${name} repeats the default`).not.toBe(root.get(name));
    }
  });

  it("reaches the platform minimum for anything a finger hits", () => {
    // 44px (iOS HIG) / 48dp (Material). --control-md carries buttons, fields
    // and rows; below that a touch density would be one in name only.
    expect(touch.get("--control-md")).toBe("44px");
    expect(Number.parseInt(touch.get("--control-lg") ?? "0", 10)).toBeGreaterThanOrEqual(44);
  });

  it("kept every default exactly where the hard-coded pixels were", () => {
    // The metrics below used to be literals inside ui.css. Turning them into
    // tokens must not move the desktop by a single pixel — one of them (the
    // tick box) was written down wrong on the first attempt and would have
    // grown every checkbox in the app from 16 to 18px.
    const before: Record<string, string> = {
      "--chip-h": "22px",
      "--chip-pad-x": "10px",
      "--chip-x-size": "16px",
      "--tick-size": "16px",
      "--switch-w": "34px",
      "--switch-h": "18px",
      "--switch-knob-size": "14px",
      "--fab-size": "52px",
    };
    for (const [name, value] of Object.entries(before)) {
      expect(root.get(name), name).toBe(value);
    }
  });

  it("keeps the pointer densities free of touch sizes", () => {
    // The desktop is public and auto-updating: every change here has to be
    // invisible to it. Compact must stay the tightest of the three.
    expect(Number.parseInt(compact.get("--control-md") ?? "0", 10)).toBeLessThan(
      Number.parseInt(root.get("--control-md") ?? "0", 10),
    );
  });

  it("cannot be selected by the desktop", () => {
    expect(isDensity("touch")).toBe(false);
    expect(isDensity("comfortable")).toBe(true);
    expect(isDensity("compact")).toBe(true);
  });
});
