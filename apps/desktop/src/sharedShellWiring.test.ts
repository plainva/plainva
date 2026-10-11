import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** A bounded wiring guard, not a product-coverage claim. These shared features
 * have been implemented in both shells. Removing a call/render from either
 * shell must not leave an unnoticed gap while catalog-only checks stay green.
 * Behavioral tests still establish what the mounted feature actually does. */
const contracts = [
  ["BaseExportDialog", "components/BaseViewer.tsx", "screens/base/BaseScreen.tsx"],
  ["TaskMetadataDetails", "components/tasks/TasksView.tsx", "screens/TasksScreen.tsx"],
  ["PublicationFeedback", "components/workspace/WorkspaceCommentsColumn.tsx", "components/CommentsSheet.tsx"],
  ["useCustomThemePair", "components/settings/CustomThemeEditor.tsx", "screens/CustomThemeScreen.tsx"],
  ["usePersonalDesignSync", "components/SettingsModal.tsx", "screens/CustomThemeScreen.tsx"],
  // The pinboard's "New entry" (plan Befunde 2026-09-24, E16): ONE core for
  // the draft and its end; the two capture paths it replaced had drifted apart.
  ["planPinboardEntry", "components/BaseViewer.tsx", "services/baseOps.ts"],
  ["finalizePinboardEntry", "components/base/PinboardEntryModal.tsx", "services/baseOps.ts"],
  ["discardPinboardEntry", "components/base/PinboardEntryModal.tsx", "services/baseOps.ts"],
  // What a closed or killed app left of an entry (E15): one rule, one record
  // of open drafts, and every editor of both shells answers "is this open?".
  ["sweepPinboardDrafts", "services/pinboardDrafts.ts", "services/baseOps.ts"],
  ["pinboardDraftLedger", "components/BaseViewer.tsx", "services/baseOps.ts"],
  ["answerEditorPathProbe", "components/Editor.tsx", "EditorHost.tsx"],
  // A new note from a template (finding 2026-10-09): ONE builder for the OKF
  // header and for where `{{cursor}}` stands in what is written. The phone had
  // a header string of its own, and a template's block without `type` stayed
  // without one there.
  ["templateAsNewNote", "services/newNoteTemplate.ts", "services/templateInteractive.ts"],
  ["templateCaretInNote", "components/BaseViewer.tsx", "services/baseOps.ts"],
  // A template inserted INTO a note (finding 2026-10-11): the text as an editor
  // holds one and the caret as a place in it. Handed over as it was read, a
  // template with `\r\n` put the caret too far right, and without a cursor
  // marker the editor refused the insertion at the end of a note.
  ["templateInsertInEditor", "components/TemplatePickerModal.tsx", "EditorHost.tsx"],
] as const;

/**
 * Every place that makes a note from a template parks its `{{cursor}}` for the
 * editor through the shared `parkTemplateCaret`, with the note the place was
 * counted in (finding 2026-10-09). That call is where the place becomes one in
 * the text an editor holds; a place that stops parking leaves the caret at the
 * top of the note, and one that parked a bare number — as all of them did —
 * put it one character too far right for every `\r\n` above it.
 */
const caretParkers = {
  desktop: ["components/FileTree.tsx", "components/QuickSwitcher.tsx", "components/BaseViewer.tsx", "components/pimcal/CalendarView.tsx", "services/dailyNotes.ts"],
  mobile: ["services/vaultService.ts", "services/baseOps.ts", "services/pim/pimService.ts"],
} as const;

function usesFeature(source: string, name: string): boolean {
  const tree = ts.createSourceFile("surface.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let used = false;
  function visit(node: ts.Node) {
    const target = ts.isCallExpression(node) ? node.expression
      : ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node.tagName : null;
    if (target && ts.isIdentifier(target) && target.text === name) used = true;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return used;
}

function missingShells(name: string, desktop: string, mobile: string): string[] {
  return Object.entries({ desktop, mobile }).filter(([, source]) => !usesFeature(source, name)).map(([shell]) => shell);
}

describe("shared features remain wired in both shells", () => {
  for (const [name, desktop, mobile] of contracts) {
    it(name, () => {
      const desktopSource = readFileSync(fileURLToPath(new URL(`./${desktop}`, import.meta.url)), "utf8");
      const mobileSource = readFileSync(fileURLToPath(new URL(`../../mobile/src/${mobile}`, import.meta.url)), "utf8");
      expect(missingShells(name, desktopSource, mobileSource), `${name}: restore the missing shell or document and test a deliberate parity decision`).toEqual([]);
    });
  }
});

describe("a new note's caret is parked through the shared function", () => {
  const sourceOf = (shell: keyof typeof caretParkers, file: string) =>
    readFileSync(fileURLToPath(new URL(shell === "desktop" ? `./${file}` : `../../mobile/src/${file}`, import.meta.url)), "utf8");

  for (const shell of ["desktop", "mobile"] as const) {
    for (const file of caretParkers[shell]) {
      it(`${shell}: ${file}`, () => {
        expect(usesFeature(sourceOf(shell, file), "parkTemplateCaret"), `${file} creates notes from templates and no longer parks their caret`).toBe(true);
      });
    }
  }

  it("is the only way into the store: the module keeps no setter for a bare number", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../packages/ui/src/lib/templateCaret.ts", import.meta.url)), "utf8");
    const exported = [...source.matchAll(/^export function (\w+)/gm)].map((match) => match[1]).sort();
    expect(exported).toEqual(["clearPendingTemplateCaret", "consumePendingTemplateCaret", "parkTemplateCaret", "templateCaretInEditor", "templateCaretInNote", "templateInsertInEditor"]);
    // One place writes the store, and it converts what it is given.
    expect(source.match(/\bpending = \{/g)).toHaveLength(1);
    expect(source).toMatch(/pending = \{ path, offset: templateCaretInEditor\(note, caret\) \}/);
  });
});

describe("wiring guard counterexamples", () => {
  it("reports the shell missing a rendered feature", () => {
    expect(missingShells("Example", "const el = <Example />;", "const el = <div />;")).toEqual(["mobile"]);
    expect(missingShells("useExample", "", "useExample();")).toEqual(["desktop"]);
  });
  it("does not count an unused import, a comment or a string", () => {
    expect(usesFeature('import { Example } from "shared"; // <Example />\nconst text = "Example()";', "Example")).toBe(false);
  });
  it("recognizes both JSX forms and actual hook calls", () => {
    expect(usesFeature("const x = <Example>content</Example>;", "Example")).toBe(true);
    expect(usesFeature("const x = useExample({ enabled: true });", "useExample")).toBe(true);
  });
});
