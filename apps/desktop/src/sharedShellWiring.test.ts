import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { shippedSources } from "./test-sourceTree";

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
  // What a publication cannot do is said through ONE text on both shells
  // (finding 2026-10-09): a note the sanitizer refuses is named, in the app's
  // language, where the preview would stand and on the publication's row. The
  // phone's sheet used to show the thrown message as it came.
  ["publicationErrorText", "components/security/SecuritySharingPage.tsx", "components/PublishSliceSheet.tsx"],
  ["publicationStatusText", "components/security/SecuritySharingPage.tsx", "screens/SecurityAreaScreen.tsx"],
  // A file whose line ends its shape does not keep — a carriage return of its
  // own — is converted by the first write that changes it (2026-10-12). Both
  // shells hand the one notice to the top of their adapter chain, where every
  // write of the app passes; a shell that stops doing so converts in silence.
  ["sayLineEndsConverted", "contexts/VaultContext.tsx", "services/vaultService.ts"],
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

/**
 * What is meant for a template alone — its task opt-out, its database
 * assignment, a legacy `okf_version` — is taken out of a note in ONE place:
 * the builder `templateAsNewNote` (finding 2026-10-11). It was taken out by
 * the resolver of the paths without questions, so a note a PERSON made from a
 * template kept all three, and its tasks were hidden from the Tasks view.
 *
 * A text becomes a new note's content through the header's one writer,
 * `withOkfDefaults` (frontmatterDefinition.test.ts), or through
 * `finalizeItemContent`, which calls it on what it is handed. Every place that
 * calls either is listed here with the text it hands over. A place that hands
 * one of them a template's text as it was resolved goes around the builder —
 * the pinboard entry did, and the meeting note took the keys out by itself.
 * A new caller is added with its text; a template's goes through the builder.
 *
 * The other end is listed too: every place that fills a template — the engine
 * itself, the resolver without questions, a shell's pipeline with them — and
 * where the filled text goes. A text that goes on to a note goes to the
 * builder; one that goes into an open note or a mail leaves the template's
 * properties behind. A note written straight from a filled template — one that
 * names its own `type` needs no header writer — would pass neither list above.
 */
const noteContentCallers: Record<string, Record<string, string>> = {
  resolveTemplate: {
    "packages/ui/src/lib/templateContext.ts": "runTemplateInteractive, the pipeline with questions of both shells: where its answers go is listed under applyTemplateInteractive",
    "packages/ui/src/base/templateFiles.ts": "applyTemplatePlaceholders, the filler of the ways nobody is asked on",
    "packages/ui/src/pim/meetingNote.ts": "a meeting note nobody is asked about: to the builder",
  },
  applyTemplatePlaceholders: {
    "packages/ui/src/lib/dailyNoteCreate.ts": "the daily note a capture creates on its way: to the builder",
    "packages/ui/src/lib/newItemContent.ts": "buildNewItemContent: to the builder",
  },
  applyTemplateInteractive: {
    "apps/desktop/src/components/BaseViewer.tsx": "a database item and a pinboard entry (through planPinboardEntry): to the builder",
    "apps/desktop/src/components/TemplatePickerModal.tsx": "the text of a template inserted into an open note, without its properties",
    "apps/desktop/src/components/mail/MailDraftModal.tsx": "the text of a template inserted into a mail, without its properties",
    "apps/desktop/src/hooks/useDailyNoteAction.ts": "the daily note a person opens (through ensureDailyNote): to the builder",
    "apps/desktop/src/services/newNoteTemplate.ts": "a new note: to the builder",
    "apps/desktop/src/services/pim/meetingNoteOpen.ts": "a meeting note (through resolveOrCreateMeetingNote): to the builder",
    "apps/mobile/src/EditorHost.tsx": "the text of a template inserted into an open note, without its properties",
    "apps/mobile/src/screens/MailComposeScreen.tsx": "the text of a template inserted into a mail, without its properties",
    "apps/mobile/src/services/pim/pimService.ts": "a meeting note (through resolveOrCreateMeetingNote): to the builder",
    "apps/mobile/src/services/templateInteractive.ts": "a new note (buildNewNoteFromTemplateText) and a pinboard entry's template (answerTemplateFile, through planPinboardEntry): to the builder",
    "apps/mobile/src/services/vaultService.ts": "the daily note a person opens (through ensureDailyNote): to the builder",
  },
  withOkfDefaults: {
    "packages/ui/src/lib/newNoteContent.ts": "the writer's own module: the skeleton of a note without a template, and the builder",
    "packages/ui/src/lib/newItemContent.ts": "finalizeItemContent, on what its callers below hand it",
    "apps/mobile/src/services/templateInteractive.ts": "the heading of a note no template applies to",
    "apps/mobile/src/services/shareImport.ts": "a text shared into the app, which is no template",
  },
  // The builder of an entry made in the background. It takes the template's
  // context from its caller, and its only callers run `withVaultContext`
  // (checked below); a shell that called it would bring no vault.
  buildNewItemContent: {
    "packages/ui/src/ai/aiWrites.ts": "an entry of a database the assistant drafted (AI harness P5-4): its own text and no template (`templateText: null`), so there is nothing to fill with the vault's pieces",
    "packages/ui/src/lib/taskPromotion.ts": "a promoted checkbox and a task created in the database, with the vault's pieces: to the builder",
    "packages/ui/src/pim/taskSync.ts": "a task imported from its provider, with the vault's pieces: to the builder",
  },
  finalizeItemContent: {
    "apps/desktop/src/components/BaseViewer.tsx": "a heading, or the note the builder made of the answered template — as the phone's database item",
    "packages/ui/src/lib/newItemContent.ts": "a heading, or the note the builder made of the filled template",
    "packages/ui/src/base/pinboardEntry.ts": "nothing, or the note the builder made of the answered template",
    "apps/mobile/src/services/baseOps.ts": "the note the phone's builder made, with or without a template",
  },
};

/** The shared modules that make a note from a template: each hands it to the builder. */
const templateNoteBuilders = ["lib/dailyNoteCreate.ts", "lib/newItemContent.ts", "base/pinboardEntry.ts", "pim/meetingNote.ts"] as const;

function usesFeature(source: string, name: string, kind: ts.ScriptKind = ts.ScriptKind.TSX): boolean {
  const tree = ts.createSourceFile(kind === ts.ScriptKind.TS ? "surface.ts" : "surface.tsx", source, ts.ScriptTarget.Latest, true, kind);
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
    expect(exported).toEqual(["clearPendingTemplateCaret", "consumePendingTemplateCaret", "handTemplateCaretOver", "parkTemplateCaret", "takeTemplateCaret", "templateCaretInEditor", "templateCaretInNote", "templateInsertInEditor"]);
    // One place writes the store, and it converts what it is given.
    expect(source.match(/\bpending = \{/g)).toHaveLength(1);
    expect(source).toMatch(/pending = \{ path, offset: templateCaretInEditor\(note, caret\) \}/);
  });
});

describe("a note takes over nothing that is meant for its template alone", () => {
  /** The shipped files that call `name`, each parsed as what it is. */
  const callersOf = (name: string) =>
    shippedSources()
      .filter(({ rel, text }) => text.includes(name) && usesFeature(text, name, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS))
      .map(({ rel }) => rel)
      .sort();

  for (const [name, listed] of Object.entries(noteContentCallers)) {
    it(`${name} is called where it is listed, and nowhere else`, () => {
      expect(callersOf(name), `${name}: list the new caller with the text it hands over — a template's text goes through templateAsNewNote first`).toEqual(Object.keys(listed).sort());
    });
  }

  for (const file of templateNoteBuilders) {
    it(`packages/ui/src/${file} hands its template to the builder`, () => {
      const source = readFileSync(fileURLToPath(new URL(`../../../packages/ui/src/${file}`, import.meta.url)), "utf8");
      expect(usesFeature(source, "templateAsNewNote", ts.ScriptKind.TS), `${file} makes a note from a template without templateAsNewNote`).toBe(true);
    });
  }

  it("the keys are taken out by one function, which only the builder's module can call", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../packages/ui/src/lib/newNoteContent.ts", import.meta.url)), "utf8");
    // Not exported, so no creation path can take them out for itself again …
    expect(source).toMatch(/^function withoutTemplateOnlyKeys\(/m);
    // … and named three times in code: where it is declared, in the builder, and
    // in the question the daily note asks before it builds.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code.match(/\bwithoutTemplateOnlyKeys\b/g)).toHaveLength(3);
    expect(callersOf("withoutTemplateOnlyKeys")).toEqual(["packages/ui/src/lib/newNoteContent.ts"]);
  });

  it("reads a call for a call: a declaration, a re-export and a comment are none", () => {
    expect(usesFeature('export { withOkfDefaults } from "@plainva/ui";\n// withOkfDefaults(text, type)', "withOkfDefaults", ts.ScriptKind.TS)).toBe(false);
    expect(usesFeature("export function withOkfDefaults(content: string) { return content; }", "withOkfDefaults", ts.ScriptKind.TS)).toBe(false);
    // A generic arrow function is TypeScript in a `.ts` file and the start of an element in a `.tsx` one.
    expect(usesFeature("const pick = <T>(items: T[]): T => items[0];\nconst note = withOkfDefaults(pick(texts), type);", "withOkfDefaults", ts.ScriptKind.TS)).toBe(true);
  });
});

/**
 * Where a new note opens, its editor takes the caret (finding 2026-10-12). The
 * desktop's editor is mounted as a pane and as the peek window a database
 * opens its new entry in, and it asked the store only as the active pane: the
 * entry's caret waited for whatever tab showed the note later. Who is handed
 * the caret is one rule now (`takeTemplateCaret`), and the editor asks nothing
 * else — a second question beside it is how one surface fell out.
 */
describe("the desktop's editor takes a new note's caret through the one rule", () => {
  const source = (file: string) => readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");

  it("components/Editor.tsx asks takeTemplateCaret, and not the store beside it", () => {
    const editor = source("components/Editor.tsx");
    expect(usesFeature(editor, "takeTemplateCaret")).toBe(true);
    expect(usesFeature(editor, "consumePendingTemplateCaret")).toBe(false);
    // Both kinds of surface are named where the editor asks: the pane and the preview.
    expect(editor).toMatch(/isActivePane\s*\?\s*"pane"\s*:\s*peek\s*\?\s*"preview"\s*:\s*null/);
  });

  it("the peek window mounts that editor as a preview — never as a pane, which would take the keyboard and the pokes meant for a tab", () => {
    const tree = ts.createSourceFile("BasePeekModal.tsx", source("components/BasePeekModal.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const editors: string[][] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) && ts.isIdentifier(node.tagName) && node.tagName.text === "LazyEditor") {
        // Each attribute as written: `peek`, `isActivePane={false}`.
        editors.push(node.attributes.properties.map((attribute) => attribute.getText().replace(/\s+/g, "")));
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(editors).toHaveLength(1);
    expect(editors[0]).toEqual(expect.arrayContaining(["peek", "isActivePane={false}", "activePath={current}"]));
  });

  it("the peek window hands a new note's caret on when it opens the note as a tab or in the split", () => {
    const peek = source("components/BasePeekModal.tsx");
    expect(usesFeature(peek, "handTemplateCaretOver")).toBe(true);
    // Before each of the two doors, in the same handler.
    expect(peek).toMatch(/handCaretOver\(\);\s*onMaximize\(current\)/);
    expect(peek).toMatch(/handCaretOver\(\);\s*onOpenSplit\(current\)/);
  });
});

/**
 * What a template is resolved WITH comes from one place (Sammelplan § 3.97):
 * the shared `templateContext.ts`. Each caller used to fill the context
 * itself, and callers forgot — three ways of the desktop never got the week
 * start or the clipboard, two never got `{{daily}}`, the phone's daily note
 * never got `{{daily}}`, and an entry made in the background got its title and
 * nothing else.
 *
 * The pipeline with questions is the shared one, and each shell only hands it
 * its vault, its selection, its clipboard and its dialog. The builders of the
 * background take the vault's pieces from `withVaultContext`, and every shell
 * call of them names the vault — the option is optional for the tests' sake,
 * so this is what stops a call that forgets it.
 */
describe("every template is resolved with the context of the one place", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");

  it("each shell's pipeline with questions is the shared one", () => {
    for (const rel of ["apps/desktop/src/services/templateInteractive.ts", "apps/mobile/src/services/templateInteractive.ts"]) {
      const source = read(rel);
      expect(usesFeature(source, "runTemplateInteractive", ts.ScriptKind.TS), `${rel} resolves templates without the shared pipeline`).toBe(true);
      // No context of its own beside it: the shared module adds every piece.
      expect(source, rel).not.toMatch(/\bwithShellContext\b|\bweekStartDayOf\b|\bbuildDailyNotePath\b/);
    }
  });

  it("the shared builders of the ways nobody is asked on fill the vault's pieces, each of them", () => {
    // Calls of withVaultContext per file: one per builder that fills a template.
    const calls = (source: string) => {
      const tree = ts.createSourceFile("builder.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      let n = 0;
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "withVaultContext") n++;
        ts.forEachChild(node, visit);
      };
      visit(tree);
      return n;
    };
    const builders = { "packages/ui/src/lib/dailyNoteCreate.ts": 1, "packages/ui/src/lib/taskPromotion.ts": 2, "packages/ui/src/pim/taskSync.ts": 1 };
    for (const [rel, count] of Object.entries(builders)) {
      expect(calls(read(rel)), `${rel} fills a template without the vault's pieces`).toBe(count);
    }
  });

  /** Every call of `name` in the shells' shipped files, with the options object it is handed. */
  function callsOf(name: string): { rel: string; options: string }[] {
    const found: { rel: string; options: string }[] = [];
    for (const { rel, text } of shippedSources()) {
      if (!rel.startsWith("apps/") || !text.includes(name)) continue;
      const tree = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
          found.push({ rel, options: node.arguments[0]?.getText(tree) ?? "" });
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    return found;
  }

  for (const name of ["runTaskSync", "promoteTask", "createTaskInDatabase", "prepareTaskNote"]) {
    it(`every shell call of ${name} names the vault`, () => {
      const calls = callsOf(name);
      expect(calls.length, `no shell calls ${name} — re-point this guard`).toBeGreaterThan(0);
      // Named, and with something: `templateVault: null` would be a call that names nothing.
      const without = calls.filter((call) => !/\btemplateVault\s*:\s*(?!null\b|undefined\b)\S/.test(call.options)).map((call) => call.rel);
      expect(without, `${name}: hand over templateVault, or the database's template gets no {{vault}} and no {{daily}}`).toEqual([]);
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
