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

  it("keeps what a run asked of the internet, and reads it back as public addresses only", () => {
    const r = record();
    const web = {
      pages: [
        { url: "https://example.org/rates", title: "Rates", at, read: true },
        { url: "https://example.org/gone", title: "", at, read: false },
      ],
      searches: [{ query: "day rates 2026", at, hits: 3 }],
      inputTokens: 2100,
      outputTokens: 140,
    };
    r.runs[0] = { ...r.runs[0]!, web };
    expect(readConversationRecord(JSON.parse(JSON.stringify(r)))!.runs[0]!.web).toEqual(web);

    // A stored file is not a reason to open anything: what is no public https address is not kept.
    const tampered = JSON.parse(JSON.stringify(r));
    tampered.runs[0].web = {
      pages: [{ url: "javascript:alert(1)", title: "x", at, read: true }, { url: "https://192.168.1.1/", title: "router", at, read: true }, { url: "https://Example.org/ok#frag", title: 7, at, read: "yes" }, null],
      searches: [{ query: "", at, hits: 1 }, { query: "kept", at, hits: -4 }, "nonsense"],
      inputTokens: "many",
      outputTokens: 5,
    };
    expect(readConversationRecord(tampered)!.runs[0]!.web).toEqual({
      pages: [{ url: "https://example.org/ok", title: "", at, read: false }],
      searches: [{ query: "kept", at, hits: 0 }],
      inputTokens: 0,
      outputTokens: 5,
    });
    // Nothing asked for is no record at all.
    tampered.runs[0].web = { pages: [], searches: [], inputTokens: 9, outputTokens: 9 };
    expect(readConversationRecord(tampered)!.runs[0]!.web).toBeUndefined();
  });

  it("keeps what a run read of mail and appointments as numbers and who read, and its further tools", () => {
    const r = record();
    const reading = { mailSearches: 2, messages: 1, descriptions: 1, reader: "device" as const, readerModel: "granite3.3:8b", inputTokens: 900, outputTokens: 120 };
    r.runs[0] = { ...r.runs[0]!, reading };
    r.conversation = appendTurn(startConversation("c1", "system", ["search_vault", "find_tools", "call_tool"], ["search_mail", "read_mail"]), { role: "user", parts: [{ type: "text", text: "Mail?" }], at });
    const read = readConversationRecord(JSON.parse(JSON.stringify(r)))!;
    expect(read.runs[0]!.reading).toEqual(reading);
    expect(read.conversation.more).toEqual(["search_mail", "read_mail"]);

    const tampered = JSON.parse(JSON.stringify(r));
    tampered.runs[0].reading = { mailSearches: "many", messages: 3, descriptions: -1, reader: "somewhere", readerModel: 7, subject: "never kept", inputTokens: 5, outputTokens: null };
    expect(readConversationRecord(tampered)!.runs[0]!.reading).toEqual({ mailSearches: 0, messages: 3, descriptions: 0, reader: "provider", inputTokens: 5, outputTokens: 0 });
    // Nothing read is no record at all.
    tampered.runs[0].reading = { mailSearches: 0, messages: 0, descriptions: 0, reader: "device", inputTokens: 9, outputTokens: 9 };
    expect(readConversationRecord(tampered)!.runs[0]!.reading).toBeUndefined();
    // A conversation without further tools carries no empty list.
    expect(startConversation("c", "s", ["search_vault"])).not.toHaveProperty("more");
  });

  it("keeps a picture with the turn that sent it, and its size with the run's overview", () => {
    const r = record();
    const picture = { type: "image" as const, mime: "image/jpeg" as const, data: "QUJDRA==", name: "Whiteboard.jpg", width: 1568, height: 1045, path: "Assets/Whiteboard.jpg" };
    r.conversation = appendTurn(startConversation("c1", "system", ["search_vault"]), { role: "user", parts: [{ type: "text", text: "lead", context: [] }, picture, { type: "text", text: "Explain this picture." }], at });
    const manifest = {
      providerId: "anthropic",
      providerLabel: "Anthropic",
      model: "m",
      local: false,
      sources: [{ path: "Assets/Whiteboard.jpg", title: "Whiteboard.jpg", tier: "evidence" as const, chars: 0, reasons: ["active" as const], image: { width: 1568, height: 1045, bytes: 4 } }],
      dataClasses: ["situation" as const, "images" as const],
      folders: ["Assets"],
      withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
      excluded: [],
      estimatedTokens: 2300,
      tools: ["search_vault"],
      web: false,
    };
    r.runs[0] = { ...r.runs[0]!, manifest };
    const read = readConversationRecord(JSON.parse(JSON.stringify(r)))!;
    expect(read.conversation.turns[0]!.parts[1]).toEqual(picture);
    expect(read.runs[0]!.manifest).toEqual(manifest);
    // The history search reads words, never a picture's bytes.
    expect(conversationMatches(read, "explain this")).toBe(true);
    expect(conversationMatches(read, "QUJD")).toBe(false);
    expect(conversationMatches(read, "whiteboard")).toBe(false);

    // A size that is none is no picture row: the source stays, as a plain one.
    const tampered = JSON.parse(JSON.stringify(r));
    tampered.runs[0].manifest.sources[0].image = { width: "wide", height: 1045, bytes: 4 };
    expect(readConversationRecord(tampered)!.runs[0]!.manifest!.sources[0]).not.toHaveProperty("image");
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
