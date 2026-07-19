import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Design-language ratchet 2.0 (design sweep 2026-07-19; v1: plan Designsprache
 * 2026-07-05, P1).
 *
 * Scans component sources for patterns the design language forbids: raw
 * border-radius pixel literals (use var(--radius-*); 50%-circles are exempt),
 * hardcoded hex/rgba colors, hand-rolled position:fixed overlays, raw px/rem
 * font sizes (use var(--text-*); content-relative em values are exempt), raw
 * z-index numbers (use var(--z-*)), literal box-shadow color recipes (use
 * var(--shadow-*)), literal transition/animation durations (use var(--dur-*)),
 * native title= tooltips (use data-tip), the retired legacy class families,
 * onMouseOver/onMouseOut style-mutation hover, and raw lucide size={N}
 * literals (use the shared ICON.* roles).
 *
 * BUDGET freezes the remaining debt per file — the suite fails when a file
 * EXCEEDS its budget (regression) and when a fully cleaned file still has an
 * entry (stale budget). The sweep packages (P2-P8) drive every entry to zero;
 * after that the map stays EMPTY — any raw value in ANY file (including new
 * ones) breaks pre-commit/pre-push/CI immediately. New entries require a
 * review-visible justification comment. Details:
 * docs/engineering/Design_Language.md.
 *
 * Deliberately NOT scanned: styles/tokens.css, base-colors.css and themes/*.css
 * (token definitions are made of literals), *.test.* files, and
 * src/components/ui/ (the primitives own the canonical implementations).
 * Note: the hex rule can match non-color uses (e.g. "#anchor" fragments);
 * such matches are budgeted like any other — only increases fail.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
// Desktop components + shell roots (App.tsx/main.tsx/services were a scan gap
// in v1) + the extracted shared editor layer (ADR 0011); budget keys keep
// their original "components/..." form across both roots. The shared .base
// layer scans under "base/...", shell roots under "src/...".
const COMPONENT_ROOTS: Array<{ dir: string; prefix: string }> = [
  { dir: join(SRC, "components"), prefix: "components/" },
  { dir: join(SRC, "services"), prefix: "services/" },
  { dir: join(SRC, "../../../packages/ui/src/components"), prefix: "components/" },
  { dir: join(SRC, "../../../packages/ui/src/base"), prefix: "base/" },
];
/** Shell root files scanned individually (walk would pull in tests/config). */
const ROOT_FILES = ["App.tsx", "main.tsx"];

const RULES: Record<string, RegExp> = {
  // 50%/percentage circles are legitimate geometry — exempted via lookahead.
  radiusPx: /border-?[rR]adius:\s*["'`]?\d+(?!\d*%)/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  rgba: /rgba?\(/g,
  fixedOverlay: /position:\s*["']fixed["']/g,
  // Chrome font sizes come from the type scale; em values (content-relative
  // typography in the reader/editor) are exempt.
  fontSizeRaw: /font-?[sS]ize:\s*["'`]?\d+(?:\.\d+)?(?:px|rem)/g,
  fontSizeBare: /fontSize:\s*\d/g,
  zIndexRaw: /z-?[iI]ndex:\s*["'`]?\d/g,
  // Literal shadow recipes carrying their own color — token shadows adapt to
  // dark mode / black themes, literals do not.
  shadowRaw: /box-?[sS]hadow:[^;\n]*(?:rgba\(|#[0-9a-fA-F]{3})/g,
  durationRaw: /(?:transition|animation)[^;\n]*?\d+(?:\.\d+)?m?s\b/g,
  titleAttr: /\stitle=(?:\{|")/g,
  legacyClass: /pv-btn-primary|pv-btn-secondary|pv-icon-btn\b|pv-modal-card|pv-modal-overlay|pv-modal-head\b|pv-modal-title\b|pv-input\b|pv-date-display|pv-select-trigger\b|pv-add-btn/g,
  jsHover: /onMouseOver=\{|onMouseOut=\{/g,
  iconLiteral: /\bsize=\{\d+\}/g,
};

type Counts = Partial<Record<keyof typeof RULES, number>>;

/** Frozen remaining debt (initialized 2026-07-19 from the tree; the sweep
 * packages P2-P8 drive this to EMPTY). Lower or remove entries as files are
 * migrated; never raise one; new entries need a justification comment. */
const BUDGET: Record<string, Counts> = {
  "App.css": {radiusPx:1,rgba:4,fontSizeRaw:16,durationRaw:3,legacyClass:21},
  "base/propertyModel.ts": {hex:8},
  "components/AppRibbon.tsx": {iconLiteral:10},
  "components/BacklinksPanel.tsx": {fontSizeRaw:8,titleAttr:1,iconLiteral:2},
  "components/base/BaseBoardView.tsx": {fontSizeRaw:4,titleAttr:1,iconLiteral:2},
  "components/base/BaseCalendarView.tsx": {rgba:1,fontSizeRaw:5,shadowRaw:1,titleAttr:3,iconLiteral:2},
  "components/base/BaseConfigPanel.tsx": {fontSizeRaw:2,titleAttr:27,iconLiteral:26},
  "components/base/BaseCreateWizard.tsx": {fontSizeRaw:7,titleAttr:4,legacyClass:4,iconLiteral:5},
  "components/base/BaseGalleryView.tsx": {fontSizeRaw:4},
  "components/base/BaseGraphView.tsx": {iconLiteral:1},
  "components/base/BaseListView.tsx": {fontSizeRaw:3},
  "components/base/BasePinboardView.tsx": {titleAttr:4,iconLiteral:11},
  "components/base/BaseTableView.tsx": {fontSizeRaw:1,zIndexRaw:1,titleAttr:6,iconLiteral:7},
  "components/base/BaseTimelineView.tsx": {fontSizeRaw:7,titleAttr:4,iconLiteral:2},
  "components/base/baseViewerShared.tsx": {fontSizeRaw:1,zIndexRaw:3,titleAttr:1,iconLiteral:8},
  "components/base/BaseViewTabs.tsx": {titleAttr:3,iconLiteral:2},
  "components/base/NewItemButton.tsx": {fixedOverlay:1,fontSizeRaw:5,titleAttr:6,legacyClass:10,iconLiteral:9},
  "components/base/SourceConditionEditor.tsx": {fontSizeRaw:2,titleAttr:2,iconLiteral:2},
  "components/base/useBaseCells.tsx": {titleAttr:1,iconLiteral:1},
  "components/base/useCardPointerDrag.ts": {fixedOverlay:1,zIndexRaw:1},
  "components/BaseInlineEditors.tsx": {fontSizeRaw:3,titleAttr:1,iconLiteral:3},
  "components/BasePeekModal.tsx": {titleAttr:1},
  "components/BasePicker.tsx": {rgba:1,fixedOverlay:1,fontSizeRaw:2,zIndexRaw:1,shadowRaw:1,iconLiteral:2},
  "components/BaseViewer.tsx": {rgba:1,fixedOverlay:1,fontSizeRaw:2,shadowRaw:1,durationRaw:2,titleAttr:5,legacyClass:6,iconLiteral:9},
  "components/blockHandles.ts": {radiusPx:1,zIndexRaw:2},
  "components/BlockMenu.tsx": {fixedOverlay:1,fontSizeRaw:2},
  "components/BookmarksList.tsx": {fontSizeRaw:1,titleAttr:1,iconLiteral:4},
  "components/CalendarWidget.tsx": {fontSizeRaw:8,zIndexRaw:1,titleAttr:8,iconLiteral:9},
  "components/callouts.ts": {hex:8},
  "components/CodeBlock.tsx": {titleAttr:1,iconLiteral:2},
  "components/ColumnSchemaEditor.tsx": {fontSizeRaw:1,titleAttr:3,legacyClass:8,iconLiteral:8},
  "components/CommandPalette.tsx": {iconLiteral:1},
  "components/CompatibilityWarningDialog.tsx": {iconLiteral:1},
  "components/ConflictResolveModal.tsx": {fontSizeRaw:2},
  "components/ContextMenuHost.tsx": {iconLiteral:4},
  "components/DatabasesList.tsx": {fontSizeRaw:2,titleAttr:2,iconLiteral:1},
  "components/DatabaseSourceConfig.tsx": {fontSizeRaw:4,iconLiteral:1},
  "components/DatePicker.tsx": {fixedOverlay:1,fontSizeRaw:4,iconLiteral:2},
  "components/DeletedFilesModal.tsx": {titleAttr:1,iconLiteral:2},
  "components/DocumentHeaderRead.tsx": {iconLiteral:1},
  "components/Editor.tsx": {fixedOverlay:1,fontSizeRaw:5,zIndexRaw:1,titleAttr:8,iconLiteral:22},
  "components/EmojiPicker.tsx": {hex:1,rgba:1,fixedOverlay:2,fontSizeRaw:7,zIndexRaw:1,shadowRaw:1,titleAttr:5,iconLiteral:1},
  "components/ErrorBoundary.tsx": {fontSizeRaw:1},
  "components/FileTree.tsx": {fontSizeRaw:6,iconLiteral:38},
  "components/graph/CleanupPanel.tsx": {iconLiteral:1},
  "components/graph/GraphContextSection.tsx": {titleAttr:1,iconLiteral:3},
  "components/graph/GraphMapMenus.tsx": {iconLiteral:16},
  "components/graph/PinModeToggle.tsx": {zIndexRaw:1,iconLiteral:2},
  "components/graph/VaultGraphView.tsx": {zIndexRaw:1,iconLiteral:9},
  "components/HailingFrequenciesModal.tsx": {fontSizeRaw:7,durationRaw:1,titleAttr:2,legacyClass:7,iconLiteral:2},
  "components/HeaderColorPicker.tsx": {hex:1,fixedOverlay:2,fontSizeRaw:1,zIndexRaw:1,titleAttr:1,iconLiteral:1},
  "components/ImagePreviewPlugin.ts": {rgba:1},
  "components/ImageViewer.tsx": {hex:3,rgba:1,fontSizeRaw:3,shadowRaw:1,titleAttr:16,legacyClass:19,iconLiteral:18},
  "components/mail/ComposeEditor.tsx": {titleAttr:1,iconLiteral:12},
  "components/mail/mail.css": {hex:1,fontSizeRaw:1},
  "components/mail/MailAccountsSection.tsx": {fontSizeRaw:12,iconLiteral:1},
  "components/mail/MailDraftModal.tsx": {iconLiteral:4},
  "components/mail/MailView.tsx": {titleAttr:2,iconLiteral:26},
  "components/MarkdownReader.tsx": {iconLiteral:3},
  "components/MarkdownTheme.ts": {radiusPx:2,fontSizeRaw:6,durationRaw:1},
  "components/mathMermaidLive.ts": {fontSizeRaw:2},
  "components/MermaidDiagram.tsx": {fontSizeRaw:2},
  "components/MissingRequirementDialog.tsx": {iconLiteral:1},
  "components/OkfConversionModal.tsx": {fontSizeRaw:8},
  "components/OkfInfoModal.tsx": {fontSizeRaw:2},
  "components/OnlineVaultSetup.tsx": {fontSizeRaw:9,iconLiteral:4},
  "components/OutlineSection.tsx": {fontSizeRaw:2,titleAttr:1},
  "components/PaneTabStrip.tsx": {fontSizeRaw:1,jsHover:4,iconLiteral:3},
  "components/pim/PimAccountsSection.tsx": {fontSizeRaw:16,iconLiteral:2},
  "components/pimcal/CalendarView.tsx": {fontSizeBare:8,titleAttr:1,iconLiteral:14},
  "components/pimcal/DayTimeGrid.tsx": {fontSizeBare:9,zIndexRaw:3,titleAttr:2,iconLiteral:4},
  "components/pimcal/EventEditModal.tsx": {fontSizeBare:1,titleAttr:2,iconLiteral:6},
  "components/pimcal/QuickCreatePopover.tsx": {fixedOverlay:2,zIndexRaw:2,iconLiteral:2},
  "components/PropertiesSection.tsx": {fontSizeRaw:2,legacyClass:1,iconLiteral:1},
  "components/PropertyValues.tsx": {fontSizeRaw:1,titleAttr:8,legacyClass:6,iconLiteral:22},
  "components/QuickSwitcher.tsx": {fontSizeRaw:5,iconLiteral:6},
  "components/RecentsSection.tsx": {fontSizeRaw:1,titleAttr:1,iconLiteral:6},
  "components/RightSidebar.tsx": {iconLiteral:7},
  "components/SelectionToolbar.tsx": {fixedOverlay:1,zIndexRaw:1,titleAttr:1,iconLiteral:6},
  "components/settings/AppPages.tsx": {fontSizeRaw:2},
  "components/settings/SettingsNav.tsx": {fontSizeRaw:3,titleAttr:2,iconLiteral:7},
  "components/settings/SyncPage.tsx": {fontSizeRaw:5,titleAttr:3},
  "components/settings/VaultPages.tsx": {iconLiteral:2},
  "components/settings/VaultPickerModal.tsx": {fontSizeRaw:1,titleAttr:1,iconLiteral:2},
  "components/SplashScreen.tsx": {fontSizeRaw:32,titleAttr:2,iconLiteral:13},
  "components/SplitButton.tsx": {titleAttr:2,iconLiteral:4},
  "components/StatusBar.tsx": {iconLiteral:8},
  "components/SyncFolderPickerModal.tsx": {iconLiteral:4},
  "components/TabContextMenu.tsx": {iconLiteral:4},
  "components/TableSizePicker.tsx": {fixedOverlay:1,fontSizeRaw:1},
  "components/TagTree.tsx": {fontSizeRaw:7,titleAttr:1,iconLiteral:4},
  "components/tasks/TasksView.tsx": {fontSizeRaw:20,titleAttr:4,iconLiteral:13},
  "components/TemplatePickerModal.tsx": {iconLiteral:2},
  "components/TemplateTargetsModal.tsx": {fontSizeRaw:1,legacyClass:1,iconLiteral:3},
  "components/ThemePickerCards.tsx": {radiusPx:5,rgba:2,fontSizeRaw:1,titleAttr:2,jsHover:2,iconLiteral:2},
  "components/TitleBar.tsx": {fontSizeRaw:2,jsHover:12,iconLiteral:10},
  "components/VaultFindReplaceModal.tsx": {fontSizeRaw:6,titleAttr:1,iconLiteral:1},
  "components/VersionHistoryModal.tsx": {fontSizeRaw:7,titleAttr:1,iconLiteral:2},
  "components/WebDavFolderPickerModal.tsx": {iconLiteral:3},
  "components/WindowControls.tsx": {hex:2,zIndexRaw:1,titleAttr:3,jsHover:6,iconLiteral:3},
  "services/mail/mailSanitize.ts": {hex:2,fontSizeRaw:1},
  "src/App.tsx": {radiusPx:3,rgba:2,fixedOverlay:1,fontSizeRaw:6,zIndexRaw:4,shadowRaw:1,durationRaw:3,titleAttr:4,iconLiteral:19},
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // ui/ primitives own the canonical overlay/shadow implementations — not ratcheted.
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

/** JSX component OPENING tags (<Capitalized …>) carry legitimate `title`
 * PROPS (Modal, EmptyState, SettingRow) — strip them (and iframes, whose
 * title is an a11y requirement) before counting the titleAttr rule, so only
 * native-DOM tooltip titles are flagged. All other rules run on the raw
 * source (lucide icons ARE capitalized components, so size={N} must be
 * counted un-stripped). */
function stripComponentTags(source: string): string {
  return source
    .replace(/<[A-Z][A-Za-z0-9]*(?:=>|[^>])*>/g, "<STRIPPED>")
    .replace(/<iframe(?:=>|[^>])*>/g, "<STRIPPED>");
}

function countFile(source: string): Counts {
  const titleSource = stripComponentTags(source);
  const counts: Counts = {};
  for (const [rule, re] of Object.entries(RULES)) {
    const n = ((rule === "titleAttr" ? titleSource : source).match(re) || []).length;
    if (n > 0) counts[rule as keyof typeof RULES] = n;
  }
  return counts;
}

function scan(): Record<string, Counts> {
  const actual: Record<string, Counts> = {};
  const record = (rel: string, counts: Counts) => {
    if (Object.keys(counts).length) actual[rel] = counts;
  };
  for (const root of COMPONENT_ROOTS) {
    for (const file of walk(root.dir)) {
      const rel = root.prefix + relative(root.dir, file).replace(/\\/g, "/");
      record(rel, countFile(readFileSync(file, "utf8")));
    }
  }
  for (const name of ROOT_FILES) {
    record(`src/${name}`, countFile(readFileSync(join(SRC, name), "utf8")));
  }
  // App.css: full rule set (v1 only counted raw radii there).
  record("App.css", countFile(readFileSync(join(SRC, "App.css"), "utf8")));
  // mail.css: the one component stylesheet outside styles/ — same contract.
  record(
    "components/mail/mail.css",
    countFile(readFileSync(join(SRC, "components/mail/mail.css"), "utf8"))
  );
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
    const stale: string[] = [];
    for (const [file, counts] of Object.entries(BUDGET)) {
      const act = actual[file];
      if (!act) {
        stale.push(file);
        continue;
      }
      for (const rule of Object.keys(counts)) {
        if (!(rule in act)) stale.push(`${file}#${rule}`);
      }
    }
    expect(stale, `remove stale budget entries: ${stale.join(", ")}`).toEqual([]);
  });
});
