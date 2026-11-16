// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";

/**
 * The number cell of a database (issue 170, same class as the file tree's
 * name field): Enter saved, and the focus loss that follows saved again. The
 * cell now commits through its blur only — one Enter, then the blur, is one
 * write. The hook, the property writer and the vault map run for real.
 */

const files = new Map<string, string>();
const writes: string[] = [];
const vaultAdapter = {
  async readTextFile(path: string): Promise<string> {
    const text = files.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  async writeTextFile(path: string, content: string): Promise<void> {
    writes.push(path);
    files.set(path, content);
  },
};
const queryService = new Proxy({} as Record<string, unknown>, { get: (known, name: string) => known[name] ?? (async () => []) });

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultAdapter, queryService, vaultPath: "/vault", indexer: null, fileTreeVersion: 0, triggerFileTreeUpdate: () => {} }),
}));
vi.mock("../../hooks/useWikiResolver", () => ({ useWikiResolver: () => null }));
vi.mock("../../services/newNote", () => ({
  buildNewNoteContent: () => "",
  getConfiguredNoteType: async () => "Note",
}));

import { useBaseCells } from "./useBaseCells";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG = { columns: { count: { input: "number" } } };
const NOTE = "Items/A.md";

function Cell() {
  const [dbData, setDbData] = useState<any[]>([{ "file.path": NOTE, "file.name": "A", count: 5 }]);
  const cells = useBaseCells({ dbConfig: CONFIG, dbData, setDbData });
  const row = dbData[0];
  return <div data-testid="cell">{cells.renderEditableCell(row, "count", row.count, String(row.count))}</div>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  files.clear();
  writes.length = 0;
  files.set(NOTE, "---\ncount: 5\n---\nA\n");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Cell />); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the number cell of a database saves once (issue 170)", () => {
  it("Enter, then the focus loss right after it: one write", async () => {
    await act(async () => { container.querySelector<HTMLElement>("[data-testid=cell] > div")!.click(); });
    const input = container.querySelector<HTMLInputElement>("input")!;
    expect(input.type).toBe("number");
    input.focus();
    await act(async () => typeInto(input, "7"));
    // Both in one turn, before the cell renders again: what a click elsewhere right after Enter does.
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      // A click elsewhere: takes the focus only if the field still has it.
      input.blur();
    });
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
    expect(writes).toEqual([NOTE]);
    expect(files.get(NOTE)).toContain("count: 7");
  });
});
