// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { startConversation, type ConversationRecord, type EgressManifest, type RunReading } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiEffectApproval, AiSendOverview, transcriptOf } from "@plainva/ui";

/**
 * The surfaces of mail and the tool search (plan KI-Harness P4-4), shared by
 * both shells: the question before mail is read for the first time, the
 * overview's rows for what is within reach and for what a run read, and a
 * step that went through the dispatcher shown as the tool it meant.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactElement): HTMLElement {
  void i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const buttons = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).map((button) => button.textContent);

describe("the question before mail is read", () => {
  it("says where the heads go and that the provider reads a message's text, and takes yes or no", () => {
    const onAnswer = vi.fn();
    const container = mount(<AiEffectApproval request={{ id: "c1", kind: "data", dataClass: "mail", tool: "search_mail", provider: "Anthropic", reader: "provider", readerLabel: "Anthropic" }} onAnswer={onAnswer} />);
    const card = container.querySelector('[data-testid="ai-effect"]')!;
    expect(card.getAttribute("aria-label")).toBe("Read your mail?");
    expect(card.getAttribute("data-kind")).toBe("mail");
    expect(container.querySelector('[data-testid="ai-effect-recipient"]')!.textContent).toBe("Anthropic");
    expect(container.textContent).toContain("sender, subject and date of the messages it finds");
    expect(container.querySelector('[data-testid="ai-effect-reader"]')!.textContent).toBe("read by Anthropic, in a request of its own without tools");
    expect(container.textContent).toContain("Applies to Anthropic until you close Plainva. Nothing in your mailbox is changed or marked as read.");
    // Yes holds for the session, so there is one yes — not "once" and "always".
    expect(buttons(container)).toEqual(["Don't allow", "Allow"]);
    click(container.querySelector('[data-testid="ai-effect-allow"]'));
    click(container.querySelector('[data-testid="ai-effect-deny"]'));
    expect(onAnswer.mock.calls.map((call) => call[0])).toEqual(["always", "deny"]);
  });

  it("says so where a model on this device reads the text", () => {
    const container = mount(
      <AiEffectApproval request={{ id: "c1", kind: "data", dataClass: "mail", tool: "read_mail", provider: "Anthropic", reader: "device", readerLabel: "Ollama · granite3.3:8b" }} onAnswer={() => undefined} touch />,
    );
    expect(container.querySelector('[data-testid="ai-effect-reader"]')!.textContent).toBe("read by Ollama · granite3.3:8b on this device — only its report goes to Anthropic");
    expect(container.querySelector('[data-testid="ai-effect"]')!.className).toContain("pv-ai-overview--touch");
  });
});

const manifest: EgressManifest = {
  providerId: "anthropic",
  providerLabel: "Anthropic",
  model: "m-1",
  local: false,
  sources: [],
  dataClasses: ["situation"],
  folders: [],
  withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
  excluded: [],
  estimatedTokens: 900,
  tools: ["search_vault", "get_event", "find_tools", "call_tool"],
  more: ["search_mail", "read_mail"],
  web: false,
};

describe("the send overview with further tools", () => {
  it("names the tool search once, and mail as within reach — not as approved", () => {
    const container = mount(<AiSendOverview manifest={manifest} growth={[{ kind: "tools", tools: ["find_tools", "call_tool"] }]} onSend={() => undefined} onCancel={() => undefined} />);
    // The dispatcher is the search's other half: one entry, in the list and in the reason.
    expect(container.textContent).toContain("Searching the vault · Reading an appointment · Looking for further tools");
    expect(container.textContent).toContain("New tools: Looking for further tools");
    expect(container.textContent).not.toContain("Using a further tool");
    expect(container.querySelector('[data-testid="ai-overview-further"]')!.textContent).toBe("mail — asks before it is read for the first time");
    // A conversation without further tools has no such row.
    act(() => root?.unmount());
    const without = mount(<AiSendOverview manifest={{ ...manifest, more: undefined }} onSend={() => undefined} onCancel={() => undefined} />);
    expect(without.querySelector('[data-testid="ai-overview-further"]')).toBeNull();
  });

  it("says afterwards what the run read, in numbers, and who read the text", () => {
    const reading: RunReading = { mailSearches: 2, messages: 1, descriptions: 0, reader: "device", readerModel: "granite3.3:8b", inputTokens: 300, outputTokens: 40 };
    const container = mount(<AiSendOverview manifest={manifest} reading={reading} />);
    const row = container.querySelector('[data-testid="ai-overview-reading"]')!;
    expect(row.textContent).toContain("2 mail searches · 1 message read");
    expect(row.textContent).toContain("The text was read by granite3.3:8b on this device; only its report went on.");
    act(() => root?.unmount());
    const byProvider = mount(<AiSendOverview manifest={manifest} reading={{ mailSearches: 0, messages: 0, descriptions: 2, reader: "provider", inputTokens: 80, outputTokens: 10 }} />);
    expect(byProvider.querySelector('[data-testid="ai-overview-reading"]')!.textContent).toBe("2 appointment descriptions readThe text was read by Anthropic, in requests of their own without tools.");
    // Searches alone read no text: nobody is named as its reader.
    act(() => root?.unmount());
    const searched = mount(<AiSendOverview manifest={manifest} reading={{ mailSearches: 1, messages: 0, descriptions: 0, reader: "provider", inputTokens: 0, outputTokens: 0 }} />);
    expect(searched.querySelector('[data-testid="ai-overview-reading"]')!.textContent).toBe("1 mail search");
    act(() => root?.unmount());
    expect(mount(<AiSendOverview manifest={manifest} reading={null} />).querySelector('[data-testid="ai-overview-reading"]')).toBeNull();
  });
});

describe("a step through the dispatcher", () => {
  it("is shown as the tool it meant, with how it ended", () => {
    const at = "2026-10-06T10:00:00Z";
    const record: ConversationRecord = {
      version: 1,
      id: "c",
      title: "Mail",
      createdAt: at,
      updatedAt: at,
      providerId: "anthropic",
      model: "m-1",
      conversation: {
        ...startConversation("c", "system", ["search_vault", "find_tools", "call_tool"], ["search_mail", "read_mail"]),
        turns: [
          { role: "user", parts: [{ type: "text", text: "What did Anna write?" }], at },
          {
            role: "assistant",
            parts: [
              { type: "tool_call", id: "1", name: "find_tools", args: { query: "mail" } },
              { type: "tool_call", id: "2", name: "call_tool", args: { name: "search_mail", args: { query: "Anna" } } },
              { type: "tool_call", id: "3", name: "call_tool", args: { name: "not a tool" } },
            ],
            at,
          },
          {
            role: "user",
            parts: [
              { type: "tool_result", callId: "1", name: "find_tools", content: "Tools — …" },
              { type: "tool_result", callId: "2", name: "call_tool", tool: "search_mail", content: "The user did not approve this action.", isError: true },
              { type: "tool_result", callId: "3", name: "call_tool", content: "No tool …", isError: true },
            ],
            at,
          },
        ],
      },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      runs: [],
      pins: [],
    };
    const steps = transcriptOf(record).flatMap((item) => (item.kind === "steps" ? item.steps : []));
    expect(steps).toEqual([
      { id: "1", name: "find_tools", state: "done" },
      { id: "2", name: "search_mail", state: "declined" },
      // A call that named no tool stays the dispatcher's.
      { id: "3", name: "call_tool", state: "failed" },
    ]);
    expect(i18n.t("ai.tool.search_mail", { lng: "en" })).toBe("Searching mail");
    expect(i18n.t("ai.tool.call_tool", { lng: "en" })).toBe("Using a further tool");
  });
});
