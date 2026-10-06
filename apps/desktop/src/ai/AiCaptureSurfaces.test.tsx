// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_AI_APP_SETTINGS, effectivePolicy, notePolicyFrom, readConversationRecord, readFrontmatterPath, type AiEgress, type ConversationRecord, type EgressChunk, type LedgerEntry } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiConversation, AiEffectApproval, AiSession, AiSessionContext, CHAT_TOOL_NAMES, createVaultToolExecutor, toast, toastStore, writeCapturedNote, type AiVaultHost, type VaultToolDeps } from "@plainva/ui";

/**
 * "Keep as a note" as the reader sees it (plan KI-Harness P4-6), shared by
 * both shells: the button under a finished answer, the note it makes, and
 * the question that comes first where other people read the vault.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  toast.clearAll();
});

function answer(text: string): EgressChunk[] {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 40 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 30 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
const click = async (el: Element | null | undefined) => {
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
};

/** A note in a folder the vault's rules keep from the internet: it still goes along in a conversation without it. */
const KEPT_FROM_WEB = { path: "Private/Client.md", title: "Client", text: "# Client\n\nNorthwind pays 2,400 euros a day." };

async function mounted(script: EgressChunk[][], options: { shared?: boolean; capture?: boolean; tabs?: boolean; openPrivate?: boolean } = {}) {
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const written = new Map<string, string>();
  const dirs = new Set<string>();
  const opened: string[] = [];
  /** What a shell with tabs opens in a tab of its own. */
  const besides: string[] = [];
  const policyOf = async (path: string) => effectivePolicy(path, notePolicyFrom({}), [{ folder: "Private/", web: "deny" }]);
  const open = options.openPrivate ? KEPT_FROM_WEB : null;
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
    activeNote: async () => open,
    readNote: async (path) => (open && path === open.path ? open : null),
    situation: async () => ({ now: "2026-10-06 10:00", weekday: "Tuesday", calendarDay: "2026-10-06", journalDay: "2026-10-06", active: open ? { kind: "note" as const, path: open.path, title: open.title } : null, tabs: [], tasks: [], events: [], dailyNote: null }),
    candidates: async () => [],
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools: (recipient, scope, redact, web) => ({ names: CHAT_TOOL_NAMES, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact) }),
    encrypted: () => options.shared === true,
    ...(options.capture === false
      ? {}
      : {
          capture: {
            folder: async () => "Inbox",
            write: (folder, stem, content) =>
              writeCapturedNote({ exists: async (path) => written.has(path) || dirs.has(path), createDir: async (path) => void dirs.add(path), writeTextFile: async (path, text) => void written.set(path, text) }, folder, stem, content),
          },
        }),
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
  // The send overview is approved as it comes; these tests are about what stands under the answer.
  session.subscribe(() => {
    if (session.getState().consent) session.answerConsent(true);
  });
  await session.load();
  await session.attachVault(vault);
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiSessionContext.Provider value={session}>
        <AiConversation
          dress="window"
          activeNote={null}
          onOpenNote={(path) => void opened.push(path)}
          {...(options.tabs ? { onOpenCreated: (path: string) => void besides.push(path) } : {})}
          onOpenUrl={() => undefined}
          onOpenSettings={() => undefined}
        />
      </AiSessionContext.Provider>,
    );
  });
  const ask = async (question: string) => {
    await act(async () => {
      await session.send(question);
    });
    await settle();
  };
  return { session, container: host, written, opened, besides, ask };
}

const captureButtons = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="ai-capture"]'));

describe("keep as a note, under an answer", () => {
  it("stands under a finished answer, writes the note and opens it", async () => {
    const { container, written, opened, ask } = await mounted([answer("The day rate is 1,900 euros. See https://example.org/rates.")]);
    expect(captureButtons(container)).toHaveLength(0);
    await ask("What is the day rate for 2026?");
    const [button] = captureButtons(container);
    expect(button!.textContent).toBe("Keep as a note");
    expect(button!.disabled).toBe(false);

    await click(button);
    expect(opened).toEqual(["Inbox/What is the day rate for 2026.md"]);
    const note = written.get("Inbox/What is the day rate for 2026.md")!;
    expect(readFrontmatterPath(note, ["generated", "by"])).toBe("plainva-ai/m-1");
    expect(note).toContain("> Answer by Plainva AI · m-1, ");
    expect(note).toContain("to: “What is the day rate for 2026?”");
    // The address the model wrote is text in the note, nothing to follow.
    expect(note).toContain("See https[://]example.org/rates.");
    expect(toastStore.get().map((item) => [item.kind, item.message])).toEqual([["success", "Kept as a note: What is the day rate for 2026?"]]);
    // The answer stays where it was, and can be kept again: the next note gets the next name.
    expect(captureButtons(container)).toHaveLength(1);
    await click(captureButtons(container)[0]);
    expect([...written.keys()]).toEqual(["Inbox/What is the day rate for 2026.md", "Inbox/What is the day rate for 2026 2.md"]);
  });

  it("opens the new note beside what is open where the shell has tabs: the conversation is not replaced", async () => {
    const { container, opened, besides, ask } = await mounted([answer("An answer.")], { tabs: true });
    await ask("A question?");
    await click(captureButtons(container)[0]);
    expect(besides).toEqual(["Inbox/A question.md"]);
    // A link in an answer still opens the way every note opens; only the note just made has its own way.
    expect(opened).toEqual([]);
  });

  it("says so when the note carries a privacy rule of the notes it rests on", async () => {
    const { container, written, ask } = await mounted([answer("Northwind pays 2,400 euros a day.")], { openPrivate: true });
    await ask("What does this client pay?");
    await click(captureButtons(container)[0]);
    expect(toastStore.get().map((item) => [item.kind, item.message])).toEqual([["success", "Kept as a note: What does this client pay?. It carries the privacy rules of the notes it rests on."]]);
    // The open note is kept from the internet; the note made from it is too, wherever it lies.
    expect(readFrontmatterPath(written.get("Inbox/What does this client pay.md")!, ["plainva", "ai"])).toEqual({ web: "deny" });
  });

  it("has one button for each answer, and none for a run that brought no answer", async () => {
    const { container, written, opened, ask } = await mounted([answer("First answer."), [{ type: "httpError", status: 500, body: "{}" }], answer("Third answer.")]);
    await ask("First question?");
    await ask("Second question?");
    await ask("Third question?");
    const buttons = captureButtons(container);
    expect(buttons).toHaveLength(2);
    // Each keeps its own answer under its own question.
    await click(buttons[1]);
    expect(opened).toEqual(["Inbox/Third question.md"]);
    expect(written.get("Inbox/Third question.md")).toContain("Third answer.");
    expect(written.get("Inbox/Third question.md")).not.toContain("First answer.");
  });

  it("is not there where the shell writes no notes", async () => {
    const { container, ask } = await mounted([answer("An answer.")], { capture: false });
    await ask("A question?");
    expect(container.textContent).toContain("An answer.");
    expect(captureButtons(container)).toHaveLength(0);
  });

  it("asks first where other people read the vault, and a no writes nothing", async () => {
    const { container, written, opened, ask } = await mounted([answer("An answer.")], { shared: true });
    await ask("Who signs the contract?");
    await click(captureButtons(container)[0]);
    const card = container.querySelector('[data-testid="ai-effect"]')!;
    expect(card.getAttribute("data-kind")).toBe("write");
    expect(card.getAttribute("aria-label")).toBe("Keep it where others read it?");
    expect(card.querySelector('[data-testid="ai-effect-note"]')!.textContent).toBe("Who signs the contract?");
    expect(card.textContent).toContain("Goes intoInbox");
    expect(card.textContent).toContain("This vault is a shared workspace: its members can read a note here, and so can the readers of a publication that covers the folder.");
    expect(Array.from(card.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Don't keep", "Keep as a note"]);
    // While the question stands, the button under the answer waits.
    expect(captureButtons(container)[0]!.disabled).toBe(true);

    await click(card.querySelector('[data-testid="ai-effect-deny"]'));
    expect(container.querySelector('[data-testid="ai-effect"]')).toBeNull();
    expect(written.size).toBe(0);
    expect(opened).toEqual([]);
    expect(toastStore.get()).toEqual([]);

    // A second press asks again; a yes writes this one note.
    await click(captureButtons(container)[0]);
    await click(container.querySelector('[data-testid="ai-effect-allow"]'));
    expect([...written.keys()]).toEqual(["Inbox/Who signs the contract.md"]);
    expect(opened).toEqual(["Inbox/Who signs the contract.md"]);
  });
});

describe("the question before a note is written where others read it", () => {
  it("names the note and the folder, and takes yes for this one note or no", () => {
    void i18n.changeLanguage("en");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onAnswer = vi.fn();
    act(() => root!.render(<AiEffectApproval request={{ id: "capture-1", kind: "write", audience: "members", title: "Rates 2026", folder: "" }} onAnswer={onAnswer} touch />));
    const card = host.querySelector('[data-testid="ai-effect"]')!;
    expect(card.className).toContain("pv-ai-overview--touch");
    expect(card.querySelector('[data-testid="ai-effect-note"]')!.textContent).toBe("Rates 2026");
    // The top of the vault has a name too.
    expect(card.textContent).toContain("Goes into/");
    act(() => (card.querySelector('[data-testid="ai-effect-allow"]') as HTMLElement).click());
    act(() => (card.querySelector('[data-testid="ai-effect-deny"]') as HTMLElement).click());
    // One yes is for one note: there is no "always".
    expect(onAnswer.mock.calls.map((call) => call[0])).toEqual(["once", "deny"]);
  });
});
