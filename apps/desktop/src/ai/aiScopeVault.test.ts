import { describe, expect, it } from "vitest";
import { chat, mcpSession, vaultHost } from "./mcpSessionHarness";
import { memoryFiles } from "./mcpTestHost";

/**
 * The send overview's approval belongs to the vault it was given in (review O7, F32). A "Yes" in one vault approved
 * a recipient, kinds of data and the names of top folders; names like "Inbox" or notes at the root are the same in
 * every vault, so another vault's first request went to the same model without an overview. Re-attaching the SAME
 * vault — a shell hands a new host for it whenever what the host is made of changes — keeps it: nothing new is asked.
 */
async function counting() {
  const session = await mcpSession([chat({ text: "One." }), chat({ text: "Two." }), chat({ text: "Three." }), chat({ text: "Four." })]);
  // The harness answers every overview with yes as it opens: counted where it answers.
  let asked = 0;
  const answer = session.s.answerConsent.bind(session.s);
  session.s.answerConsent = ((yes: unknown) => {
    if (yes === true && session.s.getState().consent) asked += 1;
    return answer(yes as never);
  }) as typeof session.s.answerConsent;
  return { ...session, asked: () => asked };
}

describe("the send overview's approval and the vault", () => {
  it("is asked again in another vault, for the same recipient", async () => {
    const { s, asked } = await counting();
    await s.attachVault({ ...vaultHost(memoryFiles(), "vault-a").host, key: "vault-a" });
    expect(await s.send("First question")).toEqual({ kind: "answered" });
    expect(asked()).toBe(1);
    s.newConversation();
    expect(await s.send("Second question")).toEqual({ kind: "answered" });
    expect(asked()).toBe(1);

    await s.attachVault({ ...vaultHost(memoryFiles(), "vault-b").host, key: "vault-b" });
    expect(await s.send("A question in the other vault")).toEqual({ kind: "answered" });
    expect(asked()).toBe(2);
  });

  it("holds when the same vault is attached again, and is gone after the vault was closed", async () => {
    const { s, asked } = await counting();
    await s.attachVault({ ...vaultHost(memoryFiles(), "vault-a").host, key: "vault-a" });
    expect(await s.send("First question")).toEqual({ kind: "answered" });
    await s.attachVault({ ...vaultHost(memoryFiles(), "vault-a").host, key: "vault-a" });
    expect(await s.send("Again in the same vault")).toEqual({ kind: "answered" });
    expect(asked()).toBe(1);

    await s.attachVault(null);
    await s.attachVault({ ...vaultHost(memoryFiles(), "vault-a").host, key: "vault-a" });
    expect(await s.send("After closing it")).toEqual({ kind: "answered" });
    expect(asked()).toBe(2);
  });
});
