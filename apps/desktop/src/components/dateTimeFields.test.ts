import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/**
 * Date and time fields keep their value in the middle of their height
 * (TestFlight 2026-11-02, iPhone: the time sat at the top of the field).
 *
 * WebKit draws the value in a box of its own, as tall as its text and at the
 * top of the field. jsdom does not lay out and Chromium cannot read the
 * WebKit pseudo-elements, so the rules themselves are pinned here, and so is
 * the reach: every date or time field of both shells is a `.pv-field`, the
 * class the rules hang on.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const css = readFileSync(join(ROOT, "packages/ui/src/styles/ui.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const block = (selector: string) => {
  const m = css.match(new RegExp(`(?:^|\\n|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
};

describe("date and time fields", () => {
  it("the value box takes the field's height and centres its text", () => {
    for (const pseudo of ["::-webkit-date-and-time-value", "::-webkit-datetime-edit"]) {
      const rule = block(`.pv-field${pseudo}`);
      expect(rule).toMatch(/display:\s*flex/);
      expect(rule).toMatch(/align-items:\s*center/);
      expect(rule).toMatch(/height:\s*100%/);
    }
    expect(block(".pv-field::-webkit-date-and-time-value")).toMatch(/margin-block:\s*0/);
    expect(block(".pv-field::-webkit-datetime-edit")).toMatch(/padding-block:\s*0/);
  });

  it("the field itself stays a block (as a flex box, Chromium pulls the picker icon to the value)", () => {
    expect(css).not.toMatch(/\.pv-field:is\(\[type="(?:date|time)"/);
    expect(block(".pv-field")).toMatch(/display:\s*block/);
  });

  it("each WebKit pseudo-element has a rule of its own (an unknown one drops the whole rule)", () => {
    const rules = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    for (const selector of rules.filter((s) => s.includes("::-webkit-date"))) {
      expect(selector.split(",")).toHaveLength(1);
    }
  });

  it("every date and time field of both shells is a .pv-field", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (name === "node_modules" || name === "dist") continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
          const text = readFileSync(full, "utf8");
          for (const m of text.matchAll(/type="(?:date|time|datetime-local|month|week)"/g)) {
            const open = text.lastIndexOf("<", m.index);
            // Fields are self-closing; an arrow function inside would end the tag at its ">".
            const tag = text.slice(open, text.indexOf("/>", m.index) + 2);
            if (tag.startsWith("<TextInput") || /className="[^"]*\bpv-field\b/.test(tag)) continue;
            offenders.push(`${full.slice(ROOT.length + 1)}: ${tag.slice(0, 60)}`);
          }
        }
      }
    };
    for (const dir of ["packages/ui/src", "apps/desktop/src", "apps/mobile/src"]) walk(join(ROOT, dir));
    expect(offenders).toEqual([]);
  });
});
