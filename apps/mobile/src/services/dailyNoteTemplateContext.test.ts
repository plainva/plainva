import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { clearPendingTemplateCaret, ensureDailyNote, parkTemplateCaret, setPlatformServices } from "@plainva/ui";

const SETTINGS = { dailyFolder: "Journal", dailyFormat: "YYYY-MM-DD", templateFolder: "Vorlagen", dailyTemplate: "Tag.md", folderTemplates: [], typeTemplates: [] };
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => SETTINGS }));
vi.mock("./mobileDialogs", () => ({ mTemplateAnswers: vi.fn(async () => ({})) }));
vi.mock("./editorSelection", () => ({ readEditorSelection: () => null }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "v1", name: "Notizen" }) }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (_key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? "" } }));

import { applyTemplateInteractive } from "./templateInteractive";

/**
 * The phone's daily note and the template it is made from (Sammelplan § 3.97,
 * findings 2026-10-11).
 *
 * `vaultOps.ensureDailyNote` gave the template neither `{{daily-1}}` nor
 * `{{daily+1}}`: "Tageseintrag" with the daily-note template the app ships —
 * whose first line is exactly that — wrote both tokens into the note as text,
 * whether a person opened the note or the journal capture created it. The
 * capture's way also counted `{{weekday:…}}` from Monday. The desktop gave the
 * daily links on both of its ways; the week start it gave on neither of them
 * (`apps/desktop/src/dailyNoteTemplateContext.test.tsx`).
 *
 * `vaultService.ts` boots the native vault when it is imported, so the method
 * is read from its source and run against a vault in memory, with the shared
 * block and the phone's real pipeline behind it.
 */

interface MemoryVault {
  text: Map<string, string>;
  files: { exists(path: string): Promise<boolean> };
}
type Ops = { ensureDailyNote(v: MemoryVault, date: Date, mode?: "interactive" | "headless"): Promise<{ path: string; created: boolean } | null> };

function phoneOps(): Ops {
  const file = ts.createSourceFile("vaultService.ts", readFileSync(resolve("src/services/vaultService.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  let method: string | null = null;
  const visit = (node: ts.Node) => {
    if (
      ts.isMethodDeclaration(node) &&
      node.name.getText(file) === "ensureDailyNote" &&
      ts.isObjectLiteralExpression(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent) &&
      node.parent.parent.name.getText(file) === "vaultOps"
    ) method = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!method) throw new Error("vaultOps.ensureDailyNote is gone from vaultService.ts — re-point this test");
  const code = ts.transpileModule(
    `const vaultOps = {
      async read(v, path) { return v.text.get(path); },
      async save(v, path, text) { v.text.set(path, text); },
      ${method}
    };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  // What the method reaches for: the shared block and the phone's pipeline are
  // the real ones; the vault, its name and the creation report are not.
  const scope = {
    getMobileSettings: () => SETTINGS,
    getActiveVaultEntry: async () => ({ name: "Notizen" }),
    ensureSharedDailyNote: ensureDailyNote,
    configuredDailyNoteType: () => "Daily Note",
    applyTemplateInteractive,
    reportCreated: () => {},
    parkTemplateCaret,
  };
  return new Function(...Object.keys(scope), `${code}\nreturn vaultOps;`)(...Object.values(scope)) as Ops;
}

/** The first line is the one of the daily-note template the app ships. */
const TEMPLATE = "{{daily-1}} · {{date}} · {{daily+1}}\nMontag: {{weekday:monday}}\nVault: {{vault}}\n";
/** The daily note for Sunday, 2026-10-11, with the week starting on Sunday. */
const NOTE = "---\ntype: Daily Note\n---\n[[Journal/2026-10-10]] · 2026-10-11 · [[Journal/2026-10-12]]\nMontag: 2026-10-12\nVault: Notizen\n";

function memoryVault(): MemoryVault {
  const text = new Map([["Vorlagen/Tag.md", TEMPLATE]]);
  return { text, files: { exists: async (path) => text.has(path) } };
}

beforeEach(() => {
  clearPendingTemplateCaret();
  setPlatformServices({
    loadSettings: async () => ({ get: async (key: string) => (key === "calendarWeekStart" ? "sunday" : null) }),
    credentials: {},
    openExternal: async () => {},
  } as never);
});
afterEach(() => setPlatformServices(null as never));

describe("the phone's daily note gets what its template names", () => {
  it("opened by a person: the daily links of the note's day, and the week start", async () => {
    const vault = memoryVault();
    const made = await phoneOps().ensureDailyNote(vault, new Date(2026, 9, 11), "interactive");
    expect(made).toMatchObject({ path: "Journal/2026-10-11.md", created: true });
    expect(vault.text.get("Journal/2026-10-11.md")).toBe(NOTE);
  });

  it("created on the way by the journal capture: the same note", async () => {
    const vault = memoryVault();
    await phoneOps().ensureDailyNote(vault, new Date(2026, 9, 11), "headless");
    expect(vault.text.get("Journal/2026-10-11.md")).toBe(NOTE);
  });
});
