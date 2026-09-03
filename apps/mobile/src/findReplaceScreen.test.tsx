// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices } from "@plainva/ui";
import { FindReplaceScreen } from "./screens/FindReplaceScreen";

/**
 * Vault-wide find & replace on the phone (P5).
 *
 * Asserts the two decisions the touch surface exists for, as BEHAVIOUR:
 *
 *  - hits are grouped per note and collapsed, and only ONE group opens at a
 *    time — on 375 px a note with forty hits would otherwise bury the action
 *    bar under itself;
 *  - deselection is per NOTE, and the docked button names its own scope, so
 *    the destructive action always says how far it reaches.
 *
 * The replace path itself is pinned in vaultReplace.test.ts (shared core); what
 * matters here is that this screen hands it exactly the selected notes.
 */

const files: Record<string, string> = {};
const saved: Record<string, string> = {};

vi.mock("./services/vaultService", () => ({
  vaultOps: {
    read: vi.fn(async (_v: unknown, p: string) => files[p]),
    save: vi.fn(async (_v: unknown, p: string, c: string) => {
      saved[p] = c;
      files[p] = c;
    }),
  },
}));

const match = (lineText: string) => ({ line: 1, start: 0, end: 5, lineText });

const findInVault = vi.fn(async () => [
  {
    path: "a.md",
    title: "Alpha",
    matchCount: 2,
    matches: [match("alpha one"), match("alpha two")],
  },
  { path: "b.md", title: "Beta", matchCount: 1, matches: [match("alpha three")] },
]);

const vault = { queryService: { findInVault } } as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  for (const k of Object.keys(saved)) delete saved[k];
  files["a.md"] = "alpha one\nalpha two";
  files["b.md"] = "alpha three";
  findInVault.mockClear();
  setPlatformServices({
    loadSettings: async () => ({
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      keys: async () => [],
      save: async () => {},
    }),
    credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const click = async (sel: string) => {
  await act(async () => {
    q(sel)?.click();
  });
};

const search = async () => {
  const input = q('[data-testid="fr-find-input"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "alpha");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click('[data-testid="fr-find"]');
  await act(async () => {});
};

const render = async () => {
  await act(async () => {
    root.render(<FindReplaceScreen onBack={() => {}} onOpenNote={() => {}} vault={vault} />);
  });
  await act(async () => {});
};

describe("find & replace on the phone", () => {
  it("groups hits per note and keeps them collapsed", async () => {
    await render();
    await search();
    expect(q('[data-testid="fr-group-a.md"]')).not.toBeNull();
    expect(q('[data-testid="fr-group-b.md"]')).not.toBeNull();
    // Two notes, three hits — but no hit line is on screen yet.
    expect(container.textContent).not.toContain("alpha one");
  });

  it("opens one group at a time", async () => {
    await render();
    await search();
    await click('[data-testid="fr-group-a.md"]');
    expect(container.textContent).toContain("alpha one");
    await click('[data-testid="fr-group-b.md"]');
    expect(container.textContent).toContain("alpha three");
    expect(container.textContent).not.toContain("alpha one");
  });

  it("replaces only the notes left selected", async () => {
    await render();
    await search();
    await click('[data-testid="fr-toggle-a.md"]'); // deselect Alpha
    await click('[data-testid="fr-replace"]');
    await act(async () => {});
    expect(Object.keys(saved)).toEqual(["b.md"]);
    // The report survives the list refresh that follows the replace (P6): it
    // used to be wiped by the re-run before anyone could read it.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(q('[data-testid="fr-status"]')?.textContent ?? "").not.toBe("");
  });

  it("will not replace when nothing is selected", async () => {
    await render();
    await search();
    await click('[data-testid="fr-select-all"]'); // all -> none
    const btn = q('[data-testid="fr-replace"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
