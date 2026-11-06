// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { AiConversation, AiSessionContext, toast, useAiState, type AiSession } from "@plainva/ui";
import { AiTabView } from "../components/ai/AiTabView";
import { AiModelDialog } from "../components/settings/AiDialogs";
import { mcpSession } from "./mcpSessionHarness";

/**
 * Starting a conversation where it can be seen (Befunde 06.11., B6, B8): "New
 * conversation" from another segment of the AI tab shows the conversations;
 * a start while an answer is under way says so instead of doing nothing; a
 * skill that reads its instructions says it is on its way.
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
  vi.restoreAllMocks();
});

async function show(session: AiSession, node: ReactNode): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AiSessionContext.Provider value={session}>{node}</AiSessionContext.Provider>);
  });
  await settle();
}
const settle = async () => {
  await act(async () => {
    for (let turns = 0; turns < 12; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
};
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const tab = () => (
  <AiTabView activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={() => undefined} onOpenPath={() => undefined} />
);

describe("a start shows where it runs (B8)", () => {
  it("“New conversation” from the memory shows the conversations", async () => {
    const { s } = await mcpSession([]);
    await show(s, tab());
    await click(q("ai-tab-memory"));
    expect(q("ai-conversation")).toBeNull();
    await click(q("ai-tab-new"));
    expect(q("ai-tab-chats")!.getAttribute("aria-checked")).toBe("true");
    expect(q("ai-conversation")).not.toBeNull();
  });

  it("while an answer is under way it says so, and the segment stays", async () => {
    const { s } = await mcpSession([]);
    const said = vi.spyOn(toast, "info");
    await show(s, tab());
    await click(q("ai-tab-memory"));
    vi.spyOn(s, "startBlocked").mockReturnValue(true);
    const fresh = vi.spyOn(s, "newConversation");
    await click(q("ai-tab-new"));
    expect(fresh).not.toHaveBeenCalled();
    expect(said).toHaveBeenCalledWith(i18n.t("ai.startBusy"));
    expect(q("ai-tab-memory")!.getAttribute("aria-checked")).toBe("true");
  });
});

describe("a skill on its way (B6)", () => {
  it("the conversation says that it is being prepared until the request goes", async () => {
    const { s } = await mcpSession([]);
    await show(s, <AiConversation dress="window" activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={() => undefined} />);
    expect(q("ai-preparing")).toBeNull();
    // What runSkill sets while it reads the skill's instructions.
    await act(async () => (s as unknown as { set: (patch: object) => void }).set({ preparing: true }));
    expect(q("ai-preparing")?.textContent).toContain(i18n.t("ai.preparingSkill"));
    await act(async () => (s as unknown as { set: (patch: object) => void }).set({ preparing: false }));
    expect(q("ai-preparing")).toBeNull();
  });
});

// Befunde 06.11., B2: the provider's list showed each model as a button in one line — cut to its height, the list
// pushed sideways. It lists rows now: the name, the id under it, the chosen one marked.
describe("the list of a provider's models (B2)", () => {
  function Dialog({ session }: { session: AiSession }) {
    const state = useAiState();
    return state ? <AiModelDialog session={session} state={state} profile="fast" onClose={() => undefined} /> : null;
  }

  it("is a list of rows, name over id, and the chosen one is marked", async () => {
    const { s } = await mcpSession([]);
    await act(async () =>
      (s as unknown as { set: (patch: object) => void }).set({
        tests: { anthropic: { state: "ok", models: [{ id: "claude-a-1", label: "Claude A", chat: true }, { id: "claude-b-2", label: "Claude B", chat: true }, { id: "plain-3", chat: true }] } },
      }),
    );
    await show(s, <Dialog session={s} />);
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="ai-model-option"]')];
    expect(rows).toHaveLength(3);
    expect(document.querySelector('[data-testid="ai-model-list"] button.pv-btn')).toBeNull();
    expect(rows[0]!.textContent).toContain("Claude A");
    expect(rows[0]!.querySelector(".pv-ai-modelid")?.textContent).toBe("claude-a-1");
    // A model without a name of its own is its id, once.
    expect(rows[2]!.querySelector(".pv-ai-modelid")).toBeNull();
    await click(rows[1]);
    // The field filters the list by what it holds: the chosen model is the one row, marked.
    const chosen = [...document.querySelectorAll<HTMLElement>('[data-testid="ai-model-option"]')];
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.textContent).toContain("Claude B");
    expect(chosen[0]!.getAttribute("aria-current")).not.toBeNull();
    expect((document.querySelector('[data-testid="ai-model-input"]') as HTMLInputElement).value).toBe("claude-b-2");
  });
});
