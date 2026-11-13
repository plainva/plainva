// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { wholeIndexReader } from "@plainva/core";
import { requestAnchorJump, resetNoteLinkInbox } from "@plainva/ui";

/**
 * The phone's side of a note link (F2, ADR 0037; review 2026-11-10): the
 * whole way through `openNoteLink` with the phone's own shell — the index,
 * never the disk; nothing hidden, nothing internal in any spelling; the
 * vault-unknown question.
 */

vi.mock("./services/vaultService", () => ({
  vaultOps: { resolveWikiTarget: vi.fn(async () => null) },
  switchVault: vi.fn(async () => undefined),
}));
vi.mock("./services/vaultRegistry", () => ({
  getActiveVaultEntry: vi.fn(async () => ({ id: "local", name: "" })),
  listVaults: vi.fn(async () => [{ id: "local", name: "" }]),
}));
vi.mock("./services/leaveQuestion", () => ({ leaveThen: (run: () => void) => run() }));
vi.mock("@plainva/ui", async (original) => ({ ...(await original<typeof import("@plainva/ui")>()), requestAnchorJump: vi.fn() }));

afterEach(() => resetNoteLinkInbox());

function fakeVault(indexed: string[]) {
  const asked: string[][] = [];
  const queryService = wholeIndexReader({
    fileRecords: async (paths: readonly string[]) => {
      asked.push([...paths]);
      return new Map(paths.filter((p) => indexed.includes(p)).map((p) => [p, {}]));
    },
  });
  return {
    asked,
    vault: {
      vaultId: "local",
      files: { exists: async () => false },
      queryService,
      indexView: queryService.view(),
    } as never,
  };
}

describe("a note link on the phone", () => {
  it("opens what the index holds, at its heading, and nothing hidden or internal in any spelling", async () => {
    const { phoneNoteLinkHandler } = await import("./services/noteLinkRoute");
    const { openNoteLink } = await import("@plainva/ui");
    const { vault, asked } = fakeVault(["Projects/Plan.md"]);
    const opened: string[] = [];
    // The handler is what the runner registers; the shell it builds is the phone's.
    const handler = phoneNoteLinkHandler(vault, { key: "local", name: "On this device" }, (path) => opened.push(path), async () => true, async () => true);
    handler("plainva://open?path=Projects%2FPlan.md&heading=Goals", false);
    await vi.waitFor(() => expect(opened).toEqual(["Projects/Plan.md"]));
    expect(requestAnchorJump).toHaveBeenCalledWith("Projects/Plan.md", "Goals");
    for (const path of [".Plainva/sync/keyfile.json", ".plainva /sync/keyfile.json", ".pvws/operations/1.json"]) {
      expect(await openNoteLink(`plainva://open?path=${encodeURIComponent(path)}`, { ...shellOf(vault) }), path).toBe("invalid");
    }
    expect(asked.flat()).not.toContain(".Plainva/sync/keyfile.json");
  });

  it("asks before it opens a note of a vault that has another name here", async () => {
    const { phoneNoteLinkHandler } = await import("./services/noteLinkRoute");
    const { vault } = fakeVault(["Projects/Plan.md"]);
    const opened: string[] = [];
    const asked: Array<[string, string]> = [];
    const handler = phoneNoteLinkHandler(vault, { key: "local", name: "On this device" }, (path) => opened.push(path), async () => true, async (v, n) => { asked.push([v, n]); return true; });
    handler("plainva://open?vault=Work&path=Projects%2FPlan.md", false);
    await vi.waitFor(() => expect(opened).toEqual(["Projects/Plan.md"]));
    expect(asked).toEqual([["Work", "Projects/Plan.md"]]);
  });
});

/** The phone's shell, as the handler builds it, for direct calls. */
function shellOf(vault: never) {
  return {
    shownVault: { key: "local", name: "On this device" },
    knownVaults: async () => [],
    confirmSwitch: async () => false,
    confirmOpenHere: async () => false,
    switchVault: () => false,
    exists: async (path: string) => ((await (vault as { queryService: { fileRecords: (p: string[]) => Promise<Map<string, unknown>> } }).queryService.fileRecords([path])).has(path)),
    resolveName: async () => null,
    openNote: () => { throw new Error("must not open"); },
  };
}
