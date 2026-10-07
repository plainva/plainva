import { describe, expect, it } from "vitest";
import { approveMcpListing, EMPTY_MCP_GRANT, readMcpListing, type McpListing } from "@plainva/core";
import {
  createMcpDeviceStore,
  createMcpVaultStore,
  MCP_AUDIT_CAP,
  mcpSnapshotFits,
  mcpVaultEntryFor,
  readMcpServerRecords,
  readMcpVaultEntries,
  serializeMcpServerRecords,
  type McpAuditEntry,
  type McpServerRecord,
} from "@plainva/ui";
import { memoryFiles } from "./mcpTestHost";

/**
 * What Plainva remembers of foreign servers (plan KI-Harness P4.5): two files
 * in the app's data, read defensively. A file somebody damaged — or wrote —
 * can make a server less usable, never more: no approval without the listing
 * it was given for, no grant without the registration it was made for.
 */

const listing: McpListing = readMcpListing({ instructions: "Search the tracker.", tools: [{ name: "search_issues", description: "Searches issues.", annotations: { readOnlyHint: true } }], prompts: [] });
const NOW = new Date("2026-10-07T09:00:00Z");
const approved = (): McpServerRecord => ({ label: "Tracker", addedAt: "2026-10-07T08:00:00.000Z", target: "http https://mcp.example.com/mcp", review: approveMcpListing(listing, NOW), snapshot: listing });

describe("the device's record of servers", () => {
  it("survives a round trip", () => {
    const records = { tracker: { ...approved(), seen: { name: "Tracker MCP", era: "modern" as const, version: "2026-07-28", at: "2026-10-07T09:00:00.000Z", clipped: false } } };
    expect(readMcpServerRecords(serializeMcpServerRecords(records))).toEqual(records);
  });

  it("reads a file that is none as no servers", () => {
    for (const raw of [null, "", "{", "[]", JSON.stringify({ version: 2, servers: {} }), JSON.stringify({ version: 1, servers: [] })]) expect(readMcpServerRecords(raw)).toEqual({});
  });

  it("never reads an approval without the listing it was given for", () => {
    const record = approved();
    const raw = JSON.stringify({ version: 1, servers: { tracker: { ...record, snapshot: null }, wiki: { ...record, snapshot: "none" } } });
    const read = readMcpServerRecords(raw);
    expect(read.tracker).toMatchObject({ review: { status: "new" }, snapshot: null });
    expect(read.wiki).toMatchObject({ review: { status: "new" }, snapshot: null });
  });

  it("reads a damaged review as a server nobody approved, and keeps no listing for it", () => {
    const read = readMcpServerRecords(JSON.stringify({ version: 1, servers: { tracker: { ...approved(), review: { status: "approved" } } } }));
    expect(read.tracker).toMatchObject({ review: { status: "new" }, snapshot: null });
  });

  it("leaves out what is no server id, and cuts a label a stranger could have written long", () => {
    const record = approved();
    const read = readMcpServerRecords(JSON.stringify({ version: 1, servers: { "Not An Id": record, "../up": record, tracker: { ...record, label: "x".repeat(500) }, wiki: 7 } }));
    expect(Object.keys(read)).toEqual(["tracker"]);
    expect(read.tracker!.label.length).toBeLessThanOrEqual(61);
  });

  it("is kept in the app's data, in one file", async () => {
    const files = memoryFiles();
    const store = createMcpDeviceStore(files);
    expect(await store.load()).toEqual({});
    await store.save({ tracker: approved() });
    expect([...files.files.keys()]).toEqual(["mcp/servers.json"]);
    expect((await store.load()).tracker).toEqual(approved());
  });

  it("says when a listing is too large to keep", () => {
    expect(mcpSnapshotFits(listing)).toBe(true);
    expect(mcpSnapshotFits({ ...listing, instructions: "x".repeat(1_000_001) })).toBe(false);
  });
});

describe("a vault's choices", () => {
  const TARGET = "http https://mcp.example.com/mcp";
  const entry = { enabled: true, grant: { ...EMPTY_MCP_GRANT, tools: ["search_issues"], folders: ["Projects"] }, target: TARGET };

  it("survive a round trip, and a damaged entry switches off and grants nothing", () => {
    expect(readMcpVaultEntries(JSON.stringify({ version: 1, servers: { tracker: entry } }))).toEqual({ tracker: entry });
    const read = readMcpVaultEntries(JSON.stringify({ version: 1, servers: { tracker: { enabled: "yes", grant: { tools: "all", folders: [7] } }, "Bad Id": entry } }));
    expect(read).toEqual({ tracker: { enabled: false, grant: EMPTY_MCP_GRANT, target: "" } });
    for (const raw of [null, "{", JSON.stringify({ version: 1 })]) expect(readMcpVaultEntries(raw)).toEqual({});
  });

  it("belong to the registration they were made for: a server registered anew starts off, with nothing granted", () => {
    expect(mcpVaultEntryFor({ tracker: entry }, "tracker", TARGET)).toEqual(entry);
    expect(mcpVaultEntryFor({ tracker: entry }, "tracker", "http https://mcp.example.org/mcp")).toEqual({ enabled: false, grant: EMPTY_MCP_GRANT, target: "http https://mcp.example.org/mcp" });
    expect(mcpVaultEntryFor({}, "tracker", TARGET)).toEqual({ enabled: false, grant: EMPTY_MCP_GRANT, target: TARGET });
  });

  it("are each vault's own file, and a vault key that is none is refused", async () => {
    const files = memoryFiles();
    const one = createMcpVaultStore(files, "vault-one");
    const two = createMcpVaultStore(files, "vault-two");
    await one.save({ tracker: entry });
    expect(await one.load()).toEqual({ tracker: entry });
    expect(await two.load()).toEqual({});
    expect([...files.files.keys()]).toEqual(["vault-one/mcp.json"]);
    expect(() => createMcpVaultStore(files, "../up")).toThrow();
    expect(() => createMcpVaultStore(files, "")).toThrow();
  });
});

describe("a vault's log of calls", () => {
  const call = (n: number): McpAuditEntry => ({ at: `2026-10-07T09:00:${String(n % 60).padStart(2, "0")}.000Z`, server: "tracker", tool: "search_issues", outcome: "answered", sent: 20 + n, received: 300, conversation: "c1" });

  it("keeps who, what and how it ended — and two calls that end together both reach it", async () => {
    const store = createMcpVaultStore(memoryFiles(), "vault-one");
    await Promise.all([store.log(call(1)), store.log(call(2)), store.log({ ...call(3), outcome: "declined" })]);
    expect((await store.audit()).map((e) => [e.sent, e.outcome])).toEqual([
      [21, "answered"],
      [22, "answered"],
      [23, "declined"],
    ]);
  });

  it("keeps the newest entries only, and reads nothing that is no entry", async () => {
    const files = memoryFiles();
    const store = createMcpVaultStore(files, "vault-one");
    files.files.set("vault-one/mcp-audit.json", JSON.stringify({ version: 1, entries: [...Array.from({ length: MCP_AUDIT_CAP + 20 }, (_, n) => call(n)), { at: "x" }, { ...call(1), outcome: "wonderful" }, "text"] }));
    const read = await store.audit();
    expect(read).toHaveLength(MCP_AUDIT_CAP);
    await store.log(call(999));
    const after = await store.audit();
    expect(after).toHaveLength(MCP_AUDIT_CAP);
    expect(after[after.length - 1]!.sent).toBe(20 + 999);
    files.files.set("vault-one/mcp-audit.json", "not json");
    expect(await store.audit()).toEqual([]);
  });
});
