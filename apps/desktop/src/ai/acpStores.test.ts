import { describe, expect, it } from "vitest";
import { ACP_SESSION_LOG_CAP, createAcpDeviceStore, createAcpVaultStore, readAcpAgentRecords, type AcpSessionEntry } from "@plainva/ui";
import { memoryFiles } from "./mcpTestHost";

/**
 * What Plainva remembers of external agents (plan KI-Harness P4.6): a name
 * and what was seen per device, one line per session per vault — in the
 * app's data, never in a vault, and never a word of what was said.
 */

const entry = (overrides: Partial<AcpSessionEntry> = {}): AcpSessionEntry => ({ at: "2026-10-07T10:00:00.000Z", agent: "gemini", label: "Gemini CLI", turns: 2, read: 3, proposed: 1, created: 0, direct: 1, refused: 0, end: "closed", ...overrides });

describe("the device's record of agents", () => {
  it("reads what it wrote, in the app's data", async () => {
    const files = memoryFiles();
    const store = createAcpDeviceStore(files);
    expect(await store.load()).toEqual({});
    const agents = { gemini: { label: "Gemini CLI", addedAt: "2026-10-07T10:00:00.000Z", target: '["/usr/bin/gemini","--acp"]', seen: { at: "2026-10-07T11:00:00.000Z", proposed: 2, direct: 0 } }, own: { label: "My agent", addedAt: "", target: "" } };
    await store.save(agents);
    expect([...files.files.keys()]).toEqual(["acp/agents.json"]);
    expect(await store.load()).toEqual(agents);
  });

  it("reads a damaged file as agents nobody named, never as a crash", () => {
    expect(readAcpAgentRecords(null)).toEqual({});
    expect(readAcpAgentRecords("{ not json")).toEqual({});
    expect(readAcpAgentRecords(JSON.stringify({ version: 2, agents: { gemini: { label: "x" } } }))).toEqual({});
    expect(readAcpAgentRecords(JSON.stringify({ version: 1, agents: [] }))).toEqual({});
    const read = readAcpAgentRecords(
      JSON.stringify({
        version: 1,
        agents: {
          gemini: { label: `  Gemini${String.fromCharCode(0x200b)}\n CLI `, addedAt: 5, target: 7, seen: { at: "2026-10-07T11:00:00.000Z", proposed: -3, direct: "many" } },
          "Bad Id": { label: "x" },
          empty: "not a record",
          nolabel: {},
          past: { label: "Past", seen: { proposed: 1 } },
        },
      }),
    );
    expect(read).toEqual({
      gemini: { label: "Gemini CLI", addedAt: "", target: "", seen: { at: "2026-10-07T11:00:00.000Z", proposed: 0, direct: 0 } },
      nolabel: { label: "nolabel", addedAt: "", target: "" },
      past: { label: "Past", addedAt: "", target: "" },
    });
  });
});

describe("a vault's log of sessions", () => {
  it("keeps one line per session beside the vault's other AI data, and only so many", async () => {
    const files = memoryFiles();
    const store = createAcpVaultStore(files, "vault-one");
    expect(await store.sessions()).toEqual([]);
    await store.log(entry());
    await store.log(entry({ at: "2026-10-07T12:00:00.000Z", end: "exited" }));
    expect([...files.files.keys()]).toEqual(["vault-one/acp-sessions.json"]);
    expect((await store.sessions()).map((line) => line.end)).toEqual(["closed", "exited"]);
    for (let i = 0; i < ACP_SESSION_LOG_CAP + 5; i++) await store.log(entry({ turns: i }));
    const kept = await store.sessions();
    expect(kept).toHaveLength(ACP_SESSION_LOG_CAP);
    expect(kept[kept.length - 1]!.turns).toBe(ACP_SESSION_LOG_CAP + 4);
  });

  it("does not lose a line when two sessions end at once", async () => {
    const store = createAcpVaultStore(memoryFiles(), "vault-one");
    await Promise.all([store.log(entry({ agent: "a" })), store.log(entry({ agent: "b" })), store.log(entry({ agent: "c" }))]);
    expect((await store.sessions()).map((line) => line.agent)).toEqual(["a", "b", "c"]);
  });

  it("reads only lines that are one, and counts that are counts", async () => {
    const files = memoryFiles();
    await files.write(
      "vault-one/acp-sessions.json",
      JSON.stringify({
        version: 1,
        entries: [entry(), { ...entry(), end: "vanished" }, { ...entry(), agent: "Not An Id" }, { ...entry(), at: 5 }, "line", { ...entry({ agent: "b" }), turns: -1, read: 1.5, proposed: "x", label: 7 }],
      }),
    );
    const store = createAcpVaultStore(files, "vault-one");
    expect(await store.sessions()).toEqual([entry(), { ...entry({ agent: "b" }), turns: 0, read: 0, proposed: 0, label: "b" }]);
    await files.write("vault-one/acp-sessions.json", "{ not json");
    expect(await store.sessions()).toEqual([]);
  });

  it("belongs to one vault, by a key that is no path", () => {
    expect(() => createAcpVaultStore(memoryFiles(), "../other")).toThrow("invalid vault key");
    expect(() => createAcpVaultStore(memoryFiles(), "")).toThrow("invalid vault key");
  });
});
