// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NotTextFileError } from "@plainva/core";
import { ConflictCompareSheet } from "./components/ConflictCompareSheet";
import type { MobileVault } from "./services/vaultService";

// A file is a text, or bytes that are not UTF-8 — what the vault refuses to read as text.
const state = vi.hoisted(() => ({ files: new Map<string, string | Uint8Array>(), confirm: async () => true }));
vi.mock("./services/mobileDialogs", () => ({ mConfirm: async () => state.confirm() }));
vi.mock("./services/conflictState", () => ({ clearConflict: vi.fn() }));
vi.mock("./services/syncService", () => ({ syncSoon: vi.fn() }));
vi.mock("./services/vaultRegistry", () => ({ getVaultEntry: async () => ({ id: "vault", name: "Work vault" }) }));
const textOf = (p: string): string => {
  const held = state.files.get(p)!;
  if (typeof held !== "string") throw new NotTextFileError(p);
  return held;
};
vi.mock("./services/vaultService", () => ({
  noteSaver: { flush: async () => {} },
  vaultOps: {
    read: async (_v: unknown, p: string) => textOf(p),
    save: async (_v: unknown, p: string, content: string) => { state.files.set(p, content); },
    remove: async (_v: unknown, p: string) => { state.files.delete(p); },
  },
}));
const files = {
  exists: async (p: string) => state.files.has(p),
  readTextFile: async (p: string) => textOf(p),
  readBinaryFile: async (p: string) => { const held = state.files.get(p)!; return typeof held === "string" ? new TextEncoder().encode(held) : held; },
  writeTextFile: async (p: string, c: string) => { state.files.set(p, c); },
  writeBinaryFile: async (p: string, bytes: Uint8Array) => { state.files.set(p, new Uint8Array(bytes)); },
  deleteItem: async (p: string) => { state.files.delete(p); },
  renameItem: async (p: string, target: string) => { state.files.set(target, state.files.get(p)!); state.files.delete(p); },
  getFileInfo: async () => ({ mtime: 123456 }),
};
const forceBackup = vi.fn(async (_path: string) => {});
const vault = { vaultId: "vault", adapter: files, files, backup: { forceBackup }, reindexPaths: async () => {} } as unknown as MobileVault;
const original = "Projects/Deep folder/Daily.md", copy = "Projects/Deep folder/Daily.CONFLICT-2026-09-11.md";
let host: HTMLDivElement, root: Root;
const resolved = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.files.clear(); state.confirm = async () => true; resolved.mockClear(); forceBackup.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(originalPath = original, conflictPath = copy) {
  await act(async () => { root.render(<ConflictCompareSheet vault={vault} originalPath={originalPath} conflictPath={conflictPath} onClose={() => {}} onResolved={resolved} />); });
}
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

/** "id;name / 1;Grün" in Windows-1252, and a copy of it with one more row: no UTF-8 in either. */
const TABLE = Uint8Array.from([0x69, 0x64, 0x3b, 0x6e, 0x0a, 0x31, 0x3b, 0x47, 0x72, 0xfc, 0x6e, 0x0a]);
const TABLE_COPY = Uint8Array.from([...TABLE, 0x32, 0x3b, 0x57, 0x65, 0x69, 0xdf, 0x0a]);
const table = "Projects/Data.csv", tableCopy = "Projects/Data.CONFLICT-2026-10-11T08-00-00-000Z.csv";

/**
 * Waits, inside `act`, until `check` holds. The byte-wise exits hash both
 * files (`crypto.subtle`), which resolves after `act` has flushed its own
 * work: a test that looked at once saw nothing done yet, and what was still
 * running reached into the next test.
 */
async function until(check: () => void) {
  await act(async () => { await vi.waitFor(check); });
}
/** The sheet has seen the bytes of both files: its exits are there. */
async function renderSeen() {
  await render(table, tableCopy);
  await until(() => expect(host.querySelector('[data-testid="compare-adopt"]')).not.toBeNull());
}

describe("the mobile comparison of a file that is no text (finding 2026-10-11)", () => {
  it("shows nothing of either file, and taking the copy puts it in the file's place byte for byte — the file kept as a version first, and its open editor told", async () => {
    state.files.set(table, TABLE); state.files.set(tableCopy, TABLE_COPY);
    const told: Array<{ vaultId?: string; path?: string }> = [];
    const hear = (event: Event) => told.push((event as CustomEvent<{ vaultId?: string; path?: string }>).detail);
    window.addEventListener("m-external-update", hear);
    try {
      await renderSeen();
      expect(host.querySelector('[data-testid="compare-not-text"]')).not.toBeNull();
      expect(host.textContent).not.toContain("Grün");
      expect(told).toEqual([]);
      await click("compare-adopt");
      await until(() => expect(resolved).toHaveBeenCalled());
      expect(forceBackup).toHaveBeenCalledWith(table);
      expect(state.files.get(table)).toEqual(TABLE_COPY); expect(state.files.has(tableCopy)).toBe(false);
      expect(resolved).toHaveBeenCalledWith([table, tableCopy]);
      // The note screen and its editor hear that the file changed under them.
      expect(told.map((detail) => detail.path)).toContain(table);
    } finally {
      window.removeEventListener("m-external-update", hear);
    }
  });
  it("keeps the copy as a file of its own, as it lies there", async () => {
    state.files.set(table, TABLE); state.files.set(tableCopy, TABLE_COPY);
    await renderSeen();
    await click("compare-keep-both");
    await until(() => expect(resolved).toHaveBeenCalled());
    const kept = [...state.files.keys()].find((p) => p !== table)!;
    expect(kept).not.toBe(tableCopy); expect(state.files.get(kept)).toEqual(TABLE_COPY); expect(state.files.get(table)).toEqual(TABLE);
    expect(resolved).toHaveBeenCalledWith([tableCopy, kept]);
  });
  it("lets the copy go, and leaves the file as it lies", async () => {
    state.files.set(table, TABLE); state.files.set(tableCopy, TABLE_COPY);
    await renderSeen();
    await click("compare-discard");
    await until(() => expect(resolved).toHaveBeenCalled());
    expect(state.files.has(tableCopy)).toBe(false); expect(state.files.get(table)).toEqual(TABLE); expect(resolved).toHaveBeenCalledWith([tableCopy]);
  });
  it("changes nothing where the copy changed after it was seen", async () => {
    const failed = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      state.files.set(table, TABLE); state.files.set(tableCopy, TABLE_COPY);
      state.confirm = async () => { state.files.set(tableCopy, Uint8Array.from([...TABLE_COPY, 0x0a])); return true; };
      await renderSeen();
      await click("compare-adopt");
      await until(() => expect(failed).toHaveBeenCalledWith("[ConflictCompareSheet] resolving failed", expect.objectContaining({ message: "comparisonChanged" })));
      expect(state.files.get(table)).toEqual(TABLE); expect(state.files.has(tableCopy)).toBe(true); expect(resolved).not.toHaveBeenCalled();
    } finally {
      failed.mockRestore();
    }
  });
  it("lays a conflict of a file an editor saves as text side by side, though the sync's list does not name it", async () => {
    const script = "Tools/run.py", scriptCopy = "Tools/run.CONFLICT-2026-10-11T08-00-00-000Z.py";
    state.files.set(script, "print('one')\n"); state.files.set(scriptCopy, "print('two')\n");
    await render(script, scriptCopy);
    expect(host.querySelector('[data-testid="compare-not-text"]')).toBeNull();
    expect(host.textContent).toContain("print('two')");
    await click("compare-adopt");
    expect(state.files.get(script)).toBe("print('two')\n"); expect(state.files.has(scriptCopy)).toBe(false);
  });
});
