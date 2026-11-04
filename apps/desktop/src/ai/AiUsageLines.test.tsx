// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_AI_APP_SETTINGS, effectivePolicy, notePolicyFrom, readConversationRecord, type AiEgress, type ConversationRecord, type EgressChunk, type LedgerEntry } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiConversation, AiSession, AiSessionContext, cacheShareText, savingsLine, usageRowLine, type AiVaultHost } from "@plainva/ui";

/**
 * What a request and a month cost, as the reader sees it (plan KI-Harness
 * P9-6): the line under an answer says how much came from the provider's
 * cache where it reports one, and the month's lines — the same in both shells
 * — add the cost and what choosing and shortening the notes saved.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  await i18n.changeLanguage("en");
});

/** An Anthropic answer whose request read `cacheRead` tokens of its input from the cache. */
function answer(text: string, usage: { input_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }): EgressChunk[] {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { usage } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 30 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}

async function mounted(script: EgressChunk[][]) {
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const policyOf = async (path: string) => effectivePolicy(path, notePolicyFrom({}), []);
  const vault: AiVaultHost = {
    conversations: {
      list: async () => [],
      load: async (id) => (saved.has(id) ? readConversationRecord(JSON.parse(JSON.stringify(saved.get(id)))) : null),
      save: async (record) => void saved.set(record.id, JSON.parse(JSON.stringify(record))),
      remove: async (id) => void saved.delete(id),
      removeAll: async () => saved.clear(),
    },
    ledger: { load: async () => ledger, save: async (entries) => void (ledger = [...entries]) },
    activeNote: async () => null,
    readNote: async () => null,
    situation: async () => ({ now: "2026-10-26 10:00", weekday: "Monday", calendarDay: "2026-10-26", journalDay: "2026-10-26", active: null, tabs: [], tasks: [], events: [], dailyNote: null }),
    candidates: async () => [],
    policy: { policyOf, resolveLink: async () => null },
    tools: () => null,
  };
  const egress: AiEgress = {
    async send(_id, _spec, onChunk) {
      for (const chunk of script.shift() ?? [{ type: "failed", code: "network", message: "offline" }]) onChunk(chunk);
    },
    async cancel() {},
    async setKey() {},
    hasKey: async () => true,
    async deleteKey() {},
    addEndpoint: async () => true,
    async removeEndpoint() {},
  };
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } };
  const session = new AiSession({
    egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-26",
    now: () => new Date("2026-10-26T10:00:00Z"),
    newId: () => `id${++ids}`,
    label: (key, vars) => i18n.t(key, vars),
  });
  await session.load();
  await session.attachVault(vault);
  // The send overview is answered as it comes: what it shows is not what this test is about.
  session.subscribe(() => {
    if (session.getState().consent) session.answerConsent(true);
  });
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiSessionContext.Provider value={session}>
        <AiConversation dress="window" activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={() => undefined} />
      </AiSessionContext.Provider>,
    );
  });
  return { session, container: host };
}

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
const formats = (language: string) => ({
  number: new Intl.NumberFormat(language),
  money: new Intl.NumberFormat(language, { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
});

describe("what a request cost, under its answer", () => {
  it("says how much of the request came from the provider's cache", async () => {
    const { session, container } = await mounted([answer("It is in the offer.", { input_tokens: 300, cache_read_input_tokens: 700, cache_creation_input_tokens: 0 })]);
    await act(async () => void (await session.send("Where is the offer?")));
    await settle();
    const line = container.querySelector(".pv-ai-runline")!.textContent ?? "";
    expect(line).toContain("~1,030 tokens");
    expect(line).toContain("70% of the input from the cache");
  });

  it("says nothing of a cache where the provider reports none — no 0 % that would say it tried", async () => {
    const { session, container } = await mounted([answer("It is in the offer.", { input_tokens: 1000 })]);
    await act(async () => void (await session.send("Where is the offer?")));
    await settle();
    const line = container.querySelector(".pv-ai-runline")!.textContent ?? "";
    expect(line).toContain("~1,030 tokens");
    expect(line).not.toContain("cache");
  });
});

describe("the share of the input from the cache", () => {
  it("says all only where it was all, and rounds everything else as it is", () => {
    const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
    const number = new Intl.NumberFormat("en");
    const share = (inputTokens: number, cacheReadTokens: number) => cacheShareText(t, { inputTokens, outputTokens: 10, cacheReadTokens, cacheWriteTokens: 0 }, number);
    expect(share(4, 996)).toBe("99% of the input from the cache");
    expect(share(0, 1000)).toBe("100% of the input from the cache");
    expect(share(300, 700)).toBe("70% of the input from the cache");
    expect(share(996, 4)).toBe("0% of the input from the cache");
  });
});

describe("what a month cost and saved, one line for both shells", () => {
  const cached = { usage: { inputTokens: 300, outputTokens: 120, cacheReadTokens: 700, cacheWriteTokens: 0 }, costUsd: 0.0123 };
  const plain = { usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 } };

  it("names the cache share and the cost where there are any, in the app's language", async () => {
    const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
    expect(usageRowLine(t, cached, formats("en"))).toBe("1,000 tokens sent · 120 received · 70% of the input from the cache · ≈ $0.01");
    expect(usageRowLine(t, plain, formats("en"))).toBe("1,000 tokens sent · 50 received");
    expect(savingsLine(t, { savedTokens: 13_420, savedUsd: 0.0368 }, formats("en"))).toBe("Saved by choosing and shortening: ~13,420 tokens · ≈ $0.04");
    // Without a price for every run: the tokens alone.
    expect(savingsLine(t, { savedTokens: 13_420 }, formats("en"))).toBe("Saved by choosing and shortening: ~13,420 tokens");
    // A month on this device's models alone saved tokens, not money — nor does less than half a cent: no "$0.00".
    expect(savingsLine(t, { savedTokens: 13_420, savedUsd: 0 }, formats("en"))).toBe("Saved by choosing and shortening: ~13,420 tokens");
    expect(savingsLine(t, { savedTokens: 120, savedUsd: 0.004 }, formats("en"))).toBe("Saved by choosing and shortening: ~120 tokens");
    expect(savingsLine(t, { savedTokens: 120, savedUsd: 0.005 }, formats("en"))).toBe("Saved by choosing and shortening: ~120 tokens · ≈ $0.01");
    // Nothing saved: no line at all.
    expect(savingsLine(t, { savedTokens: 0 }, formats("en"))).toBeNull();

    await i18n.changeLanguage("de");
    // The amounts as the language writes them — in German with a space that does not break before the sign.
    const de = formats("de");
    expect(usageRowLine(t, cached, de)).toBe(`1.000 Token gesendet · 120 empfangen · 70 % der Eingabe aus dem Cache · ≈ ${de.money.format(0.0123)}`);
    expect(de.money.format(0.0123)).toMatch(/^0,01.\$$/);
    expect(savingsLine(t, { savedTokens: 13_420, savedUsd: 0.0368 }, de)).toBe(`Durch Auswahl und Kürzung gespart: ~13.420 Token · ≈ ${de.money.format(0.0368)}`);
  });
});
