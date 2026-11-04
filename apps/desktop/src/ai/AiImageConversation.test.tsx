// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_AI_APP_SETTINGS, effectivePolicy, notePolicyFrom, readConversationRecord, type AiEgress, type ConversationRecord, type EgressChunk, type LedgerEntry } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiConversation, AiSession, AiSessionContext, CHAT_TOOL_NAMES, createVaultToolExecutor, type AiVaultHost, type PreparedImage, type VaultToolDeps } from "@plainva/ui";

/**
 * "Explain image" as the reader sees it (plan KI-Harness P4-5): the whole
 * conversation, driven by a real session — the overview that shows the
 * picture, the message that keeps it, the line that counts it, and what
 * stands under a provider's refusal.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function answer(text: string): EgressChunk[] {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 2400 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 30 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}

const refusal: EgressChunk[] = [{ type: "httpError", status: 400, body: JSON.stringify({ error: { message: "This model does not support image input." } }) }];

async function mounted(script: EgressChunk[][]) {
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const policyOf = async (path: string) => effectivePolicy(path, notePolicyFrom({}), []);
  const deps: VaultToolDeps = { search: async () => [], readNote: async () => null, resolveLink: async () => null, policyOf, taskRows: async () => [], todayKey: () => "2026-10-06", commands: () => [] };
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
    situation: async () => ({ now: "2026-10-06 10:00", weekday: "Tuesday", calendarDay: "2026-10-06", journalDay: "2026-10-06", active: null, tabs: [], tasks: [], events: [], dailyNote: null }),
    candidates: async () => [],
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools: (recipient, scope, redact, web) => ({ names: CHAT_TOOL_NAMES, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact) }),
    embedders: async () => [],
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
    today: () => "2026-10-06",
    now: () => new Date("2026-10-06T10:00:00Z"),
    newId: () => `id${++ids}`,
    label: (key, vars) => i18n.t(key, vars),
  });
  await session.load();
  await session.attachVault(vault);
  void i18n.changeLanguage("en");
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

const PICTURE: PreparedImage = { mime: "image/jpeg", data: "QUJDRA==", width: 1568, height: 1045, bytes: 312_000 };
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

describe("explain image, in the conversation", () => {
  it("shows the picture before it goes, keeps it with the question, and counts it under the answer", async () => {
    const { session, container } = await mounted([answer("A whiteboard with three columns.")]);
    let outcome: unknown;
    await act(async () => {
      void session.explainImage({ path: "Assets/Whiteboard.jpg", load: async () => PICTURE }).then((result) => (outcome = result));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();
    // The overview waits, with the picture as it would go.
    const consent = container.querySelector('[data-testid="ai-consent"]')!;
    expect(consent.querySelector('[data-testid="ai-overview-pictures"] img')!.getAttribute("src")).toBe("data:image/jpeg;base64,QUJDRA==");
    expect(consent.textContent).toContain("image, 1,568 × 1,045 px, 305 KB");

    await act(async () => {
      (container.querySelector('[data-testid="ai-consent-send"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();
    expect(outcome).toEqual({ kind: "answered", conversationId: "id1" });

    // The message: the picture as it went, its name, the question — not the words Plainva put before it.
    const message = container.querySelector(".pv-ai-msg--user")!;
    expect(message.querySelector("figure img")!.getAttribute("src")).toBe("data:image/jpeg;base64,QUJDRA==");
    expect(message.querySelector("figcaption")!.textContent).toBe("Whiteboard.jpg");
    expect(message.querySelector(".pv-ai-usertext")!.textContent).toBe("Explain this image.");
    expect(message.textContent).not.toContain("The picture below is the file");
    expect(container.textContent).toContain("A whiteboard with three columns.");

    // The line under the answer counts the picture. No note went, so nothing could have been cited: no such notice, no coverage.
    const line = container.querySelector(".pv-ai-runline")!.textContent ?? "";
    expect(line).toContain("1 image");
    expect(line).not.toMatch(/coverage/);
    expect(container.querySelector(".pv-ai-nocite")).toBeNull();
  });

  it("under a provider's refusal, says that the model may read no images", async () => {
    const { session, container } = await mounted([refusal]);
    session.subscribe(() => {
      if (session.getState().consent) session.answerConsent(true);
    });
    await act(async () => {
      await session.explainImage({ path: "Assets/Whiteboard.jpg", load: async () => PICTURE });
    });
    await settle();
    expect(container.textContent).toContain("This model does not support image input.");
    expect(container.querySelector('[data-testid="ai-picture-refused"]')!.textContent).toBe("This model may not be able to read images. Choose another one below and ask again.");
    // The question and the picture stay in the conversation.
    expect(container.querySelector(".pv-ai-msg--user figure img")).not.toBeNull();
  });

  it("has no such hint under a refusal in a conversation without a picture", async () => {
    const { session, container } = await mounted([refusal]);
    session.subscribe(() => {
      if (session.getState().consent) session.answerConsent(true);
    });
    await act(async () => {
      await session.send("Hello");
    });
    await settle();
    expect(container.textContent).toContain("This model does not support image input.");
    expect(container.querySelector('[data-testid="ai-picture-refused"]')).toBeNull();
  });
});
