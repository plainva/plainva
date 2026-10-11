import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Rule {
  folder: string;
  template: string;
}
const settings = {
  templateFolder: "Vorlagen",
  folderTemplates: [] as Rule[],
  typeTemplates: [],
  defaultNoteType: "Note",
  dailyFormat: "YYYY-MM-DD",
  dailyFolder: "",
};
vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./services/mobileDialogs", () => ({ mTemplateAnswers: vi.fn() }));
vi.mock("./services/editorSelection", () => ({ readEditorSelection: () => null }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? "" } }));

import { editorTextOf } from "@plainva/core";
import { buildNewNoteContent, clearPendingTemplateCaret, consumePendingTemplateCaret, parkTemplateCaret, wikiTargetToPath } from "@plainva/ui";
import { buildNewNoteFromTemplate, buildNewNoteFromTemplateText } from "./services/templateInteractive";

/**
 * Three ways the phone makes a note out of nothing: the capture button
 * (`vaultOps.createNote`), "New note from a template"
 * (`createNoteFromTemplate`), and a tap on a link to a note that does not exist
 * yet (`createNoteFromWikiTarget`).
 *
 * Each had the OKF header as a string of its own until 2026-10-09, with a
 * blank line behind it; the two template-less ones wrote two more below the
 * heading. What they write now is the shared skeleton and the shared template
 * builder — the same bytes the desktop writes.
 *
 * `vaultService.ts` boots the native vault when it is imported, so the three
 * methods are read from its source and run against a vault in memory, with the
 * real builders behind them. A method that goes back to a text of its own, or
 * reaches for something this scope does not hand it, fails here.
 */

interface MemoryVault {
  text: Map<string, string>;
  files: { exists(path: string): Promise<boolean> };
}

interface CreationOps {
  createNote(v: MemoryVault, folder: string, type: string): Promise<string | null>;
  createNoteFromTemplate(v: MemoryVault, folder: string, title: string, templateRaw: string): Promise<string | null>;
  createNoteFromWikiTarget(v: MemoryVault, target: string, hostPath?: string): Promise<string | null>;
}

const reported: string[] = [];

function creationOps(): CreationOps {
  const file = ts.createSourceFile("vaultService.ts", readFileSync("src/services/vaultService.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const wanted = ["createNote", "createNoteFromTemplate", "createNoteFromWikiTarget"];
  const methods = new Map<string, string>();
  const ofVaultOps = (node: ts.MethodDeclaration) =>
    ts.isObjectLiteralExpression(node.parent) && ts.isVariableDeclaration(node.parent.parent) && node.parent.parent.name.getText(file) === "vaultOps";
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && wanted.includes(node.name.getText(file)) && ofVaultOps(node)) methods.set(node.name.getText(file), node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const name of wanted) if (!methods.has(name)) throw new Error(`vaultOps.${name} is gone from vaultService.ts`);
  const code = ts.transpileModule(
    `const vaultOps = {
      async read(v, path) { return v.text.get(path); },
      async save(v, path, text) { v.text.set(path, text); },
      ${[...methods.values()].join(",\n")}
    };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  // Everything the three methods may reach for. The builders and the caret
  // store are the real ones; only the vault, the catalog and the report are not.
  const scope = {
    i18n: { t: (_key: string, o: { n: number }) => `Notiz ${o.n}` },
    buildNewNoteFromTemplate,
    buildNewNoteFromTemplateText,
    buildNewNoteContent,
    getActiveVaultEntry: async () => ({ name: "Vault" }),
    getMobileSettings: () => settings,
    reportCreated: (path: string) => void reported.push(path),
    // The one way to park a caret since 2026-10-09: with the note it counts in.
    parkTemplateCaret,
    wikiTargetToPath,
  };
  return new Function(...Object.keys(scope), `${code}\nreturn vaultOps;`)(...Object.values(scope)) as CreationOps;
}

function memoryVault(files: Record<string, string> = {}): MemoryVault {
  const text = new Map(Object.entries(files));
  return { text, files: { exists: async (path) => text.has(path) } };
}

describe("the phone's new notes, as its three creation paths write them", () => {
  const ops = creationOps();

  beforeEach(() => {
    settings.folderTemplates = [];
    reported.length = 0;
    clearPendingTemplateCaret();
  });

  it("the capture button's note is the shared skeleton: header, heading, nothing else", async () => {
    const vault = memoryVault();
    const path = await ops.createNote(vault, "Eingang", "Note");
    expect(path).toBe("Eingang/Notiz 1.md");
    expect(vault.text.get("Eingang/Notiz 1.md")).toBe("---\ntype: Note\n---\n# Notiz 1\n");
    // The bytes the desktop writes for a new note.
    expect(vault.text.get("Eingang/Notiz 1.md")).toBe(buildNewNoteContent("Note", "Notiz 1"));
    expect(await ops.createNote(vault, "Eingang", "Note")).toBe("Eingang/Notiz 2.md");
    expect(reported).toEqual(["Eingang/Notiz 1.md", "Eingang/Notiz 2.md"]);
    expect(consumePendingTemplateCaret("Eingang/Notiz 1.md")).toBeNull();
  });

  it("with a rule's template the capture button writes `type` into the template's block and parks the caret", async () => {
    settings.folderTemplates = [{ folder: "Projekte", template: "Projekt.md" }];
    const vault = memoryVault({ "Vorlagen/Projekt.md": "---\nstatus: entwurf\n---\n# {{title}}\n\n{{cursor}}Text\n" });
    const path = await ops.createNote(vault, "Projekte", "Note");
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
    const project = await ops.createNote(vault, "Projekte", "Note");
    expect(vault.text.get(project!)).toBe("---\r\nstatus: entwurf\r\ntype: Note\r\n---\r\n# Notiz 1\r\n\r\nText\r\n");
    expect(behindParkedCaret(vault, project!)).toBe("Text\n");
    const list = await ops.createNote(vault, "Listen", "Note");
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
