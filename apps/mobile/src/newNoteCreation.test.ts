import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FolderRule {
  folder: string;
  template: string;
}
interface TypeRule {
  type: string;
  template: string;
}
const settings = {
  templateFolder: "Vorlagen",
  folderTemplates: [] as FolderRule[],
  typeTemplates: [] as TypeRule[],
  defaultNoteType: "Note",
  dailyNoteType: "Daily Note",
  inboxFolder: "Eingang",
  dailyFormat: "YYYY-MM-DD",
  dailyFolder: "",
  dailyTemplate: "",
};
vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./services/mobileDialogs", () => ({ mTemplateAnswers: vi.fn() }));
vi.mock("./services/editorSelection", () => ({ readEditorSelection: () => null }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? "" } }));

import { editorTextOf } from "@plainva/core";
import {
  buildNewNoteContent,
  clearPendingTemplateCaret,
  consumePendingTemplateCaret,
  ensureDailyNote as ensureSharedDailyNote,
  parkTemplateCaret,
  wikiTargetToPath,
} from "@plainva/ui";
import { configuredDailyNoteType, configuredNoteType } from "./services/newNote";
import { applyTemplateInteractive, buildNewNoteFromTemplate, buildNewNoteFromTemplateText } from "./services/templateInteractive";

/**
 * The ways the phone makes a note out of nothing: the capture button
 * (`capture` in `App.tsx`, which calls `vaultOps.createNote`), "New note from a
 * template" (`createNoteFromTemplate`), a tap on a link to a note that does not
 * exist yet (`createNoteFromWikiTarget`), and the daily note (`ensureDailyNote`).
 *
 * Each of the first three had the OKF header as a string of its own until
 * 2026-10-09, with a blank line behind it; the two template-less ones wrote two
 * more below the heading. What they write now is the shared skeleton and the
 * shared template builder — the same bytes the desktop writes.
 *
 * `vaultService.ts` boots the native vault when it is imported, and `App.tsx`
 * is the whole app, so the methods and the button's handler are read from
 * their sources and run against a vault in memory, with the real builders and
 * the real settings reader behind them. A method that goes back to a text or a
 * type of its own, or reaches for something this scope does not hand it, fails
 * here.
 */

interface MemoryVault {
  text: Map<string, string>;
  files: { exists(path: string): Promise<boolean> };
}

interface CreationOps {
  createNote(...args: unknown[]): Promise<string | null>;
  createNoteFromTemplate(v: MemoryVault, folder: string, title: string, templateRaw: string): Promise<string | null>;
  createNoteFromWikiTarget(v: MemoryVault, target: string, hostPath?: string): Promise<string | null>;
  ensureDailyNote(v: MemoryVault, date: Date, mode?: "interactive" | "headless"): Promise<{ path: string; created: boolean } | null>;
}

const reported: string[] = [];
/** The notes the app opened after creating them. */
const opened: string[] = [];

const transpile = (code: string) =>
  ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function creationOps(): CreationOps {
  const file = ts.createSourceFile("vaultService.ts", readFileSync("src/services/vaultService.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const wanted = ["createNote", "createNoteFromTemplate", "createNoteFromWikiTarget", "ensureDailyNote"];
  const methods = new Map<string, string>();
  const ofVaultOps = (node: ts.MethodDeclaration) =>
    ts.isObjectLiteralExpression(node.parent) && ts.isVariableDeclaration(node.parent.parent) && node.parent.parent.name.getText(file) === "vaultOps";
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && wanted.includes(node.name.getText(file)) && ofVaultOps(node)) methods.set(node.name.getText(file), node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const name of wanted) if (!methods.has(name)) throw new Error(`vaultOps.${name} is gone from vaultService.ts`);
  const code = transpile(
    `const vaultOps = {
      async read(v, path) { return v.text.get(path); },
      async save(v, path, text) { v.text.set(path, text); },
      ${[...methods.values()].join(",\n")}
    };`,
  );
  // Everything the methods may reach for. The builders, the settings reader and
  // the caret store are the real ones; only the vault, the catalog and the
  // report are not.
  const scope = {
    i18n: { t: (_key: string, o: { n: number }) => `Notiz ${o.n}` },
    applyTemplateInteractive,
    buildNewNoteFromTemplate,
    buildNewNoteFromTemplateText,
    buildNewNoteContent,
    configuredDailyNoteType,
    configuredNoteType,
    ensureSharedDailyNote,
    getActiveVaultEntry: async () => ({ name: "Vault" }),
    getMobileSettings: () => settings,
    reportCreated: (path: string) => void reported.push(path),
    // The one way to park a caret since 2026-10-09: with the note it counts in.
    parkTemplateCaret,
    wikiTargetToPath,
  };
  return new Function(...Object.keys(scope), `${code}\nreturn vaultOps;`)(...Object.values(scope)) as CreationOps;
}

/**
 * The capture button: `capture` as `App.tsx` declares it, over the creation
 * path above. Resolves with the note it made, once the app has opened it.
 * `lookingAt` is the folder that is open, "" for none.
 */
function captureButton(ops: CreationOps): (vault: MemoryVault, lookingAt: string) => Promise<string | null> {
  const file = ts.createSourceFile("App.tsx", readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "capture" && node.initializer && ts.isArrowFunction(node.initializer)) declaration = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!declaration) throw new Error("`capture` is gone from App.tsx");
  const code = transpile(`const ${declaration};`);
  return async (vault, lookingAt) => {
    let created: Promise<string | null> = Promise.resolve(null);
    const scope = {
      browseFolder: () => lookingAt,
      getMobileSettings: () => settings,
      pushCapturedNote: (_state: unknown, _slots: unknown, path: string) => path,
      setNav: (next: (state: unknown) => string) => void opened.push(next(null)),
      slots: [],
      vault,
      // The real creation path, called with whatever the button hands it.
      vaultOps: { createNote: (...args: unknown[]) => (created = ops.createNote(...args)) },
    };
    (new Function(...Object.keys(scope), `${code}\nreturn capture;`)(...Object.values(scope)) as () => void)();
    const path = await created;
    // The button opens the note in the `then` behind the creation.
    await Promise.resolve();
    return path;
  };
}

function memoryVault(files: Record<string, string> = {}): MemoryVault {
  const text = new Map(Object.entries(files));
  return { text, files: { exists: async (path) => text.has(path) } };
}

const ops = creationOps();
const capture = captureButton(ops);

beforeEach(() => {
  settings.folderTemplates = [];
  settings.typeTemplates = [];
  settings.defaultNoteType = "Note";
  settings.dailyNoteType = "Daily Note";
  reported.length = 0;
  opened.length = 0;
  clearPendingTemplateCaret();
});

describe("the phone's new notes, as its creation paths write them", () => {
  it("the capture button's note is the shared skeleton: header, heading, nothing else", async () => {
    const vault = memoryVault();
    const path = await capture(vault, "Eingang");
    expect(path).toBe("Eingang/Notiz 1.md");
    expect(vault.text.get("Eingang/Notiz 1.md")).toBe("---\ntype: Note\n---\n# Notiz 1\n");
    // The bytes the desktop writes for a new note.
    expect(vault.text.get("Eingang/Notiz 1.md")).toBe(buildNewNoteContent("Note", "Notiz 1"));
    expect(await capture(vault, "Eingang")).toBe("Eingang/Notiz 2.md");
    expect(reported).toEqual(["Eingang/Notiz 1.md", "Eingang/Notiz 2.md"]);
    expect(opened).toEqual(["Eingang/Notiz 1.md", "Eingang/Notiz 2.md"]);
    expect(consumePendingTemplateCaret("Eingang/Notiz 1.md")).toBeNull();
  });

  it("the capture button writes into the inbox while no folder is open", async () => {
    const vault = memoryVault();
    expect(await capture(vault, "")).toBe("Eingang/Notiz 1.md");
  });

  it("with a rule's template the capture button writes `type` into the template's block and parks the caret", async () => {
    settings.folderTemplates = [{ folder: "Projekte", template: "Projekt.md" }];
    const vault = memoryVault({ "Vorlagen/Projekt.md": "---\nstatus: entwurf\n---\n# {{title}}\n\n{{cursor}}Text\n" });
    const path = await capture(vault, "Projekte");
    expect(path).toBe("Projekte/Notiz 1.md");
    const note = vault.text.get("Projekte/Notiz 1.md");
    expect(note).toBe("---\nstatus: entwurf\ntype: Note\n---\n# Notiz 1\n\nText\n");
    expect(consumePendingTemplateCaret("Projekte/Notiz 1.md")).toEqual({ path: "Projekte/Notiz 1.md", offset: note!.indexOf("Text") });
  });

  it("a picked template gets the same header — also where its block is empty — and its name counts up", async () => {
    const vault = memoryVault({ "Archiv/Plan.md": "schon da" });
    const path = await ops.createNoteFromTemplate(vault, "Archiv", "Plan", "---\n---\n# {{title}}\n{{cursor}}");
    expect(path).toBe("Archiv/Plan 2.md");
    const note = vault.text.get("Archiv/Plan 2.md");
    expect(note).toBe("---\ntype: Note\n---\n# Plan 2\n");
    expect(consumePendingTemplateCaret("Archiv/Plan 2.md")).toEqual({ path: "Archiv/Plan 2.md", offset: note!.length });
    expect(vault.text.get("Archiv/Plan.md")).toBe("schon da");
    expect(reported).toEqual(["Archiv/Plan 2.md"]);
  });

  it("a picked template without a block gets the header in front, with no blank line of the phone's own", async () => {
    const vault = memoryVault();
    await ops.createNoteFromTemplate(vault, "Eingang", "Protokoll", "## Agenda\n\n- {{cursor}}\n");
    const note = vault.text.get("Eingang/Protokoll.md");
    expect(note).toBe("---\ntype: Note\n---\n## Agenda\n\n- \n");
    expect(consumePendingTemplateCaret("Eingang/Protokoll.md")).toEqual({ path: "Eingang/Protokoll.md", offset: note!.length - 1 });
  });

  /**
   * What stands behind the parked caret in the editor that opens the note; ""
   * is its end. The phone's editor is handed `vaultOps.readEditor`'s text: the
   * file with `\n` line ends and without its byte order mark.
   */
  function behindParkedCaret(vault: MemoryVault, path: string): string {
    const parked = consumePendingTemplateCaret(path);
    if (!parked) throw new Error(`no caret was parked for ${path}`);
    return editorTextOf(vault.text.get(path)!).slice(parked.offset);
  }

  // Finding 2026-10-09: the caret was parked as a place in the file. A note
  // keeps the line ends and the mark of its template, the editor holds neither,
  // and the caret stood one character too far right for every line above it.
  it("a rule's template with Windows line ends: the parked caret is a place in the editor's text, with and without a properties block", async () => {
    settings.folderTemplates = [
      { folder: "Projekte", template: "Projekt.md" },
      { folder: "Listen", template: "Liste.md" },
    ];
    const vault = memoryVault({
      "Vorlagen/Projekt.md": "---\r\nstatus: entwurf\r\n---\r\n# {{title}}\r\n\r\n{{cursor}}Text\r\n",
      "Vorlagen/Liste.md": "# {{title}}\r\n\r\n- [ ] {{cursor}}\r\nEnde\r\n",
    });
    const project = await capture(vault, "Projekte");
    expect(vault.text.get(project!)).toBe("---\r\nstatus: entwurf\r\ntype: Note\r\n---\r\n# Notiz 1\r\n\r\nText\r\n");
    expect(behindParkedCaret(vault, project!)).toBe("Text\n");
    const list = await capture(vault, "Listen");
    expect(vault.text.get(list!)).toBe("---\r\ntype: Note\r\n---\r\n# Notiz 1\r\n\r\n- [ ] \r\nEnde\r\n");
    expect(behindParkedCaret(vault, list!)).toBe("\nEnde\n");
  });

  it("a picked template with a byte order mark: the parked caret is a place in the editor's text, with and without a properties block", async () => {
    // Built at run time: the mark is never typed into this file.
    const mark = String.fromCharCode(0xfeff);
    const vault = memoryVault();
    const block = await ops.createNoteFromTemplate(vault, "Eingang", "Plan", `${mark}---\nstatus: entwurf\n---\n# {{title}}\n{{cursor}}Text\n`);
    expect(vault.text.get(block!)).toBe(`${mark}---\nstatus: entwurf\ntype: Note\n---\n# Plan\nText\n`);
    expect(behindParkedCaret(vault, block!)).toBe("Text\n");
    const plain = await ops.createNoteFromTemplate(vault, "Eingang", "Protokoll", `${mark}## Agenda\n\n- {{cursor}}\nEnde\n`);
    expect(vault.text.get(plain!)).toBe(`${mark}---\ntype: Note\n---\n## Agenda\n\n- \nEnde\n`);
    expect(behindParkedCaret(vault, plain!)).toBe("\nEnde\n");
    // Both at once, as a template that was written on Windows by a tool that sets the mark.
    const both = await ops.createNoteFromTemplate(vault, "Eingang", "Brief", `${mark}---\r\nstatus: entwurf\r\n---\r\n# {{title}}\r\n{{cursor}}Text\r\n`);
    expect(vault.text.get(both!)).toBe(`${mark}---\r\nstatus: entwurf\r\ntype: Note\r\n---\r\n# Brief\r\nText\r\n`);
    expect(behindParkedCaret(vault, both!)).toBe("Text\n");
  });

  it("a note made from a link is the same skeleton, next to the note the link stands in", async () => {
    const vault = memoryVault({ "Projekte/Plan.md": "[[Ideen]]" });
    expect(await ops.createNoteFromWikiTarget(vault, "Ideen", "Projekte/Plan.md")).toBe("Projekte/Ideen.md");
    expect(vault.text.get("Projekte/Ideen.md")).toBe("---\ntype: Note\n---\n# Ideen\n");
    // A target that exists is opened, never written.
    expect(await ops.createNoteFromWikiTarget(vault, "Plan", "Projekte/Plan.md")).toBe("Projekte/Plan.md");
    expect(vault.text.get("Projekte/Plan.md")).toBe("[[Ideen]]");
    expect(reported).toEqual(["Projekte/Ideen.md"]);
  });
});

/**
 * "type for new notes" says it is written into every newly created note. The
 * capture button and the note made from a link wrote `Note` whatever it said,
 * and a blank field reached the other notes as an empty `type` (finding
 * 2026-10-09). The desktop writes the configured type in both places and reads
 * a blank setting as an unset one.
 */
describe("the vault's type for new notes reaches the notes the phone makes", () => {
  it("the capture button writes the configured type", async () => {
    settings.defaultNoteType = "Zettel";
    const vault = memoryVault();
    expect(await capture(vault, "Eingang")).toBe("Eingang/Notiz 1.md");
    expect(vault.text.get("Eingang/Notiz 1.md")).toBe("---\ntype: Zettel\n---\n# Notiz 1\n");
    expect(vault.text.get("Eingang/Notiz 1.md")).toBe(buildNewNoteContent("Zettel", "Notiz 1"));
  });

  it("a \"note type → template\" rule for the configured type applies on capture", async () => {
    settings.defaultNoteType = "Zettel";
    settings.typeTemplates = [{ type: "Zettel", template: "Zettel.md" }];
    const vault = memoryVault({ "Vorlagen/Zettel.md": "---\nstatus: neu\n---\n# {{title}}\n\n{{cursor}}Gedanke\n" });
    expect(await capture(vault, "Eingang")).toBe("Eingang/Notiz 1.md");
    const note = vault.text.get("Eingang/Notiz 1.md");
    expect(note).toBe("---\nstatus: neu\ntype: Zettel\n---\n# Notiz 1\n\nGedanke\n");
    expect(consumePendingTemplateCaret("Eingang/Notiz 1.md")).toEqual({ path: "Eingang/Notiz 1.md", offset: note!.indexOf("Gedanke") });
  });

  it("a rule for another type does not apply on capture", async () => {
    settings.defaultNoteType = "Zettel";
    settings.typeTemplates = [{ type: "Note", template: "Notiz.md" }];
    const vault = memoryVault({ "Vorlagen/Notiz.md": "# {{title}}\n\nAus der Vorlage\n" });
    await capture(vault, "Eingang");
    expect(vault.text.get("Eingang/Notiz 1.md")).toBe("---\ntype: Zettel\n---\n# Notiz 1\n");
  });

  it("a note made from a link carries the configured type", async () => {
    settings.defaultNoteType = "Zettel";
    const vault = memoryVault({ "Projekte/Plan.md": "[[Ideen]]" });
    expect(await ops.createNoteFromWikiTarget(vault, "Ideen", "Projekte/Plan.md")).toBe("Projekte/Ideen.md");
    expect(vault.text.get("Projekte/Ideen.md")).toBe("---\ntype: Zettel\n---\n# Ideen\n");
  });

  it("a picked template carries the configured type", async () => {
    settings.defaultNoteType = "Zettel";
    const vault = memoryVault();
    await ops.createNoteFromTemplate(vault, "Eingang", "Protokoll", "## Agenda\n");
    expect(vault.text.get("Eingang/Protokoll.md")).toBe("---\ntype: Zettel\n---\n## Agenda\n");
  });

  describe.each([["empty", ""], ["blanks only", "   "]])("a setting that is %s is an unset one", (_name, blank) => {
    beforeEach(() => {
      settings.defaultNoteType = blank;
      settings.dailyNoteType = blank;
    });

    it("for the capture button", async () => {
      const vault = memoryVault();
      await capture(vault, "Eingang");
      expect(vault.text.get("Eingang/Notiz 1.md")).toBe("---\ntype: Note\n---\n# Notiz 1\n");
    });

    it("for the capture button's type rules", async () => {
      settings.typeTemplates = [{ type: "Note", template: "Notiz.md" }];
      const vault = memoryVault({ "Vorlagen/Notiz.md": "# {{title}}\n\nAus der Vorlage\n" });
      await capture(vault, "Eingang");
      expect(vault.text.get("Eingang/Notiz 1.md")).toBe("---\ntype: Note\n---\n# Notiz 1\n\nAus der Vorlage\n");
    });

    it("for a note made from a link", async () => {
      const vault = memoryVault();
      await ops.createNoteFromWikiTarget(vault, "Ideen");
      expect(vault.text.get("Ideen.md")).toBe("---\ntype: Note\n---\n# Ideen\n");
    });

    it("for a picked template", async () => {
      const vault = memoryVault();
      await ops.createNoteFromTemplate(vault, "Eingang", "Protokoll", "## Agenda\n");
      expect(vault.text.get("Eingang/Protokoll.md")).toBe("---\ntype: Note\n---\n## Agenda\n");
    });

    it("for the daily note", async () => {
      const vault = memoryVault();
      const daily = await ops.ensureDailyNote(vault, new Date(2026, 9, 11), "headless");
      expect(daily).toMatchObject({ path: "2026-10-11.md", created: true });
      expect(vault.text.get("2026-10-11.md")).toBe("---\ntype: Daily Note\n---\n# 2026-10-11\n");
    });
  });

  it("blanks around the name are not part of the type", async () => {
    settings.defaultNoteType = "  Zettel ";
    settings.dailyNoteType = " Tagebuch  ";
    const vault = memoryVault();
    await capture(vault, "Eingang");
    await ops.createNoteFromWikiTarget(vault, "Ideen");
    await ops.createNoteFromTemplate(vault, "Eingang", "Protokoll", "## Agenda\n");
    await ops.ensureDailyNote(vault, new Date(2026, 9, 11), "headless");
    expect(vault.text.get("Eingang/Notiz 1.md")).toBe("---\ntype: Zettel\n---\n# Notiz 1\n");
    expect(vault.text.get("Ideen.md")).toBe("---\ntype: Zettel\n---\n# Ideen\n");
    expect(vault.text.get("Eingang/Protokoll.md")).toBe("---\ntype: Zettel\n---\n## Agenda\n");
    expect(vault.text.get("2026-10-11.md")).toBe("---\ntype: Tagebuch\n---\n# 2026-10-11\n");
  });

  it("the daily note carries the configured type for daily notes, and a template's own type wins", async () => {
    settings.dailyNoteType = "Tagebuch";
    const vault = memoryVault();
    await ops.ensureDailyNote(vault, new Date(2026, 9, 11), "headless");
    expect(vault.text.get("2026-10-11.md")).toBe("---\ntype: Tagebuch\n---\n# 2026-10-11\n");
    // The type for new notes is not the type of a daily note.
    settings.defaultNoteType = "Zettel";
    await ops.ensureDailyNote(vault, new Date(2026, 9, 12), "headless");
    expect(vault.text.get("2026-10-12.md")).toBe("---\ntype: Tagebuch\n---\n# 2026-10-12\n");
    // A template that names its type keeps it.
    await ops.createNoteFromTemplate(vault, "Eingang", "Protokoll", "---\ntype: Protokoll\n---\n## Agenda\n");
    expect(vault.text.get("Eingang/Protokoll.md")).toBe("---\ntype: Protokoll\n---\n## Agenda\n");
  });
});
