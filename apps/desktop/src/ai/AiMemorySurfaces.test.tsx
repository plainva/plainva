// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EgressManifest, WriteDraft, WriteDraftOutcome } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiDraftCard, AiDraftDone, AiSendOverview, MemoryMeter } from "@plainva/ui";

/**
 * The memory where a conversation shows it (plan KI-Harness P6, mockup
 * chapter 22), shared by both shells: the cards of its three drafts, the line
 * of what became of one, and the send overview's row.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function show(node: ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const click = async (el: Element | null | undefined) => {
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const q = (container: Element, id: string) => container.querySelector(`[data-testid="${id}"]`);
const rows = (card: Element) => [...card.querySelectorAll("dl > dt")].map((dt) => `${text(dt)}: ${text(dt.nextElementSibling)}`);

const draft = (body: WriteDraft["body"], over: Partial<WriteDraft> = {}): WriteDraft => ({
  id: "d-000001",
  createdAt: "2026-10-09T09:00:00.000Z",
  author: { id: "plainva-ai/m-1", label: "Plainva AI · m-1" },
  conversationId: "c1",
  title: "title",
  body,
  inherited: [],
  sources: [],
  defused: 0,
  ...over,
});
const LONG_TEXT = "I prefer offers that fit on one page, name the day rate in the first paragraph and close with the date until which they hold.";

describe("a draft for the memory", () => {
  it("shows the whole entry, lets the user choose where it goes, and is written by “Remember”", async () => {
    const onCreate = vi.fn();
    const container = show(<AiDraftCard draft={draft({ kind: "memory", text: LONG_TEXT, place: "active", replaces: null }, { title: "I prefer offers that fit…" })} canCreate busy={false} onCreate={onCreate} onDiscard={() => {}} />);
    const card = q(container, "ai-draft")!;
    expect(card.getAttribute("data-kind")).toBe("memory");
    // An entry is its whole text: the title would cut it.
    expect(rows(card)).toEqual([`Entry: ${LONG_TEXT}`]);
    expect(text(card.querySelector("h4"))).toBe("Draft · Memory entry");
    expect(q(card, "ai-draft-show")).toBeNull();
    expect(q(card, "ai-draft-place-active")!.getAttribute("aria-pressed")).toBe("true");
    expect(text(q(card, "ai-draft-create"))).toBe("Remember");
    await click(q(card, "ai-draft-create"));
    await click(q(card, "ai-draft-place-long"));
    expect(q(card, "ai-draft-place-long")!.getAttribute("aria-pressed")).toBe("true");
    await click(q(card, "ai-draft-create"));
    expect(onCreate.mock.calls).toEqual([
      ["d-000001", false, "active"],
      ["d-000001", false, "long"],
    ]);
  });

  it("a new wording names what it replaces and stays where that entry stands", () => {
    const container = show(<AiDraftCard draft={draft({ kind: "memory", text: "My day rate is 1000.", place: "long", replaces: "My day rate is 950." })} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />);
    expect(rows(q(container, "ai-draft")!)).toEqual(["Entry: My day rate is 1000.", "Replaces: My day rate is 950."]);
    expect(q(container, "ai-draft-place-active")).toBeNull();
  });

  it("says that the entry takes the rules of what its conversation rested on", () => {
    const body = { kind: "memory", text: "Salaries are reviewed in March.", place: "active", replaces: null } as const;
    const kept = show(<AiDraftCard draft={draft(body, { inherited: ["cloud", "web"] })} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />);
    expect(text(q(kept, "ai-draft-memory-rules"))).toBe("The entry gets the privacy rules of the notes this conversation rested on.");
    // Which ones, in the words the memory's list marks an entry with.
    expect([...kept.querySelectorAll('[data-testid="ai-draft-memory-rule"]')].map(text)).toEqual(["Not to cloud models", "Not in conversations with the internet"]);
    act(() => root?.unmount());
    expect(q(show(<AiDraftCard draft={draft(body)} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />), "ai-draft-memory-rules")).toBeNull();
  });

  it("taking an entry out names the entry, and its button says “Remove”", async () => {
    const onCreate = vi.fn();
    const container = show(<AiDraftCard draft={draft({ kind: "forget", entry: "Offers hold for 30 days." })} canCreate busy={false} onCreate={onCreate} onDiscard={() => {}} />);
    const card = q(container, "ai-draft")!;
    expect(text(card.querySelector("h4"))).toBe("Draft · Remove from the memory");
    expect(rows(card)).toEqual(["Entry: Offers hold for 30 days."]);
    expect(text(q(card, "ai-draft-create"))).toBe("Remove");
    await click(q(card, "ai-draft-create"));
    // Nothing to choose: no place, no list.
    expect(onCreate.mock.calls).toEqual([["d-000001", false]]);
  });

  it("a rule is said to be one: it goes into the vault's instructions and to every model", () => {
    const container = show(<AiDraftCard draft={draft({ kind: "rule", text: "Answer in German." })} canCreate busy={false} onCreate={() => {}} onDiscard={() => {}} />);
    const card = q(container, "ai-draft")!;
    expect(text(card.querySelector("h4"))).toBe("Draft · Rule for the AI");
    expect(rows(card)).toEqual(["Rule: Answer in German."]);
    expect(text(card)).toContain("A rule goes into the vault's instructions (AGENTS.md) and to every model.");
    expect(text(q(card, "ai-draft-create"))).toBe("Add as a rule");
    expect(q(card, "ai-draft-place-active")).toBeNull();
  });

  it("what became of one is said in the memory's own words — and nothing is offered to open", () => {
    const done = (kind: WriteDraftOutcome["kind"], outcome: WriteDraftOutcome["outcome"] = "created"): WriteDraftOutcome => ({ id: "d-000001", kind, title: "Answer in German.", outcome, at: "2026-10-09T10:00:00.000Z" });
    const line = (outcome: WriteDraftOutcome) => {
      const container = show(<AiDraftDone outcome={outcome} onOpenNote={() => {}} />);
      const said = text(q(container, "ai-draft-done"));
      expect(container.querySelector("button")).toBeNull();
      act(() => root?.unmount());
      return said;
    };
    expect(line(done("memory"))).toBe("Remembered: Answer in German.");
    expect(line(done("forget"))).toBe("Removed from the memory: Answer in German.");
    expect(line(done("rule"))).toBe("Added as a rule: Answer in German.");
    expect(line(done("memory", "discarded"))).toContain("Answer in German.");
    expect(line(done("memory", "discarded"))).not.toContain("Remembered");
  });
});

describe("the memory in the send overview", () => {
  const manifest: EgressManifest = {
    providerId: "anthropic",
    providerLabel: "Anthropic",
    model: "m-1",
    local: false,
    sources: [],
    dataClasses: ["situation", "memory"],
    folders: [],
    withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
    excluded: [],
    estimatedTokens: 300,
    tools: ["search_vault", "search_memory"],
    web: false,
    memory: { entries: 2, withheld: 1, tokens: 30, lookup: true },
  };
  const row = (container: Element, label: string) => [...container.querySelectorAll("dl > dt")].find((dt) => text(dt) === label)?.nextElementSibling ?? null;

  it("has a row of its own: how many entries go, and that the rest can be looked up — never which", () => {
    const container = show(<AiSendOverview manifest={manifest} onSend={() => {}} onCancel={() => {}} growth={[{ kind: "first" }]} />);
    expect(text(q(container, "ai-overview-memory"))).toBe("2 entries from “Always included” · “On demand” can be looked up");
    expect(text(row(container, "Memory"))).toBe(text(q(container, "ai-overview-memory")));
    // Counted among what stays here, and not repeated among the kinds of data that go.
    expect(text(row(container, "Kept back"))).toContain("1 memory entry your rules block");
    expect(text(row(container, "Also goes"))).toBe("date and time");
  });

  it("says only what is true: nothing goes and nothing can be looked up, there is no row", () => {
    const none = show(<AiSendOverview manifest={{ ...manifest, dataClasses: ["situation"], memory: { entries: 0, withheld: 3, tokens: 0, lookup: false } }} />);
    expect(q(none, "ai-overview-memory")).toBeNull();
    expect(text(row(none, "Kept back"))).toContain("3 memory entries your rules block");
    act(() => root?.unmount());
    const lookup = show(<AiSendOverview manifest={{ ...manifest, memory: { entries: 0, withheld: 0, tokens: 0, lookup: true } }} />);
    expect(text(q(lookup, "ai-overview-memory"))).toBe("“On demand” can be looked up");
    act(() => root?.unmount());
    const plain = show(<AiSendOverview manifest={{ ...manifest, dataClasses: ["situation"], memory: undefined }} />);
    expect(q(plain, "ai-overview-memory")).toBeNull();
  });
});

describe("the budget's bar", () => {
  it("is a progress bar that says its count in words", () => {
    const container = show(<MemoryMeter fill={0.31} label="620 of 2,000 characters" />);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("31");
    expect(bar.getAttribute("aria-label")).toBe("620 of 2,000 characters");
    expect(text(q(container, "ai-memory-budget"))).toBe("620 of 2,000 characters");
  });
});
