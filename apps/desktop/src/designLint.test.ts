import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Walks the whole source tree from disk: about half a second on its own, but past
// the 5 s unit-test default under the full suite's parallel load — six of these
// guards timed out at once and passed in isolation (2026-08-24). A default meant
// for unit tests is the wrong yardstick for a check whose runtime grows with the
// repo; 30 s still catches a hang.
vi.setConfig({ testTimeout: 30_000 });

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
  // The mail core moved to the shared package (feinplan G0.1) — it must stay
  // under the same ratchet it had in the shell.
  { dir: join(SRC, "../../../packages/ui/src/mail"), prefix: "mail/" },
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
  // A raw <select> must at least wear the field skin (`pv-field pv-field--select`,
  // the documented dense-toolbar idiom); forms/dialogs use the Select primitive.
  nakedSelect: /<select(?!(?:=>|[^>])*pv-field--select)/g,
  // P6 (finding 2026-09-01, D1): the two things the UI rule demands that no
  // value rule could see — build on the primitives, take spacing from the
  // tokens. A find & replace dialog stood beside both for two years without
  // a red commit. Markup rules run on comment-stripped source (TS/TSX only).
  // A raw text/checkbox/radio/search input: TextInput, Checkbox, Radio,
  // SearchField exist. file/color/range/hidden have no primitive and are exempt.
  nakedInput: /<input\b(?![^>]*type=["'](?:file|color|range|hidden)["'])/g,
  // A raw <button>: Button/IconButton/MenuItem exist. Rows, tabs and tree
  // items that are buttons by role keep their budget with a justification.
  nakedButton: /<button\b/g,
  // gap/padding/margin with a bare number or a px/rem literal inside a style
  // object — the --space-* tokens are the scale. Zero is not a spacing value.
  rawSpacing: /\b(?:gap|rowGap|columnGap|padding|margin|(?:padding|margin)(?:Top|Right|Bottom|Left))\s*:\s*(?:(?!0[,\s}])-?\d+(?:\.\d+)?\b|["'`]\s*(?!0["'`])-?\d+(?:\.\d+)?(?:px|rem|em)?(?:\s+-?\d+(?:\.\d+)?(?:px|rem|em)?)*\s*["'`])/g,
};

/** Rules that describe React markup and style objects, not stylesheets. */
const TSX_ONLY = new Set<keyof typeof RULES>(["nakedInput", "nakedButton", "rawSpacing"]);
const MARKUP_RULES = new Set<keyof typeof RULES>(["nakedSelect", "nakedInput", "nakedButton"]);

type Counts = Partial<Record<keyof typeof RULES, number>>;

/** Frozen remaining debt (initialized 2026-07-19 from the tree; the sweep
 * packages P2-P8 drive this to EMPTY). Lower or remove entries as files are
 * migrated; never raise one; new entries need a justification comment. */
const BUDGET: Record<string, Counts> = {
  // The sweep (P2-P8, 2026-07-19) drove this map from 1253 findings in 107
  // files down to the value-rule entries below — every remaining one is a
  // JUSTIFIED exception documented at the finding site, not debt:
  // - propertyModel/callouts: option-swatch DATA + var() fallback literals.
  // - EmojiPicker/HeaderColorPicker: native <input type=color> needs a
  //   resolved hex string.
  // - ImageViewer: pen default + JPEG flatten fill are baked PIXEL data.
  // - mail.css: avatar fg over the theme-independent --palette-N swatches.
  // - DayTimeGrid: local stacking order inside one day column (no overlay).
  // - ThemePickerCards: neutral outline over each card's OWN swatch colors.
  // - mailSanitize: sandboxed srcdoc iframe cannot inherit app tokens.
  //
  // nakedInput / nakedButton / rawSpacing (P6, initialized 2026-09-03 from
  // the tree): the debt the two markup-and-spacing rules found on the day
  // they were added. Same contract as the value rules — a file may only go
  // DOWN, a new raw control or bare spacing number in a file without an
  // entry fails the commit, and a file that reaches zero leaves the map.
  // VaultFindReplaceModal, the finding that brought the rules, starts at 0.
  "base/propertyModel.ts": {hex:8},
  "components/AuxTitleBar.tsx": {rawSpacing:2},
  "components/BacklinksPanel.tsx": {rawSpacing:12},
  "components/BaseInlineEditors.tsx": {nakedInput:2,nakedButton:4,rawSpacing:4},
  "components/BasePeekModal.tsx": {nakedButton:8},
  "components/BasePicker.tsx": {nakedInput:1,nakedButton:2,rawSpacing:5},
  "components/BaseViewer.tsx": {nakedButton:7,rawSpacing:7},
  "components/BlockMenu.tsx": {nakedButton:1,rawSpacing:5},
  "components/BookmarksList.tsx": {nakedButton:1,rawSpacing:2},
  "components/CalendarWidget.tsx": {nakedInput:1,nakedButton:9,rawSpacing:20},
  "components/CascadeDeleteModal.tsx": {nakedButton:1},
  "components/CodeBlock.tsx": {nakedButton:1,rawSpacing:3},
  "components/ColumnSchemaEditor.tsx": {nakedInput:7,nakedButton:2,rawSpacing:9},
  "components/CommandPalette.tsx": {nakedInput:1,nakedButton:1},
  "components/CompareModal.tsx": {nakedButton:1,rawSpacing:20},
  "components/DatabaseSourceConfig.tsx": {rawSpacing:9},
  "components/DatabasesList.tsx": {nakedButton:1,rawSpacing:5},
  "components/DatePicker.tsx": {nakedInput:1,nakedButton:4,rawSpacing:9},
  "components/DeletedFilesModal.tsx": {rawSpacing:1},
  "components/DocumentHeaderRead.tsx": {rawSpacing:1},
  "components/Editor.tsx": {nakedButton:15,rawSpacing:13},
  "components/EmojiPicker.tsx": {hex:1,nakedButton:9,rawSpacing:12},
  "components/ErrorBoundary.tsx": {nakedButton:1,rawSpacing:1},
  "components/FileTree.tsx": {nakedInput:5,rawSpacing:19},
  "components/HailingFrequenciesModal.tsx": {nakedInput:2,nakedButton:1,rawSpacing:10},
  "components/HeaderColorPicker.tsx": {hex:1,nakedButton:3,rawSpacing:5},
  "components/ImageViewer.tsx": {hex:2,nakedInput:5,nakedButton:22,rawSpacing:7},
  "components/IndexMdModal.tsx": {rawSpacing:5},
  "components/LeftPinnedSections.tsx": {nakedButton:1},
  "components/LeftSidebarTabs.tsx": {nakedButton:1,rawSpacing:2},
  "components/MarkdownReader.tsx": {nakedInput:2,rawSpacing:36},
  "components/MarkdownTheme.ts": {rawSpacing:21},
  "components/MermaidDiagram.tsx": {rawSpacing:5},
  "components/MissingRequirementDialog.tsx": {nakedInput:2},
  "components/NoteCardBody.tsx": {nakedInput:1,rawSpacing:9},
  "components/NoteDatabaseBar.tsx": {nakedButton:2,rawSpacing:1},
  "components/NoteDatabasesSection.tsx": {nakedButton:7,rawSpacing:6},
  "components/NoteEmbedPlugin.tsx": {rawSpacing:3},
  "components/OkfConversionModal.tsx": {nakedInput:2,rawSpacing:15},
  "components/OkfMigrationModal.tsx": {rawSpacing:6},
  "components/OnlineVaultSetup.tsx": {nakedInput:13,nakedButton:5,rawSpacing:13},
  "components/OutlineSection.tsx": {nakedButton:1,rawSpacing:3},
  "components/PaneTabStrip.tsx": {rawSpacing:2},
  "components/PropertiesSection.tsx": {nakedButton:3,rawSpacing:14},
  "components/PropertyValues.tsx": {nakedInput:10,nakedButton:23,rawSpacing:5},
  "components/QuickSwitcher.tsx": {nakedInput:1,rawSpacing:19},
  "components/RecentSearchesPopover.tsx": {nakedButton:2},
  "components/RecentsSection.tsx": {nakedButton:1,rawSpacing:4},
  "components/RightSidebar.tsx": {nakedButton:1},
  "components/SelectionToolbar.tsx": {nakedButton:1},
  "components/ShortcutsModal.tsx": {nakedInput:1,nakedButton:1,rawSpacing:10},
  "components/SplashScreen.tsx": {nakedButton:17,rawSpacing:64},
  "components/SplitButton.tsx": {nakedButton:2},
  "components/StatusBar.tsx": {nakedButton:3,rawSpacing:11},
  "components/SyncFolderPickerModal.tsx": {nakedInput:1,rawSpacing:1},
  "components/TableSizePicker.tsx": {rawSpacing:2},
  "components/TagTree.tsx": {rawSpacing:9},
  "components/TemplatePickerModal.tsx": {nakedInput:1,rawSpacing:4},
  "components/TemplateTargetsModal.tsx": {nakedInput:1,nakedButton:2,rawSpacing:1},
  "components/ThemePickerCards.tsx": {rgba:2,nakedButton:2,rawSpacing:9},
  "components/TitleBar.tsx": {nakedButton:5,rawSpacing:7},
  "components/VaultSwitcher.tsx": {nakedButton:3,rawSpacing:3},
  "components/WindowControls.tsx": {nakedButton:3,rawSpacing:2},
  "components/anchorHighlight.ts": {rawSpacing:1},
  "components/base/BaseBoardView.tsx": {nakedInput:1,nakedButton:2,rawSpacing:13},
  "components/base/BaseCalendarView.tsx": {nakedButton:3,rawSpacing:13},
  "components/base/BaseConfigPanel.tsx": {nakedInput:3,nakedButton:32,rawSpacing:10},
  "components/base/BaseCreateWizard.tsx": {nakedInput:3},
  "components/base/BaseGalleryView.tsx": {rawSpacing:8},
  "components/base/BaseGraphView.tsx": {nakedInput:4},
  "components/base/BaseListView.tsx": {nakedInput:1,rawSpacing:5},
  "components/base/BasePinboardView.tsx": {nakedInput:2,nakedButton:5,rawSpacing:25},
  "components/base/BaseTableView.tsx": {nakedInput:2,nakedButton:3,rawSpacing:6},
  "components/base/BaseTimelineView.tsx": {nakedButton:3,rawSpacing:6},
  "components/base/BaseViewTabs.tsx": {nakedInput:1,nakedButton:7,rawSpacing:1},
  "components/base/NewItemButton.tsx": {nakedInput:2,nakedButton:9,rawSpacing:10},
  "components/base/SourceConditionEditor.tsx": {nakedButton:2,rawSpacing:6},
  "components/base/baseViewerShared.tsx": {rawSpacing:1},
  "components/base/useBaseCells.tsx": {nakedInput:1},
  "components/callouts.ts": {hex:8},
  "components/comments/CommentsOverview.tsx": {nakedButton:1},
  "components/graph/CleanupPanel.tsx": {nakedButton:11},
  "components/graph/GraphContextSection.tsx": {nakedButton:3},
  "components/graph/PinModeToggle.tsx": {nakedButton:1},
  "components/graph/VaultGraphView.tsx": {nakedInput:3,nakedButton:12,rawSpacing:4},
  "components/import/ImportWizardModal.tsx": {nakedInput:2,nakedButton:2,rawSpacing:1},
  "components/mail/ComposeEditor.tsx": {nakedButton:2},
  "components/mail/MailAccountsSection.tsx": {nakedInput:3},
  "components/mail/MailDraftModal.tsx": {nakedInput:2,nakedButton:4,rawSpacing:1},
  "components/mail/MailView.tsx": {nakedInput:1,nakedButton:13,rawSpacing:1},
  "components/mail/RulesSettings.tsx": {nakedInput:1},
  "components/mail/VacationSettings.tsx": {nakedInput:4},
  "components/mail/mail.css": {hex:1},
  "components/mathMermaidLive.ts": {rawSpacing:2},
  "components/onboarding/FirstRunModal.tsx": {nakedButton:2,rawSpacing:1},
  "components/pim/PimAccountsSection.tsx": {nakedInput:4,rawSpacing:29},
  "components/pimcal/BlockCalendarsModal.tsx": {rawSpacing:3},
  "components/pimcal/CalendarView.tsx": {nakedButton:6,rawSpacing:28},
  "components/pimcal/DayTimeGrid.tsx": {zIndexRaw:3,nakedButton:3,rawSpacing:18},
  "components/pimcal/EventContextMenu.tsx": {nakedButton:2,rawSpacing:3},
  "components/pimcal/EventEditModal.tsx": {nakedInput:7,nakedButton:3,rawSpacing:13},
  "components/pimcal/EventPeek.tsx": {rawSpacing:10},
  "components/pimcal/QuickCreatePopover.tsx": {nakedInput:2,rawSpacing:7},
  "components/pimcal/TimeBlockModal.tsx": {nakedInput:3,rawSpacing:3},
  "components/security/SecuritySharingPage.tsx": {nakedButton:2},
  "components/security/WorkspaceGovernanceDialog.tsx": {nakedButton:1},
  "components/settings/AppPages.tsx": {nakedInput:5,nakedButton:2,rawSpacing:12},
  "components/settings/CloudAccountsPage.tsx": {nakedButton:1},
  "components/settings/CloudAccountsWizard.tsx": {nakedButton:7},
  "components/settings/EncryptionSetupModal.tsx": {nakedInput:3},
  "components/settings/SecurityNav.tsx": {nakedButton:2,rawSpacing:4},
  "components/settings/SettingsNav.tsx": {nakedButton:3,rawSpacing:8},
  "components/settings/StoredCredentialsCard.tsx": {rawSpacing:3},
  "components/settings/SyncPage.tsx": {nakedInput:1,rawSpacing:10},
  "components/settings/VaultPages.tsx": {nakedInput:18,nakedButton:12,rawSpacing:7},
  "components/settings/VaultPickerModal.tsx": {nakedButton:1,rawSpacing:1},
  "components/tasks/RepeatTaskModal.tsx": {nakedInput:1,rawSpacing:1},
  "components/tasks/TasksView.tsx": {nakedInput:3,nakedButton:8,rawSpacing:42},
  "mail/mailSanitize.ts": {hex:2,fontSizeRaw:1},
  "src/App.tsx": {nakedButton:2,rawSpacing:11},
  "components/AppRibbon.tsx": {nakedButton:1},
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

/** The native tooltip attribute lives on a LOWERCASE DOM tag; `title` on a
 * capitalised tag is a component PROP (Modal, EmptyState, SettingRow, Row) and
 * shows no tooltip. All other rules run on the raw source (lucide icons ARE
 * capitalised components, so size={N} must be counted un-stripped). */
function countNativeTitleAttrs(source: string): number {
  // Walk the tag HEADERS. An attribute belongs to the header it stands in, and
  // a header can hold a whole element inside a prop — `<Row icon={<span />}
  // title={…}>` has three tags before the attribute and only one owner. The
  // stack restores the outer header when a nested one ends, which is the case
  // a "nearest tag opening" rule and a strip-the-tags regex both get wrong.
  const stack: { name: string; brace: number }[] = [];
  let head: { name: string; brace: number } | null = null;
  let count = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (head === null) {
      if (ch === "<" && /[A-Za-z]/.test(source[i + 1] ?? "")) {
        const name = /^[A-Za-z][A-Za-z0-9.]*/.exec(source.slice(i + 1))![0];
        head = { name, brace: 0 };
        i += name.length;
      }
      continue;
    }
    if (ch === "{") head.brace += 1;
    else if (ch === "}") head.brace -= 1;
    else if (ch === "<" && head.brace > 0 && /[A-Za-z]/.test(source[i + 1] ?? "")) {
      const name = /^[A-Za-z][A-Za-z0-9.]*/.exec(source.slice(i + 1))![0];
      stack.push(head);
      head = { name, brace: 0 };
      i += name.length;
    } else if (ch === ">" && head.brace === 0) {
      head = stack.pop() ?? null;
    } else if (
      head.brace === 0 &&
      ch === "t" &&
      /^\stitle=(?:\{|")/.test(source.slice(i - 1, i + 8)) &&
      // An iframe title is an accessibility requirement, not a tooltip.
      head.name !== "iframe" &&
      head.name[0] === head.name[0].toLowerCase()
    ) {
      count += 1;
    }
  }
  return count;
}

/** Prose is not markup: a comment that NAMES a native <select> (the mobile
 * dialog module opens by explaining that it replaces the OS dropdowns) is not
 * one. Only the markup rule strips comments — the value rules deliberately
 * count literals wherever they stand. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function countFile(source: string, isStylesheet = false): Counts {
  const markupSource = stripComments(source);
  const counts: Counts = {};
  for (const [rule, re] of Object.entries(RULES)) {
    const key = rule as keyof typeof RULES;
    if (isStylesheet && TSX_ONLY.has(key)) continue;
    const n =
      rule === "titleAttr"
        ? countNativeTitleAttrs(source)
        : ((MARKUP_RULES.has(key) ? markupSource : source).match(re) || []).length;
    if (n > 0) counts[key] = n;
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
  record("App.css", countFile(readFileSync(join(SRC, "App.css"), "utf8"), true));
  // mail.css: the one component stylesheet outside styles/ — same contract.
  record(
    "components/mail/mail.css",
    countFile(readFileSync(join(SRC, "components/mail/mail.css"), "utf8"), true)
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
