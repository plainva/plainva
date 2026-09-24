import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHORTCUT_CATEGORIES } from "./shortcutCatalog";

// Drift guard for the shortcuts help window (F1): every i18n key the catalog
// references must resolve to a non-empty string in the curated locales, so the
// window never shows a raw key or an empty cell. The full 10-language parity is
// enforced separately by localeParity.test.ts.

const SRC = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(SRC, "../../../../packages/ui/src/locales");

function loadLocale(code: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), "utf8"));
}
function resolve(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Every i18n key the catalog references, deduplicated. */
function catalogKeys(): string[] {
  const keys = new Set<string>();
  for (const cat of SHORTCUT_CATEGORIES) {
    keys.add(cat.labelKey);
    for (const r of cat.keyboard) { keys.add(r.descKey); if (r.noteKey) keys.add(r.noteKey); }
    for (const r of cat.mouse) { keys.add(r.descKey); keys.add(r.gestureKey); if (r.noteKey) keys.add(r.noteKey); }
  }
  return [...keys];
}

const MODIFIERS = ["Mod", "Alt", "Shift"];

/**
 * The chords a combo is made of, spelled one way: "Ctrl" counts as "Mod" (on
 * Windows and Linux it is the same key), letters are compared case-blind. Only
 * chords that act wherever the focus is — with Mod, Ctrl or Alt, or on a
 * function key. A plain key (Enter, the arrows, Del, a typed `[[`) belongs to
 * the surface that has the focus, and reusing it there is the point: Enter
 * opens a graph node, commits a table cell and opens a message.
 */
function chordsOf(combo: string[]): string[] {
  const mods = new Set(combo.map((t) => (t === "Ctrl" ? "Mod" : t)).filter((t) => MODIFIERS.includes(t)));
  const acts = mods.has("Mod") || mods.has("Alt");
  return combo
    .filter((t) => t !== "Ctrl" && !MODIFIERS.includes(t))
    .filter((key) => acts || /^F\d+$/.test(key))
    .map((key) => [...MODIFIERS.filter((m) => mods.has(m)), key.toUpperCase()].join("+"));
}

/** Chord → the actions (descKeys) the catalog binds to it. */
function chordOwners(): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const cat of SHORTCUT_CATEGORIES) {
    for (const row of cat.keyboard) {
      for (const chord of row.keys.flatMap(chordsOf)) {
        owners.set(chord, (owners.get(chord) ?? new Set<string>()).add(row.descKey));
      }
    }
  }
  return owners;
}

describe("shortcutCatalog", () => {
  it("has unique category ids", () => {
    const ids = SHORTCUT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every category holds at least one row", () => {
    for (const c of SHORTCUT_CATEGORIES) {
      expect(c.keyboard.length + c.mouse.length, `category ${c.id} is empty`).toBeGreaterThan(0);
    }
  });

  // One key, one action. The same row may stand under a second category — the
  // Graph chip lists how to open the graph, like View does — but one chord for
  // two actions means one of the rows is wrong: Mod+P once stood beside "Open
  // communications window", which Mod+P does not do.
  it("binds every key combination to one action", () => {
    const owners = chordOwners();
    // Not vacuous: the chords are read, and a cross-listed row counts once.
    expect([...(owners.get("Mod+Shift+J") ?? [])]).toEqual(["journal.newEntry"]);
    expect([...(owners.get("Mod+Shift+G") ?? [])]).toEqual(["graph.open"]);
    const shared = [...owners]
      .filter(([, actions]) => actions.size > 1)
      .map(([chord, actions]) => `${chord}: ${[...actions].join(", ")}`);
    expect(shared).toEqual([]);
  });

  it("explains every row that has no key of its own", () => {
    const unexplained = SHORTCUT_CATEGORIES.flatMap((c) => c.keyboard)
      .filter((row) => row.keys.length === 0 && !row.noteKey)
      .map((row) => row.descKey);
    expect(unexplained).toEqual([]);
  });

  it.each(["en", "de"])("resolves every referenced i18n key in %s", (code) => {
    const locale = loadLocale(code);
    const missing = catalogKeys().filter((k) => {
      const v = resolve(locale, k);
      return typeof v !== "string" || v.length === 0;
    });
    expect(missing, `missing/empty keys in ${code}.json`).toEqual([]);
  });
});
