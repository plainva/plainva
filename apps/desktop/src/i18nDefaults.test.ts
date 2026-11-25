import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import i18n, { missingKey } from "@plainva/ui/i18n";
import { AVAILABLE_THEMES } from "@plainva/ui";

/**
 * A call with a default text shows that text when the key is in no locale file (review of L5, 2026-11-25).
 *
 * `i18n.ts` gives i18next a handler for missing keys, so that a key of an area still on its way reads as nothing
 * for that moment. i18next calls it for a call with a default text too, and hands the default as its second value;
 * the handler once passed over it, and `t("themes.names.win95", { defaultValue: "Windows 95" })` read as its key in
 * both shells' theme pickers. Here every call in the sources that carries a default text — dynamic keys with a probe
 * in place of each `${…}` — goes through the real i18n set-up.
 */
const ROOT = join(__dirname, "../../..");
const SOURCES = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/core/src"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const at = join(dir, name);
    if (statSync(at).isDirectory()) return name === "node_modules" || name === "locales" ? [] : files(at);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [at] : [];
  });
}

interface Call {
  where: string;
  key: string;
  form: "object" | "string";
}

/** `t("key", { …defaultValue… })` and `t("key", "default")`, keys as string or template literals. */
const CALL = /\bt\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*,\s*(\{[^{}]*?\bdefaultValue\b|`|'|")/g;

function calls(): Call[] {
  const found: Call[] = [];
  for (const dir of SOURCES) {
    for (const file of files(join(ROOT, dir))) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(CALL)) {
        const key = m[1]!.slice(1, -1).replace(/\$\{[^}]*\}/g, "zzProbe");
        if (key.includes("\n") || key.startsWith("zzProbe") || key.length === 0) continue;
        const line = source.slice(0, m.index).split("\n").length;
        found.push({ where: `${relative(ROOT, file)}:${line}`, key, form: m[2]!.startsWith("{") ? "object" : "string" });
      }
    }
  }
  return found;
}

describe("a call with a default text", () => {
  it("reads as its default when the key is missing, and as the text when it is there — every call in the sources", () => {
    expect.hasAssertions();
    const all = calls();
    expect(all.length, "the scan finds the calls with a default text").toBeGreaterThan(1000);
    expect(all.filter((c) => c.key.includes("zzProbe")).length, "dynamic keys among them").toBeGreaterThanOrEqual(50);
    const DEFAULT = "⟨default⟩";
    const wrong: string[] = [];
    for (const call of all) {
      const english = i18n.getFixedT("en");
      const read = call.form === "object" ? english(call.key, { defaultValue: DEFAULT }) : english(call.key, DEFAULT);
      const there = i18n.exists(call.key, { lng: "en" });
      if (there ? read === call.key || read === DEFAULT : read !== DEFAULT) wrong.push(`${call.where} ${call.key} → ${String(read)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("names every built-in theme in the pickers", () => {
    expect.hasAssertions();
    for (const lng of ["en", "de", "ja"]) {
      const t = i18n.getFixedT(lng);
      const labels = AVAILABLE_THEMES.map((d) => t(`themes.names.${d.id}`, { defaultValue: d.label }));
      expect(labels.filter((l) => l.startsWith("themes.names.")), lng).toEqual([]);
    }
  });

  it("a missing key without a default reads as the key", () => {
    expect.hasAssertions();
    expect(missingKey("palette.group.zzProbe")).toBe("palette.group.zzProbe");
    expect(missingKey("palette.group.zzProbe", "Fallback")).toBe("Fallback");
    expect(i18n.t("palette.group.zzProbe")).toBe("palette.group.zzProbe");
  });
});
