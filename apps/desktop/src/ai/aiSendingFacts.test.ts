import { describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { isCloudRecipient, type EgressChunk, type ModelFailure } from "@plainva/core/ai";
import { conversationFailureText, routineRows, type AiSession, type AiVaultHost } from "@plainva/ui/ai";
import { session, settled, unreachable, vaultHost } from "./failureClassHarness";
import { at, routineSession, routineVault } from "./routineSessionHarness";

/**
 * What the app says about sending holds for the words of THIS request, from typing to the end of its run, and for
 * every way out of the device — not only the models' egress (review B7, round 2: S4, M9, H12, D5). Each was red at
 * `3e48f43fe` (R2-P1, R2-P2a/b of the review are among them).
 */

const vector: EgressChunk[] = [{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) }, { type: "done" }];
const tooLarge: EgressChunk[] = [{ type: "failed", code: "too_large", message: "request too large" }];
const embedding = (endpointId: string, text: string) =>
  ({ endpointId, url: "https://api.openai.com/v1/embeddings", method: "POST", headers: {}, body: { input: [text] }, auth: "bearer", stream: false }) as never;

/** A foreign server that is ready and offers the prompt `summarise`, as the session's MCP side sees it. */
function withServer(s: AiSession, prompt: (args: Record<string, string>, questions?: { ask(question: unknown, signal?: AbortSignal): Promise<unknown> }) => Promise<string>) {
  const askedWith: Array<Record<string, string>> = [];
  const server = {
    id: "srv",
    label: "Remote server",
    transport: "http",
    target: "https://mcp.example/x",
    reviewedTarget: "https://mcp.example/x",
    review: { status: "approved" },
    snapshot: { prompts: [{ name: "summarise" }], tools: [] },
    enabled: true,
    grant: { questions: true },
  };
  const mcp = (s as unknown as { mcp: Record<string, unknown> }).mcp;
  mcp.servers = async () => [server];
  mcp.check = async () => ({ ok: true });
  mcp.pinPrompt = async () => undefined;
  mcp.prompt = async (_id: string, _name: string, args: Record<string, string>, _signal: AbortSignal, questions?: { ask(question: unknown, signal?: AbortSignal): Promise<unknown> }) => {
    askedWith.push({ ...args });
    const text = await prompt(args, questions);
    return { standing: "match", key: "k", body: { description: "", messages: [{ role: "user", content: { type: "text", text } }] } };
  };
  return askedWith;
}

const en = (failure: ModelFailure, departed: boolean, returned = false) => conversationFailureText(i18n.getFixedT("en"), failure, { label: "Anthropic" }, "m-1", { departed, returned });

describe("a foreign server's prompt (S4)", () => {
  it("keeps its turn and never says 'nothing was sent': the user's words were at the server before the run (R2-P1)", async () => {
    const { s, fake } = session([unreachable]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    const askedWith = withServer(s, async (args) => `Summarise ${args.topic}`);
    expect(await s.startMcpPrompt("srv", "summarise", { topic: "my secret project" })).toEqual({ kind: "sent" });
    expect(askedWith).toEqual([{ topic: "my secret project" }]);
    expect(fake.sent).toHaveLength(1);
    const state = s.getState();
    expect(state.notice?.returned).toBeUndefined();
    expect(state.notice?.departedTo).toEqual(["mcp:srv"]);
    expect(state.returned).toBeNull();
    // The server's text stays where it was sent, with its record: "Send again" sends it in place.
    expect(state.active!.conversation.turns.map((turn) => turn.role)).toEqual(["user"]);
  });

  it("the same after the user read the expansion and sent it (sendMcpPrompt)", async () => {
    const { s } = session([unreachable]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    withServer(s, async (args) => `Summarise ${args.topic}`);
    await s.sendMcpPrompt({ serverId: "srv", server: "Remote server", name: "summarise", key: "k", body: { description: "", messages: [] } as never, text: "Summarise my secret project", dropped: 0, truncated: false } as never);
    expect(s.getState().notice?.returned).toBeUndefined();
    expect(s.getState().notice?.departedTo).toEqual(["mcp:srv"]);
  });

  it("the same where the server asked the user first and got an answer", async () => {
    const { s } = session([unreachable]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    const answered: unknown[] = [];
    withServer(s, async (args, questions) => {
      answered.push(await questions!.ask({ kind: "form", message: "Which year?", fields: [] }));
      return `Summarise ${args.topic}`;
    });
    const started = s.startMcpPrompt("srv", "summarise", { topic: "my secret project" });
    await settled();
    const card = s.getState().question!;
    s.answerQuestion(card.id, { action: "accept", content: {} });
    expect(await started).toEqual({ kind: "sent" });
    expect(answered).toEqual([{ action: "accept", content: {} }]);
    expect(s.getState().notice?.returned).toBeUndefined();
    expect(s.getState().notice?.departedTo).toEqual(["mcp:srv"]);
  });
});

describe("what else the device sends while a question runs (M9)", () => {
  it("withdraws where only something else went out: no word of the question in it (R2-P2a)", async () => {
    const { s } = session([vector, unreachable]);
    await s.load();
    const vault = vaultHost();
    vault.host.candidates = async () => {
      await s.egress.send("bg-1", { endpointId: "gemini", url: "https://generativelanguage.googleapis.com/v1/x", method: "POST", headers: {}, body: { input: ["a note"] }, auth: "bearer", stream: false } as never, () => undefined);
      return [];
    };
    await s.attachVault(vault.host);
    await s.send("Where is the offer?");
    expect({ returned: s.getState().notice?.returned, departedTo: s.getState().notice?.departedTo }).toEqual({ returned: true, departedTo: undefined });
  });

  it("a too-large request keeps its own words where something else went at the same time (R2-P2b)", async () => {
    const { s } = session([vector, tooLarge]);
    await s.load();
    const vault = vaultHost();
    vault.host.candidates = async () => {
      await s.egress.send("bg-1", { endpointId: "openai", url: "https://api.openai.com/v1/embeddings", method: "POST", headers: {}, body: {}, auth: "bearer", stream: false } as never, () => undefined);
      return [];
    };
    await s.attachVault(vault.host);
    await s.send("Where is the offer?");
    await settled();
    expect(s.getState().notice?.departedTo).toBeUndefined();
  });
});

describe("the notice's words about sending (D5)", () => {
  it("say 'nothing was sent' with reason and remedy where nothing of the request left", () => {
    expect(en({ kind: "too_large" }, false)).toBe("The request is too large to send. Nothing was sent. Usually an image is too big.");
    expect(en({ kind: "invalid_request", message: "x" }, false)).toBe("Plainva could not put this request together. Nothing was sent. Please report this as a bug.");
    expect(en({ kind: "window_too_small", needed: 9000, window: 8192 }, false)).toContain("the window stated for m-1 is 8192. Nothing was sent. Raise the window");
    expect(en({ kind: "local_only" }, false)).toBe("“Fully local” is on, and Anthropic does not run on this device. Nothing was sent. Choose a model on this device, or switch “Fully local” off.");
  });

  it("keep reason and remedy, and claim nothing about sending, where something of the request left before the model call", () => {
    // The way out stays named: an image too big, the window to raise, a bug to report, the switch — never "Something went wrong".
    expect(en({ kind: "too_large" }, true)).toBe("The request is too large to send. Usually an image is too big.");
    expect(en({ kind: "invalid_request", message: "x" }, true)).toBe("Plainva could not put this request together. Please report this as a bug.");
    expect(en({ kind: "window_too_small", needed: 9000, window: 8192 }, true)).toBe(
      "This request needs about 9000 tokens; the window stated for m-1 is 8192. Raise the window at the server and in the profile, switch “Can call tools” off for this model, or leave notes out.",
    );
    expect(en({ kind: "local_only" }, true)).toBe("“Fully local” is on, and Anthropic does not run on this device. Choose a model on this device, or switch “Fully local” off.");
    for (const kind of ["too_large", "window_too_small"] as const) {
      const text = en(kind === "too_large" ? { kind } : { kind, needed: 9000, window: 8192 }, true);
      expect(text).not.toMatch(/nothing was sent|Something went wrong/i);
    }
  });

  it("the same in German, where the sentence stands in the middle", () => {
    const de = (failure: ModelFailure, departed: boolean) => conversationFailureText(i18n.getFixedT("de"), failure, { label: "Anthropic" }, "m-1", { departed });
    expect(de({ kind: "too_large" }, false)).toBe("Die Anfrage ist zu groß zum Senden. Es wurde nichts gesendet. Meist ist ein Bild zu groß.");
    expect(de({ kind: "too_large" }, true)).toBe("Die Anfrage ist zu groß zum Senden. Meist ist ein Bild zu groß.");
  });
});

describe("the context preview sends nothing (H12)", () => {
  it("asks no model off this device, and says that it held the search back", async () => {
    const { s, fake } = session([]);
    await s.load();
    const vault = vaultHost();
    const handed: string[] = [];
    vault.host.candidates = async (question, _active, _recipient, egress) => {
      handed.push(question);
      await egress.send("emb-preview", embedding("openai", question), () => undefined);
      return [];
    };
    await s.attachVault(vault.host);
    const preview = (await s.previewContext("Where is the offer?"))!;
    expect(handed).toEqual(["Where is the offer?"]);
    expect(fake.sent).toEqual([]);
    expect(preview.searchHeldBack).toBe(true);
  });

  it("lets a search model on this device answer, and holds nothing back then", async () => {
    const { s, fake } = session([vector]);
    await s.load();
    const vault = vaultHost();
    vault.host.candidates = async (question, _active, _recipient, egress) => {
      await egress.send("emb-preview", embedding("ollama", question), () => undefined);
      return [];
    };
    await s.attachVault(vault.host);
    const preview = (await s.previewContext("Where is the offer?"))!;
    expect(fake.sent).toHaveLength(1);
    expect(preview.searchHeldBack).toBe(false);
  });
});

describe("every way a run takes is in its list, not only the models' egress (review B7-2)", () => {
  it("a foreign server's tool call: a later refusal before sending says nothing about sending", async () => {
    const { mcpSession, connect, turn, viaDispatch, answering, SEARCH } = await import("./mcpSessionHarness");
    // The model asks the tracker; the second model call is refused as too large before it goes.
    const { s, server } = await mcpSession([turn({ calls: [viaDispatch("c1", SEARCH, { query: "login" })] }), tooLarge]);
    await connect(s);
    answering(s, () => "once");
    await s.send("Search the tracker for login.");
    expect(server.calls.length).toBeGreaterThan(0);
    const notice = s.getState().notice!;
    expect(notice.stop.kind === "failed" && notice.stop.failure.kind).toBe("too_large");
    expect(notice.departedTo).toEqual(expect.arrayContaining(["anthropic", "mcp:tracker"]));
  });
});

/** The search's way with a cloud search model, as `gatherCandidates` takes it: the question goes out through the run's egress. */
function cloudSearchOf(vault: { host: { candidates: AiVaultHostCandidates } }) {
  const asked: string[] = [];
  const own = vault.host.candidates;
  vault.host.candidates = async (question, active, recipient, egress) => {
    asked.push(question);
    if (recipient && isCloudRecipient(recipient)) await egress.send(`emb-${asked.length}`, embedding("openai", question), () => undefined);
    return own(question, active, recipient, egress);
  };
  return asked;
}
type AiVaultHostCandidates = AiVaultHost["candidates"];

describe("a routine that stops for its user (review B7-3, S5)", () => {
  const NOTES = { "Projects/Offer.md": "# Offer\n\nFor Northwind, due on Friday.", "Journal/2026-10-08.md": "# Thursday\n\nCalled the studio." };
  const lineOf = (h: Awaited<ReturnType<typeof routineSession>>) => {
    const t = i18n.getFixedT("en");
    const rows = routineRows(t, { list: h.s.getState().routines.list, running: null, entries: h.s.getState().skills.entries, settings: h.s.getState().settings }, at(9, 7, 2), "en");
    return rows.find((row) => row.name === "Morning brief")!.status;
  };

  it("says no 'nothing was sent' where its request had gone to a search model in the cloud", async () => {
    const vault = routineVault(NOTES);
    vault.touch("Projects/Offer.md", NOTES["Projects/Offer.md"], at(8, 18).getTime());
    cloudSearchOf(vault);
    const h = await routineSession([vector, vector], vault);
    await h.setUp({ request: "Look at the tax audit" });
    // A note changes overnight in a folder it was not confirmed for: the run would bring along more.
    vault.touch("Finance/Tax 2026.md", "# Tax\n\nThe advance payment is due.", at(9, 6, 30).getTime());
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const last = h.s.getState().routines.list.find((routine) => routine.name === "Morning brief")!.last;
    expect(last).toMatchObject({ outcome: "needs-you", need: "scope", departed: true });
    expect(lineOf(h)).toBe("Needs you: the routine would now send more than you confirmed.");
  });

  it("says 'nothing was sent' where nothing of it had left", async () => {
    const vault = routineVault(NOTES);
    vault.touch("Projects/Offer.md", NOTES["Projects/Offer.md"], at(8, 18).getTime());
    const h = await routineSession([], vault);
    await h.setUp({ request: "Look at the tax audit" });
    vault.touch("Finance/Tax 2026.md", "# Tax\n\nThe advance payment is due.", at(9, 6, 30).getTime());
    h.go(at(9, 7, 1));
    expect(await h.s.runDueRoutines()).toBe(1);
    const last = h.s.getState().routines.list.find((routine) => routine.name === "Morning brief")!.last;
    expect(last).toMatchObject({ outcome: "needs-you", need: "scope" });
    expect(last!.departed).toBeUndefined();
    expect(lineOf(h)).toBe("Needs you: the routine would now send more than you confirmed. Nothing was sent.");
  });
});

describe("'Send again' is the same turn (review B7-3, S6)", () => {
  const broke: EgressChunk[] = [{ type: "failed", code: "network", message: "error sending request: connection closed before message completed" }];

  it("after a try that may have arrived, a refusal before sending says no 'nothing was sent' (R3-A5)", async () => {
    const { s, fake } = session([broke]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("Where is the offer?");
    expect(fake.sent).toHaveLength(1);
    await s.updateSettings((settings) => ({ ...settings, localOnly: true }));
    await s.retryLast();
    const notice = s.getState().notice!;
    expect(notice.stop.kind === "failed" && notice.stop.failure.kind).toBe("local_only");
    expect(notice.departedTo).toEqual(["anthropic"]);
    expect(en({ kind: "local_only" }, Boolean(notice.departedTo?.length))).not.toMatch(/Nothing was sent/);
    // The turn stays, as it was.
    expect(s.getState().active!.conversation.turns.map((turn) => turn.role)).toEqual(["user"]);
  });

  it("the same after a restart: whom the earlier try reached is kept with the conversation", async () => {
    const first = session([broke]);
    await first.s.load();
    const vault = vaultHost();
    await first.s.attachVault(vault.host);
    await first.s.send("Where is the offer?");
    const id = first.s.getState().active!.id;
    const runs = vault.saved.get(id)!.runs;
    expect(runs[runs.length - 1]!.departedTo).toEqual(["anthropic"]);
    // A new run of the app: the conversation is read back from the vault.
    const again = session([tooLarge]);
    await again.s.load();
    await again.s.attachVault(vault.host);
    await again.s.open(id);
    await again.s.retryLast();
    const notice = again.s.getState().notice!;
    expect(notice.stop.kind === "failed" && notice.stop.failure.kind).toBe("too_large");
    expect(notice.departedTo).toEqual(["anthropic"]);
  });
});

describe("the preview holds back only what a send would ask (review B7-3, S7)", () => {
  it("says nothing held back while the device is fully local: a send asks no search model in the cloud either", async () => {
    const { s, fake } = session([]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, localOnly: true }));
    const vault = vaultHost();
    vault.host.candidates = async (question, _active, _recipient, egress) => {
      await egress.send("emb-preview", embedding("openai", question), () => undefined);
      return [];
    };
    await s.attachVault(vault.host);
    const preview = await s.previewContext("Where is the offer?");
    expect(fake.sent).toEqual([]);
    expect(preview?.searchHeldBack ?? false).toBe(false);
  });
});
