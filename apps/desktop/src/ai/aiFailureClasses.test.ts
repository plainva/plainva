import { describe, expect, it } from "vitest";
import { readConversationRecord, type EgressChunk } from "@plainva/core/ai";
import { transcriptOf } from "@plainva/ui/ai";
import { answer, brokeOff, session, settled, unreachable, vaultHost } from "./failureClassHarness";

/**
 * The two classes of a failed request in a conversation (plan Umsetzung 0.9.x, B7; M9, F71). "Nothing was sent"
 * stands only where the device decided before anything left it; there, and only for a question the user typed, the
 * turn is withdrawn and the question goes back into the field. Every other failure keeps the turn and its record, and
 * "Send again" sends the same turn once more where it stands.
 *
 * The egress answers the way the shells' native egress does: later, chunk by chunk, after the call returned to the
 * event loop — never at once inside `send`.
 */

describe("a request that never left the device, typed in the composer", () => {
  it("withdraws the turn of a conversation it would have begun, and the question goes back into the field", async () => {
    const { s } = session([unreachable]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    const stop = await s.send("Where is the offer?");
    expect(stop).toMatchObject({ kind: "failed", failure: { kind: "unreachable" } });
    const state = s.getState();
    // Nothing of it stands: no conversation, nothing stored, the start page as before.
    expect(state.active).toBeNull();
    expect(vault.saved.size).toBe(0);
    expect(state.summaries).toEqual([]);
    expect(state.notice).toMatchObject({ conversationId: "", returned: true, stop: { kind: "failed", failure: { kind: "unreachable" } } });
    // The field takes the question once.
    expect(s.takeReturned("")).toBe("Where is the offer?");
    expect(s.takeReturned("")).toBeNull();
    // Kept on this device too: a restart before it goes again does not lose it.
    await settled();
    expect((await vault.composerDrafts.load("new"))?.text).toBe("Where is the offer?");
    // The attempt is counted, with nothing used.
    expect(vault.ledger()).toHaveLength(1);
    expect(vault.ledger()[0]!.usage.inputTokens).toBe(0);
  });

  it("puts a conversation back as it was stored, and its next message is the next turn", async () => {
    const { s } = session([answer("In the folder."), unreachable, answer("Tomorrow.")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("Where is the offer?");
    const before = JSON.stringify(vault.saved.get("id1"));
    await s.send("When is it due?");
    const state = s.getState();
    expect(state.active!.conversation.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(state.active!.runs).toHaveLength(1);
    expect(JSON.stringify(vault.saved.get("id1"))).toBe(before);
    expect(state.notice).toMatchObject({ conversationId: "id1", returned: true });
    expect(s.takeReturned("id1")).toBe("When is it due?");
    // Sent again, it is the conversation's next turn — not a third one after a lost one.
    await s.send("When is it due?");
    expect(s.getState().active!.conversation.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(s.getState().active!.runs.map((run) => run.userTurn)).toEqual([0, 2]);
  });

  it("does not withdraw after a provider answered on the way (a rate limit, then no connection)", async () => {
    const limited: EgressChunk[] = [{ type: "httpError", status: 429, body: "{}", retryAfter: "0" }];
    const { s } = session([limited, unreachable]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("Where is the offer?");
    // The first attempt reached the provider: the turn and its record stay, and nothing says "nothing was sent".
    expect(s.getState().active!.conversation.turns).toHaveLength(1);
    expect(s.getState().notice?.returned).toBeUndefined();
    expect(vault.saved.get("id1")!.runs).toHaveLength(1);
  });
});

describe("a request that may have arrived", () => {
  it("keeps the turn and its record, and Send again sends the same turn once more where it stands", async () => {
    const { s, fake } = session([brokeOff, answer("In the folder.")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("Where is the offer?");
    const failed = s.getState().active!;
    expect(failed.conversation.turns.map((t) => t.role)).toEqual(["user"]);
    expect(failed.runs).toMatchObject([{ userTurn: 0, stop: "failed", failure: "offline" }]);
    expect(failed.runs[0]!.manifest).toBeDefined();
    expect(s.getState().notice?.returned).toBeUndefined();
    expect(s.retryable()).toMatchObject({ userTurn: 0, images: 0 });

    const stop = await s.retryLast();
    expect(stop).toEqual({ kind: "answered" });
    const record = s.getState().active!;
    // No new turn: the user's one, then the answer; two runs of the same turn, the first one's record kept.
    expect(record.conversation.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(record.runs.map((run) => [run.userTurn, run.stop])).toEqual([
      [0, "failed"],
      [0, "answered"],
    ]);
    expect(record.runs[1]!.manifest).toEqual(record.runs[0]!.manifest);
    expect(vault.saved.get("id1")!.runs).toHaveLength(2);
    // The same request went: the turn's words, once.
    expect(JSON.stringify(fake.sent[1]!.body)).toContain("Where is the offer?");
    expect(JSON.stringify(fake.sent[1]!.body).split("Where is the offer?").length).toBe(JSON.stringify(fake.sent[0]!.body).split("Where is the offer?").length);
    // Both runs keep their line in the transcript.
    expect(transcriptOf(record).filter((item) => item.kind === "run")).toHaveLength(2);
    // Nothing failed any more: nothing to send again.
    expect(s.retryable()).toBeNull();
    expect(await s.retryLast()).toBeNull();
  });

  it("leaves the picture out when asked, and the conversation keeps it, said as not sent", async () => {
    const tooLarge: EgressChunk[] = [{ type: "httpError", status: 413, body: '{"error":{"message":"request too large"}}' }];
    const { s, fake } = session([brokeOff, tooLarge, answer("A chart.")]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("What is in it?");
    // A turn with a picture in it, as "Explain image" leaves one (the composer itself takes none).
    const stored = vault.saved.get("id1")!;
    const picture = { type: "image" as const, mime: "image/png" as const, data: "iVBORw0KGgo=", name: "chart.png", width: 4, height: 4, path: "chart.png" };
    stored.conversation = { ...stored.conversation, turns: stored.conversation.turns.map((turn, i) => (i === 0 ? { ...turn, parts: [...turn.parts, picture] } : turn)) };
    vault.saved.set("id1", stored);
    await s.open("id1");
    expect(s.retryable()).toMatchObject({ userTurn: 0, images: 1 });

    expect(await s.retryLast()).toMatchObject({ kind: "failed", failure: { kind: "context_too_long" } });
    // The provider had the picture this time.
    expect(JSON.stringify(fake.sent[1]!.body)).toContain("iVBORw0KGgo=");
    expect(await s.retryLast({ withoutImages: true })).toEqual({ kind: "answered" });
    // The request carried no picture; the turn still has it, and its run says it was left out.
    expect(JSON.stringify(fake.sent[2]!.body)).not.toContain("iVBORw0KGgo=");
    expect(JSON.stringify(fake.sent[2]!.body)).toContain("What is in it?");
    const record = s.getState().active!;
    expect(record.conversation.turns[0]!.parts.some((part) => part.type === "image")).toBe(true);
    expect(record.runs.map((run) => run.left ?? null)).toEqual([null, null, ["image"]]);
    expect(readConversationRecord(JSON.parse(JSON.stringify(vault.saved.get("id1"))))!.runs[2]!.left).toEqual(["image"]);
    expect(transcriptOf(record).find((item) => item.kind === "user")).toMatchObject({ imagesNotSent: true });
  });
});

describe("a start nobody typed", () => {
  it("never withdraws what it started, even when nothing left the device (the setup's greeting)", async () => {
    const { s } = session([unreachable]);
    await s.load();
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.sendGreeting("Hello");
    expect(s.getState().active!.conversation.turns).toHaveLength(1);
    expect(s.getState().notice?.returned).toBeUndefined();
    expect(s.getState().returned).toBeNull();
    expect(vault.saved.size).toBe(1);
  });
});
