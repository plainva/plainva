// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { AiConversation, AiSessionContext, type AiSession } from "@plainva/ui/ai";
import { answer, session, vaultHost } from "./failureClassHarness";
import { TOO_LONG_TO_CHECK_BODY } from "@plainva/ui/ai";

/**
 * The check of a mail on the conversation both shells show (B7, the maintainer's decision (a)): while `read_mail` runs
 * longer than a moment the step says that Plainva is checking, and goes with the result; a mail too long to check is
 * said under the answer to the question that met it. The desktop shows the conversation as "screen", the phone as "sheet".
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

async function show(s: AiSession, dress: "screen" | "sheet"): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiSessionContext.Provider value={s}>
        <AiConversation dress={dress} activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={() => undefined} />
      </AiSessionContext.Provider>,
    );
  });
  await settle();
}

const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const set = (s: AiSession, patch: object) => act(() => (s as unknown as { set(p: object): void }).set(patch));

describe.each(["screen", "sheet"] as const)("the check of a mail, dressed as %s", (dress) => {
  it("says it is checking once read_mail runs longer than a moment, and no more once the result is there", async () => {
    expect.hasAssertions();
    const { s } = session([answer("Done.")]);
    await s.load();
    await s.attachVault(vaultHost().host);
    await s.send("What does the mail say?");
    await show(s, dress);
    const id = s.getState().active!.id;
    await set(s, { live: { conversationId: id, text: "", tools: [{ id: "t1", name: "read_mail", state: "running" }], steps: 1 } });
    expect(q("ai-mail-checking")).toBeNull();
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 900))));
    expect(q("ai-mail-checking")?.textContent).toBe(i18n.t("ai.mail.checking"));
    await set(s, { live: { conversationId: id, text: "", tools: [{ id: "t1", name: "read_mail", state: "done" }], steps: 1 } });
    expect(q("ai-mail-checking")).toBeNull();
  });

  it("says under the answer that a mail was too long to check, and not after the next question", async () => {
    expect.hasAssertions();
    const { s } = session([answer("Done.")]);
    await s.load();
    await s.attachVault(vaultHost().host);
    await s.send("What does the mail say?");
    const record = s.getState().active!;
    const turns = [...record.conversation.turns];
    turns.splice(1, 0, { role: "assistant", parts: [{ type: "tool_call", id: "t1", name: "read_mail", args: {} }] } as never, { role: "user", parts: [{ type: "tool_result", id: "t1", content: `Subject: x\n\n${TOO_LONG_TO_CHECK_BODY}` }] } as never);
    await show(s, dress);
    await set(s, { active: { ...record, conversation: { ...record.conversation, turns } }, live: null });
    expect(q("ai-mail-too-long")?.textContent).toBe(i18n.t("ai.mail.tooLongToCheck"));
    await set(s, { active: { ...record, conversation: { ...record.conversation, turns: [...turns, { role: "user", parts: [{ type: "text", text: "Thanks." }] }] } } });
    expect(q("ai-mail-too-long")).toBeNull();
  });
});
