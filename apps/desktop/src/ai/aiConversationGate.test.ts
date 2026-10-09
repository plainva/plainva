import { describe, expect, it } from "vitest";
import { CLOUD, LOCAL, body, chat, mcpSession, turn } from "./mcpSessionHarness";

/**
 * A conversation and the recipient it goes to (ADR 0018). A conversation is
 * append-only: every request carries all of it. What a model on this device
 * was given may be more than a cloud may have — a note whose rule says "never
 * to the cloud" is read here like any other. So a conversation that carries
 * such a note stays on the device: switching its model to a cloud does not
 * take its past along.
 */
describe("a conversation that carries what a cloud may not have", () => {
  const profiles = { balanced: CLOUD, local: LOCAL };
  const readKept = { id: "c1", name: "read_note", args: { path: "Health/Results.md" } };
  const readOpen = { id: "c1", name: "read_note", args: { path: "Projects/Offer.md" } };

  it("read with a model on this device, it does not go on with a cloud model — nothing of it is sent", async () => {
    const { s, fake } = await mcpSession([chat({ calls: [readKept] }), chat({ text: "They are private." }), turn({ text: "Here they are again." })], { profiles });
    await s.setChoice(LOCAL);
    expect(await s.send("What do my results say?")).toEqual({ kind: "answered" });
    expect(s.getState().active!.runs[0]!.restricted).toEqual(["cloud"]);
    const before = fake.sent.length;
    const turns = s.getState().active!.conversation.turns.length;

    await s.setChoice(CLOUD);
    const stop = await s.send("Say it in other words.");
    expect(stop).toEqual({ kind: "failed", failure: { kind: "kept_on_device" } });
    // No request left for the cloud, and the note's text is in none that was sent anywhere else since.
    expect(fake.sent).toHaveLength(before);
    for (const request of fake.sent) if (request.endpointId === "anthropic") expect(body(request)).not.toContain("Private.");
    // The conversation is as it was: the message that was not sent is not part of it, and the notice says why.
    expect(s.getState().active!.conversation.turns).toHaveLength(turns);
    expect(s.getState().active!.runs).toHaveLength(1);
    expect(s.getState().notice).toMatchObject({ stop: { kind: "failed", failure: { kind: "kept_on_device" } } });
  });

  it("goes on where it was: back with the model on this device", async () => {
    const { s } = await mcpSession([chat({ calls: [readKept] }), chat({ text: "They are private." }), chat({ text: "Still private." })], { profiles });
    await s.setChoice(LOCAL);
    await s.send("What do my results say?");
    await s.setChoice(CLOUD);
    expect(await s.send("Say it in other words.")).toMatchObject({ kind: "failed" });
    await s.setChoice(LOCAL);
    expect(await s.send("Say it in other words.")).toEqual({ kind: "answered" });
    expect(s.getState().notice).toBeNull();
  });

  it("stays here whatever it read: what a model on this device was given was never checked for a cloud", async () => {
    // A note a cloud may read — but read here, its links kept their names, and nothing was hinted at or redacted.
    const { s, fake } = await mcpSession([chat({ calls: [readOpen] }), chat({ text: "An offer for Northwind." }), turn({ text: "For Northwind." })], { profiles });
    await s.setChoice(LOCAL);
    await s.send("What is the offer?");
    expect(s.getState().active!.runs[0]!.restricted).toBeUndefined();
    await s.setChoice(CLOUD);
    expect(await s.send("Who is it for?")).toEqual({ kind: "failed", failure: { kind: "kept_on_device" } });
    expect(fake.sent.every((request) => request.endpointId !== "anthropic")).toBe(true);
  });

  it("is marked from its first message on, and the mark is read back with the conversation", async () => {
    const { s, vault } = await mcpSession([chat({ text: "Hello." })], { profiles });
    await s.setChoice(LOCAL);
    await s.send("Hello?");
    const id = s.getState().active!.id;
    expect(s.getState().active!.onDevice).toBe(true);
    expect((await vault.host.conversations.load(id))!.onDevice).toBe(true);
  });

  it("the way on is a new conversation with the model that was chosen: it carries nothing of the old one", async () => {
    const { s, fake } = await mcpSession([chat({ calls: [readKept] }), chat({ text: "They are private." }), turn({ text: "I know nothing of results." })], { profiles });
    await s.setChoice(LOCAL);
    await s.send("What do my results say?");
    await s.setChoice(CLOUD);
    await s.send("Say it in other words.");
    // What the notice's button does: a new conversation, the chosen model kept.
    const chosen = s.choice()!;
    s.newConversation();
    await s.setChoice(chosen);
    expect(await s.send("Say it in other words.")).toEqual({ kind: "answered" });
    const sent = fake.sent[fake.sent.length - 1]!;
    expect(sent.endpointId).toBe("anthropic");
    expect(body(sent)).not.toMatch(/Private\.|results say/);
    expect(s.getState().active!.onDevice).toBeUndefined();
  });

  it("a conversation that only ever went to a cloud is not looked at: nothing in it was more than a cloud may have", async () => {
    const { s, fake } = await mcpSession([turn({ calls: [readKept] }), turn({ text: "Nothing there." }), turn({ text: "Still nothing." })], { profiles });
    expect(await s.send("What do my results say?")).toEqual({ kind: "answered" });
    // The cloud was told the note is not there; the conversation carries no rule.
    expect(s.getState().active!.runs[0]!.restricted).toBeUndefined();
    await s.setChoice({ providerId: "anthropic", model: "m-2" });
    expect(await s.send("Sure?")).toEqual({ kind: "answered" });
    expect(fake.sent).toHaveLength(3);
  });
});
