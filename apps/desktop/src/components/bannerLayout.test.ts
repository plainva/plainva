import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * The Banner primitive's layout contract (TestFlight feedback Build 91, P1).
 *
 * Icon, text and actions sit in one flex row. With two full-size buttons in
 * `actions` at 375 pt the text column shrank to ~45 px and — because it may
 * wrap anywhere — broke letter by letter; the conflict card on the phone was
 * unreadable. jsdom does not lay out, so the rules themselves are pinned:
 * the row wraps, the text keeps a floor, the actions wrap too.
 */
describe("Banner layout rules", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../packages/ui/src/styles/ui.css"), "utf8");
  const block = (selector: string) => {
    const m = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1].replace(/\/\*[\s\S]*?\*\//g, "");
  };

  it("the banner row wraps", () => {
    expect(block(".pv-banner")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("the message keeps a floor instead of shrinking to letters", () => {
    expect(block(".pv-banner-msg")).toMatch(/flex:\s*1 1 12rem/);
  });

  it("the actions wrap among themselves", () => {
    expect(block(".pv-banner-actions")).toMatch(/flex-wrap:\s*wrap/);
  });
});
