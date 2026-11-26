// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import type { EgressChunk } from "@plainva/core/ai";
import { AiConversation, AiSessionContext, type AiSession } from "@plainva/ui/ai";
import { answer, brokeOff, session, settled, unreachable, vaultHost } from "./failureClassHarness";

/**
 * The review of B7 (round 1, M1–M3, M6, M7, H4) as tests: each was red at `b25fed6d4`.
 * The egress answers as the native one does: later, chunk by chunk.
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
async function show(s: AiSession, twice = false): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const one = (dress: "tab" | "dock") => <AiConversation dress={dress} activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={() => undefined} />;
  await act(async () => {
    root!.render(<AiSessionContext.Provider value={s}>{twice ? (<><div>{one("tab")}</div><div>{one("dock")}</div></>) : one("tab")}</AiSessionContext.Provider>);
  });
  await settle();
}
const fields = () => Array.from(document.body.querySelectorAll('[data-testid="ai-input"]')) as HTMLTextAreaElement[];
async function type(input: HTMLTextAreaElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const sendButton = () => document.body.querySelector('[data-testid="ai-send"]') as HTMLElement;

describe("the composer's draft when a conversation is deleted (M1)", () => {
  it("deleting a conversation removes the words kept for its field", async () => {
    const { s } = session([answer("ok")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("First");
    s.keepComposerDraft("id1", "private words for id1");
    await settled();
    expect((await vault.composerDrafts.load("id1"))?.text).toBe("private words for id1");
    await s.remove("id1");
    await settled();
    expect(await vault.composerDrafts.load("id1")).toBeNull();
  });

  it("Delete all removes every kept field, the new conversation's too", async () => {
    const { s } = session([answer("ok")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("First");
    s.keepComposerDraft("id1", "words for id1");
    s.keepComposerDraft("", "words for a new one");
    await settled();
    await s.removeAll();
    await settled();
    expect(vault.files.data.get("vault/composer-drafts.json") ?? null).toBeNull();
  });

  it("deleting with the AI switched off on this device still removes the kept words", async () => {
    const { s } = session([answer("ok"), answer("ok")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("First");
    await s.send("Second");
    s.keepComposerDraft("id1", "words for id1");
    s.keepComposerDraft("id2", "words for id2");
    await settled();
    await s.updateSettings((x) => ({ ...x, enabled: false }));
    await s.remove("id1");
    await settled();
    expect(await vault.composerDrafts.load("id1")).toBeNull();
    await s.removeAll();
    await settled();
    expect(vault.files.data.get("vault/composer-drafts.json") ?? null).toBeNull();
  });

  it("deleting the conversation on screen writes no draft for it afterwards", async () => {
    const { s } = session([answer("ok")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await show(s);
    await type(fields()[0]!, "Q1");
    await act(async () => sendButton().click());
    await settle();
    expect(s.getState().active?.id).toBe("id1");
    await type(fields()[0]!, "half typed follow-up");
    await act(async () => {
      await s.remove("id1");
    });
    await settle();
    await wait(500);
    await settle();
    expect(await vault.composerDrafts.load("id1")).toBeNull();
  });
});

describe("two surfaces of one session (M2)", () => {
  it("what one surface's field holds is still kept after leaving the conversation", async () => {
    const { s } = session([answer("ok")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("First");
    await show(s, true);
    expect(fields()).toHaveLength(2);
    await type(fields()[0]!, "typed in the tab");
    await wait(450);
    await settle();
    expect((await vault.composerDrafts.load("id1"))?.text).toBe("typed in the tab");
    await act(async () => {
      s.newConversation();
    });
    await settle();
    await settled();
    expect((await vault.composerDrafts.load("id1"))?.text).toBe("typed in the tab");
  });
});

describe("two runs of one turn (M3)", () => {
  it("Keep as a note takes the answer that Send again brought", async () => {
    const { s } = session([brokeOff, answer("In the folder.")]);
    await s.load();
    const vault = vaultHost();
    const written: string[] = [];
    (vault.host as { capture?: unknown }).capture = {
      folder: async () => "Inbox",
      write: async (folder: string, stem: string, content: string) => {
        written.push(content);
        return `${folder}/${stem}.md`;
      },
    };
    await s.attachVault(vault.host);
    await s.send("Where is the offer?");
    expect(await s.retryLast()).toEqual({ kind: "answered" });
    const outcome = await s.captureAnswer(0);
    expect(outcome).not.toMatchObject({ kind: "refused" });
    expect(written.join("")).toContain("In the folder.");
  });
});

describe("the links of withdrawing (M6)", () => {
  it("a field emptied by sending keeps no draft of the question", async () => {
    const { s } = session([answer("ok")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await show(s);
    await type(fields()[0]!, "Where is the offer?");
    await wait(450);
    await settle();
    expect((await vault.composerDrafts.load("new"))?.text).toBe("Where is the offer?");
    await act(async () => sendButton().click());
    await settle();
    await settled();
    expect(await vault.composerDrafts.load("new")).toBeNull();
    expect(await vault.composerDrafts.load("id1")).toBeNull();
  });

  it("a follow-up sent in a conversation takes its draft along at once, not when the field's timer comes", async () => {
    const { s } = session([answer("ok"), answer("ok again")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("First");
    await show(s);
    await type(fields()[0]!, "Where is the offer?");
    await wait(450);
    await settle();
    expect((await vault.composerDrafts.load("id1"))?.text).toBe("Where is the offer?");
    await act(async () => sendButton().click());
    await settle();
    await settled();
    // Well before the field's own timer: a restart now must not bring the sent question back.
    expect(await vault.composerDrafts.load("id1")).toBeNull();
  });

  it("a start nobody typed — a skill — never withdraws", async () => {
    const { s } = session([unreachable]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    const skill = s.getState().skills.entries.find((entry) => entry.status === "active" && entry.source.skill);
    expect(skill).toBeDefined();
    await s.runSkill(skill!.source.id, "Where is the offer?");
    expect(s.getState().returned).toBeNull();
    expect(s.getState().notice?.returned).toBeUndefined();
    expect(vault.saved.size).toBe(1);
  });

  it("is never asked of a run whose model was on this device and answered before the refusal", async () => {
    // A model on this device: nothing it got counts as leaving, so only "a model received it" keeps the turn.
    const said: EgressChunk[] = [
      { type: "open", status: 200 },
      { type: "data", text: `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 900, completion_tokens: 0 } })}\n\n` },
      { type: "failed", code: "too_large", message: "request too large" },
    ];
    const { s } = session([said]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.setChoice({ providerId: "ollama", model: "llama3" });
    await s.send("Where is the offer?");
    expect(s.getState().notice?.returned).toBeUndefined();
    expect(s.getState().active!.conversation.turns).toHaveLength(1);
  });

  it("offers no Send again where the last run did not fail, or where tools answered the last turn", async () => {
    const { s } = session([answer("ok")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("Where is the offer?");
    const done = s.getState().active!;
    expect(s.retryable(done)).toBeNull();
    // A last turn of tool results, with a failed run: a model was answered there, nothing to send again.
    const withTools = {
      ...done,
      conversation: { ...done.conversation, turns: [...done.conversation.turns, { role: "user" as const, parts: [{ type: "tool_result" as const, callId: "c1", name: "search_notes", content: "x", isError: false }], at: done.createdAt }] },
      runs: [...done.runs, { ...done.runs[0]!, userTurn: 2, stop: "failed", failure: "offline" }],
    };
    expect(s.retryable(withTools)).toBeNull();
    const failedLast = { ...done, conversation: { ...done.conversation, turns: done.conversation.turns.slice(0, 1) }, runs: [{ ...done.runs[0]!, stop: "cancelled" }] };
    expect(s.retryable(failedLast)).toBeNull();
  });
});

describe("a start that is not typed in the composer never withdraws (review mutation M7)", () => {
  it("an answer in a comment thread that never reached the model leaves the thread's question where it was", async () => {
    const { s, fake } = session([unreachable]);
    await s.load();
    const vault = vaultHost();
    const replies: unknown[] = [];
    (vault.host as { reply?: unknown }).reply = async (reply: unknown) => {
      replies.push(reply);
    };
    await s.attachVault(vault.host);
    await s.replyInThread({ path: "Contract.md", rootCommentId: "c1", quote: null, thread: [{ author: "Anna", body: "Does this renew by itself?", at: "2026-09-24T09:00:00.000Z" }], question: "What does the note say?" });
    // The model was asked (so the start went as far as the call) and nothing came back.
    expect(fake.sent).toHaveLength(1);
    expect(replies).toEqual([]);
    // Nothing goes into the composer: the question stands in the thread, not in the field.
    expect(s.getState().returned).toBeNull();
    expect(s.getState().notice?.returned).toBeUndefined();
  });
});

describe("the setup's test while the AI is off (M7)", () => {
  it("asks no provider while the AI is off on this device", async () => {
    const { s, fake } = session([answer("ok")]);
    await s.load();
    await s.updateSettings((x) => ({ ...x, enabled: false }));
    const test = await s.testProvider("anthropic");
    expect(test).toMatchObject({ state: "failed", failure: { kind: "invalid_request" } });
    expect(fake.sent).toHaveLength(0);
  });
});

describe("the choices made while a withdrawn conversation ran (H4)", () => {
  it("go back onto the start with the question", async () => {
    let release: () => void = () => undefined;
    const late = new Promise<void>((resolve) => (release = resolve));
    const { s, fake } = session([unreachable]);
    const inner = fake.egress.send;
    fake.egress.send = async (id, spec, onChunk) => {
      await late;
      return inner(id, spec, onChunk);
    };
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    const sent = s.send("Where is the offer?");
    await settled();
    // While it runs, the user pins a note to the conversation it begun.
    await s.pin("Plan.md");
    release();
    await sent;
    expect(s.getState().active).toBeNull();
    expect(s.getState().draftPins).toContain("Plan.md");
  });
});
