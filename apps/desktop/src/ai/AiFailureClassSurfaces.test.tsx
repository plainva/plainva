// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { AiConversation, AiSessionContext, type AiSession } from "@plainva/ui/ai";
import { answer, brokeOff, session, unreachable, vaultHost } from "./failureClassHarness";

/**
 * The two classes of a failed request on the conversation both shells show (plan Umsetzung 0.9.x, B7; M9). A typed
 * question that never left the device comes back into the field, said so, with "Send again"; one that may have arrived
 * stays in the conversation, said so, and "Send again" sends the same turn where it stands.
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

const settle = async () => {
  await act(async () => {
    for (let turns = 0; turns < 40; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

async function show(s: AiSession): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiSessionContext.Provider value={s}>
        <AiConversation dress="screen" activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={() => undefined} />
      </AiSessionContext.Provider>,
    );
  });
  await settle();
}

const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const field = () => q("ai-input") as HTMLTextAreaElement;

async function type(text: string): Promise<void> {
  const input = field();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function click(id: string): Promise<void> {
  const el = q(id) as HTMLElement | null;
  expect(el).toBeTruthy();
  await act(async () => el!.click());
  await settle();
}

describe("a failed request on the conversation", () => {
  it("puts a question that never left the device back into the field, says so, and sends it again from there", async () => {
    const { s, fake } = session([unreachable, answer("In the folder.")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await show(s);
    await type("Where is the offer?");
    await click("ai-send");
    expect(field().value).toBe("Where is the offer?");
    expect(document.body.textContent).toContain("No connection to Anthropic — nothing was sent. Your question is back in the field.");
    // No turn of it stands in the thread.
    expect(document.body.querySelector(".pv-ai-msg--user")).toBeNull();
    await click("ai-notice-send-again");
    expect(fake.sent).toHaveLength(2);
    expect(s.getState().active!.conversation.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(field().value).toBe("");
  });

  it("keeps a request that may have arrived, says so, and sends the same turn again in place", async () => {
    const { s, fake } = session([brokeOff, answer("In the folder.")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await show(s);
    await type("Where is the offer?");
    await click("ai-send");
    const banner = document.body.textContent ?? "";
    expect(banner).toContain("Anthropic did not answer. The request may have arrived.");
    expect(banner).not.toContain("nothing was sent");
    // The question stays in the conversation, not in the field.
    expect(field().value).toBe("");
    expect(document.body.querySelectorAll(".pv-ai-msg--user")).toHaveLength(1);
    await click("ai-notice-send-again");
    expect(fake.sent).toHaveLength(2);
    expect(s.getState().active!.runs.map((run) => run.userTurn)).toEqual([0, 0]);
    expect(document.body.querySelectorAll(".pv-ai-msg--user")).toHaveLength(1);
  });

  it("keeps what the field holds for a conversation on this device, and brings it back when it opens again", async () => {
    const { s } = session([]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await show(s);
    await type("Half a question");
    // A moment after the last key it is kept.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    await settle();
    expect((await vault.composerDrafts.load("new"))?.text).toBe("Half a question");
    act(() => root?.unmount());
    host?.remove();
    await show(s);
    expect(field().value).toBe("Half a question");
  });
});
