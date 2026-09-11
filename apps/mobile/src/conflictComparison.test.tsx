// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConflictCompareSheet } from "./components/ConflictCompareSheet";
import type { MobileVault } from "./services/vaultService";

const state = vi.hoisted(() => ({ files: new Map<string, string>(), confirm: async () => true }));
vi.mock("./services/mobileDialogs", () => ({ mConfirm: async () => state.confirm() }));
vi.mock("./services/conflictState", () => ({ clearConflict: vi.fn() }));
vi.mock("./services/syncService", () => ({ syncSoon: vi.fn() }));
vi.mock("./services/vaultRegistry", () => ({ getVaultEntry: async () => ({ id: "vault", name: "Work vault" }) }));
vi.mock("./services/vaultService", () => ({
  noteSaver: { flush: async () => {} },
  vaultOps: {
    read: async (_v: unknown, p: string) => state.files.get(p)!,
    save: async (_v: unknown, p: string, content: string) => { state.files.set(p, content); },
    remove: async (_v: unknown, p: string) => { state.files.delete(p); },
  },
}));
const files = {
  exists: async (p: string) => state.files.has(p),
  readTextFile: async (p: string) => state.files.get(p)!,
  writeTextFile: async (p: string, c: string) => { state.files.set(p, c); },
  deleteItem: async (p: string) => { state.files.delete(p); },
  renameItem: async (p: string, target: string) => { state.files.set(target, state.files.get(p)!); state.files.delete(p); },
  getFileInfo: async () => ({ mtime: 123456 }),
};
const vault = { vaultId: "vault", adapter: files, files, reindexPaths: async () => {} } as unknown as MobileVault;
const original = "Projects/Deep folder/Daily.md", copy = "Projects/Deep folder/Daily.CONFLICT-2026-09-11.md";
let host: HTMLDivElement, root: Root;
const resolved = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.files.clear(); state.confirm = async () => true; resolved.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render() { await act(async () => { root.render(<ConflictCompareSheet vault={vault} originalPath={original} conflictPath={copy} onClose={() => {}} onResolved={resolved} />); }); }
async function click(id: string) { await act(async () => { (host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click(); }); }

describe("the real mobile file comparison", () => {
  it("shows both complete paths and replaces exactly the original with the copy", async () => {
    state.files.set(original, "old"); state.files.set(copy, "replacement");
    await render();
    expect(host.textContent).toContain(original); expect(host.textContent).toContain(copy); expect(host.textContent).toContain("Work vault");
    await click("compare-adopt");
    expect(state.files.get(original)).toBe("replacement"); expect(state.files.has(copy)).toBe(false); expect(resolved).toHaveBeenCalledTimes(1);
  });
  it("reloads after a change during confirmation without changing either file", async () => {
    state.files.set(original, "old"); state.files.set(copy, "copy");
    state.confirm = async () => { state.files.set(original, "new edit"); return true; };
    await render(); await click("compare-adopt");
    expect(state.files.get(original)).toBe("new edit"); expect(state.files.get(copy)).toBe("copy"); expect(resolved).not.toHaveBeenCalled();
  });
  it("offers only separation for different task identities and preserves both full contents", async () => {
    const task = (id: string) => `---\nFrist: 2026-09-11\nStatus: Offen\nplainva:\n  pim:\n    kind: task\n    provider: google\n    identity: google:subject\n    list: Daily\n    uid: ${id}\n---\n# Daily\nUser text\n`;
    state.files.set(original, task("a")); state.files.set(copy, task("b"));
    await render();
    expect(host.querySelector('[data-testid="compare-adopt"]')).toBeNull(); expect(host.querySelector('[data-testid="compare-discard"]')).toBeNull();
    expect(host.textContent).toContain("Frist: 2026-09-11");
    await click("compare-keep-both");
    expect([...state.files.values()].sort()).toEqual([task("a"), task("b")].sort()); expect(state.files.has(copy)).toBe(false);
  });
});
