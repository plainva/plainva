import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Design-language ratchet (plan Designsprache 2026-07-05, P1).
 *
 * Scans component sources for patterns the design language forbids in NEW
 * code: raw border-radius pixel literals (use var(--radius-*)), hardcoded
 * hex/rgba colors (use tokens from styles/tokens.css / App.css), and
 * hand-rolled position:fixed overlays (use the ui/ primitives once they
 * exist, P2). BUDGET freezes today's counts per file — the suite fails when a
 * file EXCEEDS its budget (regression) and when a fully cleaned file still
 * has an entry (stale budget). Partial reductions are allowed without
 * touching the map, but each sweep package (P4-P8) is expected to lower its
 * files' entries. Details: docs/engineering/Design_Language.md.
 *
 * Deliberately NOT scanned: styles/tokens.css and themes/*.css (token
 * definitions are made of literals), *.test.* files, and src/components/ui/
 * (the primitives own the canonical overlay/shadow implementations).
 * Note: the hex rule can match non-color uses (e.g. "#anchor" fragments);
 * such matches are frozen in the budget like any other — only increases fail.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
// Desktop components + the extracted shared editor layer (ADR 0011); budget
// keys keep their original "components/..." form across both roots. The
// shared .base layer (R4) scans under its own "base/..." prefix.
const COMPONENT_ROOTS: Array<{ dir: string; prefix: string }> = [
  { dir: join(SRC, "components"), prefix: "components/" },
  { dir: join(SRC, "../../../packages/ui/src/components"), prefix: "components/" },
  { dir: join(SRC, "../../../packages/ui/src/base"), prefix: "base/" },
];

const RULES: Record<string, RegExp> = {
  radiusPx: /border-?[rR]adius:\s*["'`]?\d/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  rgba: /rgba?\(/g,
  fixedOverlay: /position:\s*["']fixed["']/g,
};

type Counts = Partial<Record<keyof typeof RULES, number>>;

/** Frozen state as of 2026-07-05 (generated from the tree). Lower or remove
 * entries as files are migrated; never raise one. */
const BUDGET: Record<string, Counts> = {
  "components/base/BaseCalendarView.tsx": { rgba: 1 },
  "components/base/NewItemButton.tsx": { fixedOverlay: 1 },
  "components/base/useCardPointerDrag.ts": { fixedOverlay: 1 },
  "components/BasePicker.tsx": { rgba: 1, fixedOverlay: 1 },
  "components/BaseViewer.tsx": { rgba: 1, fixedOverlay: 1 },
  "components/blockHandles.ts": { radiusPx: 1 },
  "components/BlockMenu.tsx": { fixedOverlay: 1 },
  "components/CalendarWidget.tsx": { radiusPx: 1 },
  "components/callouts.ts": { hex: 8 },
  "components/DatePicker.tsx": { fixedOverlay: 1 },
  "components/Editor.tsx": { radiusPx: 3, rgba: 4, fixedOverlay: 1 },
  "components/EmojiPicker.tsx": { radiusPx: 2, hex: 1, rgba: 1, fixedOverlay: 2 },
  "components/FileTree.tsx": { radiusPx: 6 },
  "components/HeaderColorPicker.tsx": { hex: 2, fixedOverlay: 2 },
  "components/ImagePreviewPlugin.ts": { rgba: 1 },
  "components/ImageViewer.tsx": { hex: 3, rgba: 1 },
  "components/MarkdownTheme.ts": { radiusPx: 2 },
  "base/propertyModel.ts": { hex: 8 },
  "components/Select.tsx": { fixedOverlay: 1 },
  "components/SelectionToolbar.tsx": { fixedOverlay: 1 },
  "components/SettingsModal.tsx": { radiusPx: 1, rgba: 1, fixedOverlay: 1 },
  "components/TableSizePicker.tsx": { fixedOverlay: 1 },
  "components/ThemePickerCards.tsx": { radiusPx: 6, rgba: 2 },
  "components/WindowControls.tsx": { hex: 2 },
  "App.css": { radiusPx: 4 },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // ui/ primitives own the canonical implementations — not ratcheted.
      if (name === "ui") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && name !== "palette.ts") {
      // palette.ts is a token SOURCE (accent hex values written into user
      // frontmatter — data, not styling), excluded like styles/tokens.css.
      out.push(p);
    }
  }
  return out;
}

function countFile(source: string): Counts {
  const counts: Counts = {};
  for (const [rule, re] of Object.entries(RULES)) {
    const n = (source.match(re) || []).length;
    if (n > 0) counts[rule as keyof typeof RULES] = n;
  }
  return counts;
}

function scan(): Record<string, Counts> {
  const actual: Record<string, Counts> = {};
  for (const root of COMPONENT_ROOTS) {
    for (const file of walk(root.dir)) {
      const rel = root.prefix + relative(root.dir, file).replace(/\\/g, "/");
      const counts = countFile(readFileSync(file, "utf8"));
      if (Object.keys(counts).length) actual[rel] = counts;
    }
  }
  const appCss = readFileSync(join(SRC, "App.css"), "utf8");
  const cssRadius = (appCss.match(/border-radius:\s*\d/g) || []).length;
  if (cssRadius) actual["App.css"] = { radiusPx: cssRadius };
  return actual;
}

describe("design language ratchet", () => {
  const actual = scan();

  it("no file exceeds its frozen budget (use tokens/primitives instead)", () => {
    const regressions: string[] = [];
    for (const [file, counts] of Object.entries(actual)) {
      for (const [rule, n] of Object.entries(counts)) {
        const allowed = BUDGET[file]?.[rule as keyof typeof RULES] ?? 0;
        if ((n ?? 0) > allowed) {
          regressions.push(`${file}: ${rule} ${n} > budget ${allowed}`);
        }
      }
    }
    expect(regressions, regressions.join("\n")).toEqual([]);
  });

  it("fully cleaned files are removed from the budget (keep the map honest)", () => {
    const stale = Object.keys(BUDGET).filter((file) => !actual[file]);
    expect(stale, `remove stale budget entries: ${stale.join(", ")}`).toEqual([]);
  });
});
