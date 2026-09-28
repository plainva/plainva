import { describe, expect, it } from "vitest";
import { appendTurn, startConversation } from "./conversation.js";
import {
  addUsage,
  appendAiLedgerEntry,
  conversationMatches,
  conversationSummaryOf,
  conversationTitleFrom,
  EMPTY_USAGE,
  expiredConversations,
  AI_LEDGER_LIMIT,
  aiMonthlyTotals,
  readConversationRecord,
  usageCostUsd,
  type ConversationRecord,
  type LedgerEntry,
} from "./history.js";

const at = "2026-09-24T10:00:00Z";

function record(): ConversationRecord {
  const conversation = appendTurn(startConversation("c1", "system", ["search_vault"]), { role: "user", parts: [{ type: "text", text: "Where is the Northwind offer?" }], at });
  return {
    version: 1,
    id: "c1",
    title: "Northwind",
    createdAt: at,
    updatedAt: at,
    providerId: "anthropic",
    model: "m",
    conversation,
    usage: EMPTY_USAGE,
    runs: [{ userTurn: 0, providerId: "anthropic", model: "m", sent: ["Offer.md"], kept: ["Private.md"], usage: EMPTY_USAGE, steps: 1, stop: "answered" }],
    pins: ["Offer.md"],
  };
}

describe("conversation records", () => {
  it("round-trip through JSON and reject what is not one", () => {
    const r = record();
    expect(readConversationRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
    for (const bad of [null, {}, { ...r, version: 2 }, { ...r, conversation: { ...r.conversation, id: "other" } }, { ...r, providerId: 4 }]) {
      expect(readConversationRecord(JSON.parse(JSON.stringify(bad)))).toBeNull();
    }
  });

  it("repairs damaged optional fields instead of dropping the conversation", () => {
    const r = JSON.parse(JSON.stringify(record()));
    r.usage = { inputTokens: -3, outputTokens: "x" };
    r.runs = [null, { providerId: "a" }, ...r.runs];
    r.pins = ["a.md", 5];
    const read = readConversationRecord(r)!;
    expect(read.usage).toEqual(EMPTY_USAGE);
    expect(read.runs).toHaveLength(1);
    expect(read.pins).toEqual(["a.md"]);
  });

  it("titles, summaries, search and retention", () => {
    expect(conversationTitleFrom("  Where   is\nit? ", "x")).toBe("Where is it?");
    expect(conversationTitleFrom("", "Fallback")).toBe("Fallback");
    expect(conversationTitleFrom("a".repeat(80), "x")).toHaveLength(58);
    const r = record();
    expect(conversationSummaryOf(r)).toEqual({ id: "c1", title: "Northwind", updatedAt: at, providerId: "anthropic", model: "m" });
    expect(conversationMatches(r, "northWIND")).toBe(true);
    expect(conversationMatches(r, "offer")).toBe(true);
    expect(conversationMatches(r, "budget")).toBe(false);
    const summaries = [conversationSummaryOf(r), { ...conversationSummaryOf(r), id: "old", updatedAt: "2026-01-01T00:00:00Z" }];
    expect(expiredConversations(summaries, 90, new Date(at))).toEqual(["old"]);
    expect(expiredConversations(summaries, 0, new Date(at))).toEqual([]);
  });
});

describe("run ledger", () => {
  const entry = (i: number, month = "2026-09"): LedgerEntry => ({
    at: `${month}-0${1 + (i % 9)}T00:00:00Z`,
    conversationId: "c",
    providerId: i % 2 ? "openai" : "anthropic",
    model: "m",
    stop: "answered",
    steps: 1,
    tools: [],
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ...(i % 2 ? { costUsd: 0.5 } : {}),
  });

  it("keeps the newest entries only", () => {
    let entries: LedgerEntry[] = [];
    for (let i = 0; i < AI_LEDGER_LIMIT + 5; i++) entries = appendAiLedgerEntry(entries, { ...entry(i), conversationId: String(i) });
    expect(entries).toHaveLength(AI_LEDGER_LIMIT);
    expect(entries[0]!.conversationId).toBe("5");
  });

  it("sums a month per provider and model, and costs only what has a price", () => {
    const totals = aiMonthlyTotals([entry(1), entry(2), entry(3), entry(4, "2026-08")], "2026-09");
    expect(totals).toEqual([
      { key: "anthropic/m", providerId: "anthropic", model: "m", usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      { key: "openai/m", providerId: "openai", model: "m", usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 1 },
    ]);
    expect(addUsage(EMPTY_USAGE, { outputTokens: 2 })).toEqual({ ...EMPTY_USAGE, outputTokens: 2 });
    expect(usageCostUsd({ inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, { input: 3, output: 15 })).toBe(10.5);
    expect(usageCostUsd(EMPTY_USAGE, undefined)).toBeUndefined();
  });
});
