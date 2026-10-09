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
] as const;

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
