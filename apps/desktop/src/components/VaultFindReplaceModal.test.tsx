// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { findMatchesInText, type FindReplaceOptions, type VaultFindResult } from "@plainva/core";

/**
 * The vault-wide find & replace dialog after its rebuild on the primitives
 * (finding 2026-09-01, D1 / P6). What is pinned here is what the mockup
 * added, not the styling: every hit shows a before AND an after row, an
 * invalid regex is named at the field instead of answering with an empty
 * list, the empty state says what to try next, and the replace writes
 * through the shared helper and reports.
 *
 * The shell is mocked (context); the shared search/replace helpers run for
 * real against an in-memory vault.
 */
const notes = new Map<string, string>();
const findInVault = async (query: string, opts: FindReplaceOptions = {}): Promise<VaultFindResult[]> => {
  const out: VaultFindResult[] = [];
  for (const [path, content] of notes) {
    const matches = findMatchesInText(content, query, opts);
    if (matches.length) out.push({ path, title: path.replace(/\.md$/, ""), matchCount: matches.length, matches });
  }
  return out;
};
const vaultContext = {
  vaultPath: "/vaults/Arbeit",
  triggerFileTreeUpdate: () => {},
  queryService: { findInVault },
  vaultAdapter: {
    readTextFile: async (p: string) => notes.get(p) ?? "",
    writeTextFile: async (p: string, c: string) => { notes.set(p, c); },
  },
};
vi.mock("../contexts/VaultContext", () => ({ useVault: () => vaultContext }));
import { VaultFindReplaceModal } from "./VaultFindReplaceModal";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const opened: string[] = [];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  notes.clear();
  opened.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = <T extends HTMLElement>(sel: string) => document.body.querySelector<T>(sel);
const qa = (sel: string) => Array.from(document.body.querySelectorAll<HTMLElement>(sel));
// A macrotask: the replace awaits a chain of reads and writes before it reports.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function mount() {
  await act(async () => {
    root.render(<VaultFindReplaceModal onClose={() => {}} onOpenPath={(p) => opened.push(p)} />);
  });
  await flush();
}
async function type(testId: string, value: string) {
  const el = q<HTMLInputElement>(`[data-testid="${testId}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(testId: string) {
  await act(async () => { q<HTMLElement>(`[data-testid="${testId}"]`)!.click(); });
  await flush();
}

describe("VaultFindReplaceModal", () => {
  it("previews every hit with a before and an after row, grouped by note", async () => {
    notes.set("Projekte/Migration.md", "Die Projektleitung entscheidet.\nRückfragen an die Projektleitung.\n");
    notes.set("Team.md", "Keine Treffer hier.\n");
    await mount();
    await type("fr-find-input", "Projektleitung");
    await type("fr-replace-input", "Projektsteuerung");
    await click("fr-find");
    expect(q('[data-testid="fr-summary"]')?.textContent).toBe("2 matches in 1 notes");
    expect(q('[data-testid="fr-selected"]')?.textContent).toBe("1 selected");
    expect(qa('[data-testid="fr-group"]')).toHaveLength(1);
    const hits = qa('[data-testid="fr-hit"]');
    expect(hits).toHaveLength(2);
    expect(hits[0].querySelector('[data-testid="fr-before"] .pv-fr-mark--hit')?.textContent).toBe("Projektleitung");
    expect(hits[0].querySelector('[data-testid="fr-after"] .pv-fr-mark--new')?.textContent).toBe("Projektsteuerung");
    expect(hits[1].querySelector('[data-testid="fr-after"]')?.textContent).toBe("Rückfragen an die Projektsteuerung.");
  });

  it("names an invalid regular expression at the field and does not search", async () => {
    notes.set("a.md", "(text)\n");
    await mount();
    await click("fr-opt-regex");
    await type("fr-find-input", "(");
    expect(q('[data-testid="fr-regex-error"]')).not.toBeNull();
    expect(q<HTMLButtonElement>('[data-testid="fr-find"]')?.disabled).toBe(true);
    expect(q('[data-testid="fr-find-input"]')?.getAttribute("aria-invalid")).toBe("true");
    // A usable expression clears it and searches with the groups expanded.
    await type("fr-find-input", "\\((\\w+)\\)");
    await type("fr-replace-input", "[$1]");
    expect(q('[data-testid="fr-regex-error"]')).toBeNull();
    await click("fr-find");
    expect(q('[data-testid="fr-after"]')?.textContent).toBe("[text]");
  });

  it("says what to try when nothing matches, naming the option that is on", async () => {
    notes.set("a.md", "projektleitung\n");
    await mount();
    await click("fr-opt-case");
    await type("fr-find-input", "Projektleitung");
    await click("fr-find");
    expect(q('[data-testid="fr-results"]')).toBeNull();
    const empty = q(".pv-empty")?.textContent ?? "";
    expect(empty).toContain("No matches");
    expect(empty).toContain("“Projektleitung” appears in no note");
    expect(empty).toContain("Or turn off “Match case”.");
  });

  it("replaces only in the selected notes and reports the count", async () => {
    notes.set("a.md", "alt alt\n");
    notes.set("b.md", "alt\n");
    await mount();
    await type("fr-find-input", "alt");
    await type("fr-replace-input", "neu");
    await click("fr-find");
    // Deselect b through its row checkbox.
    const boxes = qa('[data-testid="fr-group"] input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    await act(async () => { (boxes[1] as HTMLInputElement).click(); });
    expect(q('[data-testid="fr-selected"]')?.textContent).toBe("1 selected");
    await click("fr-replace");
    await flush();
    expect(notes.get("a.md")).toBe("neu neu\n");
    expect(notes.get("b.md")).toBe("alt\n");
    expect(q('[data-testid="fr-status"]')?.textContent).toBe("Replaced 2 matches in 1 notes");
    // The list was re-run: only b still matches.
    expect(qa('[data-testid="fr-group"]')).toHaveLength(1);
  });

  it("opens a note from its path and never through a raw button", async () => {
    notes.set("Ordner/Notiz.md", "x\n");
    await mount();
    await type("fr-find-input", "x");
    await click("fr-find");
    await act(async () => { q<HTMLElement>(".pv-fr-open")!.click(); });
    expect(opened).toEqual(["Ordner/Notiz.md"]);
    expect(q(".pv-fr-open")?.classList.contains("pv-btn")).toBe(true);
  });
});
