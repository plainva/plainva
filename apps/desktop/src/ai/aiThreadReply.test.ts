// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { machineAuthorId, machineAuthorKind, type CommentOperation, type CommentOperationInput, type CommentOperationService, type MachineWriter, type WorkspaceCommentRecord } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import {
  AI_MENTION_ID,
  addressesAi,
  composerNames,
  isAiAuthorId,
  isAiMentionId,
  isMachineAuthorId,
  mentionQuery,
  namesWithAi,
  parseCommentMentions,
  postThreadReply,
  THREAD_REMARK_MAX_CHARS,
  THREAD_REMARKS_MAX,
  threadReplyRequest,
  useCommentThreadAi,
  withoutAiMention,
  type AiSession,
  type AiState,
} from "@plainva/ui";

/** Plan KI-Harness P3-6: "@AI" in a comment thread — who is addressed, and what the assistant is told. */

const SELF = "de".repeat(16);
const ANNA = "a1".repeat(16);
const AI = "plainva-ai/m-1";
const NAMES = new Map([[SELF, "Marco"], [ANNA, "Anna"], [AI, "Plainva AI · m-1"]]);

function record(over: Partial<WorkspaceCommentRecord> & { commentId: string }): WorkspaceCommentRecord {
  return {
    targetObjectId: "Contract.md", parentCommentId: null, authorMemberId: ANNA, authorDeviceId: ANNA, body: "-", anchor: null,
    createdAt: "2026-09-24T09:00:00.000Z", suggestion: null, resolvedCommentId: null, resolvedAt: null, ...over,
  } as WorkspaceCommentRecord;
}

describe("the assistant as someone a comment can address", () => {
  it("is known under every language's word, whatever this device calls it", () => {
    expect(addressesAi("@KI stimmt das?", "KI")).toBe(true);
    expect(addressesAi("Is that right, @AI?", "KI")).toBe(true);
    expect(addressesAi("@ia ¿es correcto?", "AI")).toBe(true);
    // Not inside an address, not as the start of a longer word, not without the sign.
    expect(addressesAi("write to mail@KI.example", "KI")).toBe(false);
    expect(addressesAi("@KIosk is closed", "KI")).toBe(false);
    expect(addressesAi("KI stimmt das?", "KI")).toBe(false);
  });

  it("asks the model the remark without the mention", () => {
    expect(withoutAiMention("@KI  stimmt das?", "KI")).toBe("stimmt das?");
    expect(withoutAiMention("Summarise this, @AI please", "KI")).toBe("Summarise this, please");
    expect(withoutAiMention("@KI", "KI")).toBe("");
  });

  it("is offered after an @ only where it can answer, and its bylines are never people to address", () => {
    expect(composerNames(NAMES, "KI", true)).toEqual(new Map([[SELF, "Marco"], [ANNA, "Anna"], [AI_MENTION_ID, "KI"]]));
    expect(composerNames(NAMES, "KI", false)).toEqual(new Map([[SELF, "Marco"], [ANNA, "Anna"]]));
    expect(mentionQuery("@", 1, composerNames(NAMES, "KI", true))?.matches.map((match) => match.name)).toEqual(["Anna", "KI", "Marco"]);
    expect(mentionQuery("@k", 2, composerNames(NAMES, "KI", true))?.matches).toEqual([{ memberId: AI_MENTION_ID, name: "KI" }]);
  });

  it("is drawn as a mention on every device, in every spelling", () => {
    const names = namesWithAi(NAMES, "KI");
    const mentions = parseCommentMentions("@AI and @KI and @IA, says @Anna", names).filter((segment) => segment.kind === "mention");
    expect(mentions.map((segment) => segment.text)).toEqual(["@AI", "@KI", "@IA", "@Anna"]);
    expect(mentions.map((segment) => segment.kind === "mention" && isAiMentionId(segment.memberId))).toEqual([true, true, true, false]);
    // The id a reply is written under is an author, not a mention target.
    expect(isAiAuthorId(AI)).toBe(true);
    expect(isAiAuthorId(AI_MENTION_ID)).toBe(false);
    expect(isAiMentionId(AI)).toBe(false);
  });

  it("knows every author no person writes under — the four kinds the core signs with, and no other id", () => {
    // `isMachineAuthorId` says the prefixes again because its file imports nothing: held here against the core's own.
    const writers: MachineWriter[] = [
      { kind: "assistant", model: "m-1" },
      { kind: "mcp", clientId: "3f9a1c2b4d5e6f70" },
      { kind: "acp", agentId: "helper" },
      { kind: "script", name: "tag-count" },
    ];
    for (const writer of writers) {
      const id = machineAuthorId(writer);
      expect(machineAuthorKind(id), id).toBe(writer.kind);
      expect(isMachineAuthorId(id), id).toBe(true);
    }
    for (const id of [SELF, ANNA, AI_MENTION_ID, "mcp:", "acp:", "script:", "plainva-ai/", "mcpx:1", "scripts:x", "member-anna", ""]) {
      expect(isMachineAuthorId(id), id).toBe(machineAuthorKind(id) !== null);
      expect(isMachineAuthorId(id), id).toBe(false);
    }
    // Only the assistant's own byline carries its mark; an app's, an agent's and a script's are machines of another kind.
    expect(writers.map((writer) => isAiAuthorId(machineAuthorId(writer)))).toEqual([true, false, false, false]);
    // And none of their bylines is a person to address after an "@".
    const members = new Map([...NAMES, ["mcp:3f9a1c2b4d5e6f70", "Claude Code (AI app)"], ["acp:helper", "Helper (external agent)"], ["script:tag-count", "Script “Count tags”"], [AI, "Plainva AI · m-1"]]);
    expect([...composerNames(members, "KI", false).keys()]).toEqual([SELF, ANNA]);
  });
});

describe("what the assistant is told of a thread", () => {
  const quote = "renews itself";
  const anchor = { markerId: "7f3a", quote, before: "and ", after: ".", approximateOffset: 40 };
  const root = record({ commentId: "r1", body: "Does this renew by itself?", anchor });
  const mine = record({ commentId: "r2", parentCommentId: "r1", authorMemberId: SELF, authorDeviceId: SELF, body: "I think so.", createdAt: "2026-09-24T09:05:00.000Z" });
  const earlier = record({ commentId: "r3", parentCommentId: "r1", authorMemberId: AI, authorDeviceId: SELF, body: "It does.", createdAt: "2026-09-24T09:06:00.000Z" });
  const posted = { commentId: "p1", parentCommentId: "r1", body: "@KI and when?", quote: null };
  const elsewhere = record({ commentId: "x1", body: "Another thread." });

  it("gives the passage, every earlier remark under a name the model can read, and the question", () => {
    const request = threadReplyRequest({
      path: "Contract.md",
      // Unordered, with another thread and with the remark just sent: the surface may hold either state.
      comments: [earlier, elsewhere, record({ commentId: "p1", parentCommentId: "r1", authorMemberId: SELF, authorDeviceId: SELF, body: posted.body, createdAt: "2026-09-24T09:10:00.000Z" }), mine, root],
      posted,
      names: NAMES,
      selfId: SELF,
      label: "KI",
    });
    expect(request).toEqual({
      path: "Contract.md",
      rootCommentId: "r1",
      quote,
      thread: [
        { author: "Anna", at: "2026-09-24T09:00:00.000Z", body: "Does this renew by itself?" },
        { author: "Marco (the user)", at: "2026-09-24T09:05:00.000Z", body: "I think so." },
        { author: "Plainva AI · m-1", at: "2026-09-24T09:06:00.000Z", body: "It does." },
      ],
      question: "and when?",
    });
  });

  it("starts a thread with the passage the remark was attached to, and nothing else", () => {
    const request = threadReplyRequest({ path: "Contract.md", comments: [root, mine], posted: { commentId: "n1", parentCommentId: null, body: "@AI is this clause usual?", quote: "the clause" }, names: NAMES, selfId: SELF, label: "KI" });
    expect(request).toEqual({ path: "Contract.md", rootCommentId: "n1", quote: "the clause", thread: [], question: "is this clause usual?" });
  });

  it("names an unnamed author honestly and says what a proposal proposes", () => {
    const proposal = record({ commentId: "s1", authorMemberId: "ff".repeat(16), body: "", anchor, suggestion: { replacement: "ends on 31 December", appliedAt: null, appliedBy: null, declinedAt: null } });
    const own = record({ commentId: "s2", parentCommentId: "s1", authorMemberId: SELF, authorDeviceId: SELF, body: "Why?", createdAt: "2026-09-24T09:01:00.000Z" });
    const request = threadReplyRequest({ path: "Contract.md", comments: [proposal, own], posted: { commentId: "s3", parentCommentId: "s1", body: "@KI which is better?", quote: null }, names: new Map(), selfId: SELF, label: "KI" });
    expect(request.thread).toEqual([
      { author: "Another person", at: "2026-09-24T09:00:00.000Z", body: "(Proposes to replace the passage with: ends on 31 December)" },
      { author: "The user", at: "2026-09-24T09:01:00.000Z", body: "Why?" },
    ]);
  });

  it("keeps a long thread's first remark and its latest ones, and cuts an overlong remark", () => {
    const replies = Array.from({ length: 40 }, (_, index) =>
      record({ commentId: `c${index}`, parentCommentId: "r1", body: index === 39 ? "x".repeat(THREAD_REMARK_MAX_CHARS + 500) : `Reply ${index}`, createdAt: new Date(Date.UTC(2026, 8, 24, 10, index)).toISOString() }),
    );
    const request = threadReplyRequest({ path: "Contract.md", comments: [root, ...replies], posted, names: NAMES, selfId: SELF, label: "KI" });
    expect(request.thread).toHaveLength(THREAD_REMARKS_MAX);
    expect(request.thread[0]!.body).toBe("Does this renew by itself?");
    expect(request.thread[1]!.body).toBe(`Reply ${40 - (THREAD_REMARKS_MAX - 1)}`);
    const last = request.thread[request.thread.length - 1]!.body;
    expect(last).toHaveLength(THREAD_REMARK_MAX_CHARS + 1);
    expect(last.endsWith("…")).toBe(true);
  });
});

describe("the assistant for one note's comments", () => {
  type Hook = ReturnType<typeof useCommentThreadAi>;

  /** The session as the hook reads it: its state, and the one door it calls. */
  function stubSession(over: Partial<{ enabled: boolean; hasVault: boolean }> = {}) {
    const state = { loaded: true, settings: { enabled: over.enabled ?? true }, hasVault: over.hasVault ?? true } as unknown as AiState;
    const replyInThread = vi.fn(async () => ({ kind: "refused" as const, reason: "cancelled" as const }));
    const stop = vi.fn();
    const session = { subscribe: () => () => {}, getState: () => state, replyInThread, stop } as unknown as AiSession;
    return { session, replyInThread, stop };
  }

  async function mount(session: AiSession | null, path: string | null, sealed: boolean) {
    await i18n.changeLanguage("en");
    const seen: { current: Hook | null } = { current: null };
    function Probe() {
      const value = useCommentThreadAi(session, path, { sealed });
      useEffect(() => {
        seen.current = value;
      });
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(Probe));
    });
    return { hook: () => seen.current!, unmount: () => act(() => root.unmount()) };
  }

  const context = { comments: [], names: NAMES, selfId: SELF };
  const asked = { commentId: "n1", parentCommentId: null, body: "@AI is this usual?", quote: "the clause" };

  it("offers it where the AI is on and reads this vault, and answers a remark that addresses it", async () => {
    const { session, replyInThread, stop } = stubSession();
    const { hook, unmount } = await mount(session, "Contract.md", false);
    expect(hook().ai).toMatchObject({ label: "AI", replyingTo: null });
    hook().ai!.stop();
    expect(stop).toHaveBeenCalledTimes(1);

    hook().answer({ ...asked, body: "No mention here." }, context);
    expect(replyInThread).not.toHaveBeenCalled();
    await act(async () => {
      hook().answer(asked, context);
    });
    expect(replyInThread).toHaveBeenCalledWith({ path: "Contract.md", rootCommentId: "n1", quote: "the clause", thread: [], question: "is this usual?" });
    unmount();
  });

  it("is absent while the AI is off or reads no vault — a mention is then text like any other", async () => {
    for (const over of [{ enabled: false }, { hasVault: false }]) {
      const { session, replyInThread } = stubSession(over);
      const { hook, unmount } = await mount(session, "Contract.md", false);
      expect(hook().ai).toBeNull();
      hook().answer(asked, context);
      expect(replyInThread).not.toHaveBeenCalled();
      unmount();
    }
    // A window without a session (an auxiliary window) has no assistant either.
    const bare = await mount(null, "Contract.md", false);
    expect(bare.hook().ai).toBeNull();
    bare.hook().answer(asked, context);
    bare.unmount();
  });

  it("is not offered where the remarks are sealed, but a typed mention still gets its answer why", async () => {
    const { session, replyInThread } = stubSession();
    const { hook, unmount } = await mount(session, "Contract.md", true);
    expect(hook().ai).toBeNull();
    await act(async () => {
      hook().answer(asked, context);
    });
    expect(replyInThread).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("writing the assistant's reply", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A comment service that completes whatever it is given; `hold` keeps a run open until released. */
  function service() {
    const ran: CommentOperation[] = [];
    let release: (() => void) | null = null;
    let held = false;
    const fake: CommentOperationService = {
      async prepare(input: CommentOperationInput) {
        return {
          version: 1, operationId: `op${ran.length}`.padEnd(32, "0"), contextKey: "vault", authorKey: "device", notePath: input.notePath, kind: input.kind,
          createdAt: "2026-09-24T10:00:00.000Z", text: null, phase: "prepared", receipt: null, postedIds: [],
          markers: input.markers.map((marker, index) => ({ ...marker, identity: { commentId: `${index}`.padStart(32, "a"), createdAt: "2026-09-24T10:00:00.000Z" } })),
        };
      },
      async run(operation) {
        if (held) await new Promise<void>((resolve) => { release = resolve; });
        ran.push(operation);
        return { ...operation, phase: "completed" };
      },
      async pending() {
        return [];
      },
      async read() {
        return null;
      },
    };
    return { fake, ran, hold: () => { held = true; }, free: () => { held = false; release?.(); } };
  }

  const reply = { path: "Contract.md", parentCommentId: "r1", body: "It renews on 1 January.", author: { id: "plainva-ai/m-1", displayName: "Plainva AI · m-1" } };

  it("posts it through the comment service, under the thread's first remark and the assistant's name", async () => {
    const { fake, ran } = service();
    await postThreadReply(fake, reply);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatchObject({ notePath: "Contract.md", kind: "post", text: null });
    expect(ran[0]!.markers).toEqual([expect.objectContaining({ path: "Contract.md", body: reply.body, parentCommentId: "r1", author: reply.author })]);
  });

  it("waits for the service when the user is sending a remark this very moment, instead of losing the reply", async () => {
    vi.useFakeTimers();
    const { fake, ran, hold, free } = service();
    hold();
    const users = postThreadReply(fake, { ...reply, body: "The user's own remark." });
    await vi.advanceTimersByTimeAsync(0);
    const assistants = postThreadReply(fake, reply);
    // The first run is still open: the second finds the service busy and tries again.
    await vi.advanceTimersByTimeAsync(700);
    expect(ran).toHaveLength(0);
    free();
    await vi.advanceTimersByTimeAsync(400);
    await Promise.all([users, assistants]);
    expect(ran.map((operation) => operation.markers[0]!.body)).toEqual(["The user's own remark.", reply.body]);
  });

  it("gives up with the service's reason when it stays busy or refuses", async () => {
    vi.useFakeTimers();
    const { fake, hold, free } = service();
    hold();
    const first = postThreadReply(fake, { ...reply, body: "Held." });
    await vi.advanceTimersByTimeAsync(0);
    const second = postThreadReply(fake, reply);
    const failed = expect(second).rejects.toThrow("comment-operation-running");
    await vi.advanceTimersByTimeAsync(4_000);
    await failed;
    free();
    await vi.advanceTimersByTimeAsync(0);
    await first;
  });
});
