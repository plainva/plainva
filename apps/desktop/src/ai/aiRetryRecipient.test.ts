import { describe, expect, it } from "vitest";
import { type EgressChunk } from "@plainva/core/ai";
import { answer, brokeOff, session, vaultHost } from "./failureClassHarness";

/**
 * "Send again" after a switch of the model (review B7-5, S-R5-1): a try belongs wholly to its recipient. What it
 * measures, asks, shows and keeps is the recipient's of this try — whom it was sent to, whether and for whom the send
 * overview asked, whom the run's record names, whom the notice names — and it inherits only the failed try's content.
 * Every cell below was red at `1219cedee` where the target is a cloud model other than the try's.
 */

type Place = "cloud" | "device";
type Target = "sameProviderOtherModel" | "cloudNeverApproved" | "cloudApproved" | "device" | "unknown";
interface Choice {
  providerId: string;
  model: string;
}

const ORIGIN: Record<Place, Choice> = { cloud: { providerId: "anthropic", model: "m-1" }, device: { providerId: "ollama", model: "llama3" } };
const last = <T>(items: readonly T[]): T => items[items.length - 1]!;
const cloudProvider = (id: string) => ["anthropic", "openai"].includes(id);

function targetOf(origin: Place, target: Target): Choice {
  switch (target) {
    case "sameProviderOtherModel":
      return origin === "cloud" ? { providerId: "anthropic", model: "m-2" } : { providerId: "ollama", model: "qwen2.5" };
    case "cloudNeverApproved":
    case "cloudApproved":
      return { providerId: "openai", model: "gpt-4.1" };
    case "device":
      return { providerId: "lmstudio", model: "local-model" };
    case "unknown":
      return { providerId: "custom-gone", model: "x" };
  }
}

const cells: Array<{ origin: Place; target: Target; confirm: boolean; localOnly: boolean }> = [];
for (const origin of ["cloud", "device"] as const)
  for (const target of ["sameProviderOtherModel", "cloudNeverApproved", "cloudApproved", "device", "unknown"] as const)
    for (const confirm of [false, true]) for (const localOnly of [false, true]) cells.push({ origin, target, confirm, localOnly });

describe("'Send again' belongs wholly to the recipient of its try (review B7-5, S-R5-1)", () => {
  it.each(cells)("from $origin to $target, ask before every request $confirm, fully local $localOnly", async ({ origin, target, confirm, localOnly }) => {
    expect.hasAssertions();
    const to = targetOf(origin, target);
    const approvedBefore = target === "cloudApproved";
    // The retry breaks off too: so the run is kept and the notice names its try.
    const script: EgressChunk[][] = approvedBefore ? [answer("ok"), brokeOff, brokeOff] : [brokeOff, brokeOff];
    const { s, fake, consents } = session(script);
    await s.load();
    if (confirm) await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    await s.attachVault(vaultHost().host);
    if (approvedBefore) {
      // Approved in this session, in a conversation of its own.
      await s.setChoice(to);
      await s.send("An earlier question");
      s.newConversation();
    }
    await s.setChoice(ORIGIN[origin]);
    await s.send("Where is the offer?");
    expect(s.retryable()).not.toBeNull();
    if (localOnly) await s.updateSettings((settings) => ({ ...settings, localOnly: true }));
    await s.setChoice(to);
    const sentBefore = fake.sent.length;
    const askedBefore = consents.length;
    const runsBefore = s.getState().active!.runs.length;
    await s.retryLast();

    const sent = fake.sent.slice(sentBefore).map((spec) => spec.endpointId);
    const asked = consents.slice(askedBefore);
    const runs = s.getState().active!.runs.slice(runsBefore);
    const notice = s.getState().notice;
    const failure = notice?.stop.kind === "failed" ? notice.stop.failure.kind : null;

    // What should happen, in the order the session decides it.
    const refusal =
      target === "unknown" ? "unknown_endpoint" : localOnly && cloudProvider(to.providerId) ? "local_only" : origin === "device" && cloudProvider(to.providerId) ? "kept_on_device" : null;
    // The notice names the try it is about: the one to the target, refused or sent.
    expect(notice?.choice).toEqual(to);
    if (refusal) {
      expect(failure).toBe(refusal);
      expect(sent).toEqual([]);
      expect(asked).toEqual([]);
      expect(runs).toEqual([]);
      return;
    }
    // 1. Sent to the target, once.
    expect(sent).toEqual([to.providerId]);
    // 2. The overview asked for the target, and only where this recipient needs it.
    const toCloud = cloudProvider(to.providerId);
    const newRecipient = toCloud && !approvedBefore && !(origin === "cloud" && to.providerId === ORIGIN.cloud.providerId && to.model === ORIGIN.cloud.model);
    if (toCloud && (confirm || newRecipient)) {
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ providerId: to.providerId, model: to.model, local: false });
      if (newRecipient) expect(asked[0]!.growth).toContain("recipient");
    } else {
      expect(asked).toEqual([]);
    }
    // 3. The run's record names the target, where it runs as it does.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ providerId: to.providerId, model: to.model });
    expect(runs[0]!.manifest).toMatchObject({ providerId: to.providerId, model: to.model, local: !toCloud });
    // 4. The notice after it is about this try.
    expect(failure).not.toBeNull();
  });

  it("R5-A1: cloud to another cloud never approved asks the overview with the reason 'new recipient', naming it", async () => {
    expect.hasAssertions();
    const { s, fake, consents } = session([brokeOff, answer("Hi")]);
    await s.load();
    await s.attachVault(vaultHost().host);
    await s.send("Where is the offer?");
    expect(consents).toHaveLength(1);
    await s.setChoice({ providerId: "openai", model: "gpt-4.1" });
    await s.retryLast();
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["anthropic", "openai"]);
    expect(consents).toHaveLength(2);
    expect(consents[1]).toMatchObject({ providerId: "openai", providerLabel: "OpenAI", model: "gpt-4.1", local: false });
    expect(consents[1]!.growth).toContain("recipient");
  });

  it("R5-A2: under 'Ask before every request' the overview names the model the question goes to, and so does the record", async () => {
    expect.hasAssertions();
    const { s, fake, consents } = session([brokeOff, answer("Hi")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    await s.attachVault(vaultHost().host);
    await s.send("Where is the offer?");
    await s.setChoice({ providerId: "openai", model: "gpt-4.1" });
    await s.retryLast();
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["anthropic", "openai"]);
    expect(consents.map((c) => `${c.providerId}/${c.model}`)).toEqual(["anthropic/m-1", "openai/gpt-4.1"]);
    const run = last(s.getState().active!.runs);
    // The line in the conversation reads the run, the record of what went reads its manifest: one recipient.
    expect(run.providerId).toBe("openai");
    expect(run.manifest).toMatchObject({ providerId: "openai", providerLabel: "OpenAI", model: "gpt-4.1" });
  });

  it("R5-A3: cloud to a model on this device asks no overview and keeps the run as one that ran here", async () => {
    expect.hasAssertions();
    const { s, fake, consents } = session([brokeOff, brokeOff]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    await s.attachVault(vaultHost().host);
    await s.send("Where is the offer?");
    await s.setChoice({ providerId: "ollama", model: "llama3" });
    await s.retryLast();
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["anthropic", "ollama"]);
    expect(consents.map((c) => c.providerId)).toEqual(["anthropic"]);
    const run = last(s.getState().active!.runs);
    expect(run.manifest).toMatchObject({ providerId: "ollama", local: true });
    expect(s.getState().notice!.choice).toEqual({ providerId: "ollama", model: "llama3" });
    // Whom the turn reached is kept with the run that went: the earlier try's cloud, nothing for this device.
    expect(run.departedTo).toEqual(["anthropic"]);
  });

  it("R5-A4: a conversation that ran on this device does not go to a cloud with 'Send again' either", async () => {
    expect.hasAssertions();
    const { s, fake, consents } = session([brokeOff]);
    await s.load();
    await s.attachVault(vaultHost().host);
    await s.setChoice({ providerId: "ollama", model: "llama3" });
    await s.send("Where is the offer?");
    expect(s.retryable()).not.toBeNull();
    await s.setChoice({ providerId: "anthropic", model: "m-1" });
    await s.retryLast();
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["ollama"]);
    expect(consents).toEqual([]);
    const notice = s.getState().notice!;
    expect(notice.stop.kind === "failed" && notice.stop.failure.kind).toBe("kept_on_device");
    expect(notice.choice).toEqual({ providerId: "anthropic", model: "m-1" });
  });

  it("R5-A5: three tries at three models — each overview, record and notice names its own", async () => {
    expect.hasAssertions();
    const { s, fake, consents } = session([brokeOff, brokeOff, brokeOff]);
    await s.load();
    await s.attachVault(vaultHost().host);
    await s.send("Where is the offer?");
    await s.setChoice({ providerId: "openai", model: "gpt-4.1" });
    await s.retryLast();
    expect(s.getState().notice!.choice).toEqual({ providerId: "openai", model: "gpt-4.1" });
    await s.setChoice({ providerId: "anthropic", model: "m-2" });
    await s.retryLast();
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["anthropic", "openai", "anthropic"]);
    expect(consents.map((c) => `${c.providerId}/${c.model}`)).toEqual(["anthropic/m-1", "openai/gpt-4.1", "anthropic/m-2"]);
    expect(s.getState().active!.runs.map((run) => `${run.manifest?.providerId}/${run.manifest?.model}`)).toEqual(["anthropic/m-1", "openai/gpt-4.1", "anthropic/m-2"]);
    expect(s.getState().notice!.choice).toEqual({ providerId: "anthropic", model: "m-2" });
    expect(last(s.getState().active!.runs).departedTo).toEqual(["anthropic", "openai"]);
  });

  it("R5-A6: a model no longer known sends nothing, asks nothing, and the notice names it and whom the turn reached", async () => {
    expect.hasAssertions();
    const { s, fake, consents } = session([brokeOff]);
    await s.load();
    await s.attachVault(vaultHost().host);
    await s.send("Where is the offer?");
    await s.setChoice({ providerId: "custom-gone", model: "x" });
    await s.retryLast();
    expect(fake.sent).toHaveLength(1);
    expect(consents).toHaveLength(1);
    const notice = s.getState().notice!;
    expect(notice.stop.kind === "failed" && notice.stop.failure.kind).toBe("unknown_endpoint");
    expect(notice.choice).toEqual({ providerId: "custom-gone", model: "x" });
    expect(notice.departedTo).toEqual(["anthropic"]);
  });

  it("R5-A7: under 'Fully local', switched to a model on this device, the try is that model's in every respect", async () => {
    expect.hasAssertions();
    const { s, fake, consents } = session([brokeOff, brokeOff]);
    await s.load();
    await s.attachVault(vaultHost().host);
    await s.send("Where is the offer?");
    await s.updateSettings((settings) => ({ ...settings, localOnly: true }));
    await s.setChoice({ providerId: "ollama", model: "llama3" });
    await s.retryLast();
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["anthropic", "ollama"]);
    expect(consents).toHaveLength(1);
    expect(last(s.getState().active!.runs).manifest).toMatchObject({ providerId: "ollama", model: "llama3", local: true });
    expect(s.getState().notice!.choice).toEqual({ providerId: "ollama", model: "llama3" });
  });

  it("what hangs on the model is the new one's: a picture the new model reads none of is marked so in its overview", async () => {
    expect.hasAssertions();
    const { s, consents } = session([brokeOff, answer("A chart.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    const vault = vaultHost();
    await s.attachVault(vault.host);
    await s.send("What is in it?");
    // A turn with a picture in it, as "Explain image" leaves one.
    const stored = vault.saved.get("id1")!;
    const picture = { type: "image" as const, mime: "image/png" as const, data: "iVBORw0KGgo=", name: "chart.png", width: 4, height: 4, path: "chart.png" };
    stored.conversation = { ...stored.conversation, turns: stored.conversation.turns.map((turn, i) => (i === 0 ? { ...turn, parts: [...turn.parts, picture] } : turn)) };
    vault.saved.set("id1", stored);
    await s.open("id1");
    // The provider's own list says the new model reads no pictures.
    (s as unknown as { set(patch: object): void }).set({ tests: { openai: { state: "ok", models: [{ id: "gpt-4.1", vision: false }] } } });
    await s.setChoice({ providerId: "openai", model: "gpt-4.1" });
    await s.retryLast();
    expect(last(consents)).toMatchObject({ providerId: "openai", model: "gpt-4.1", blind: true });
  });
});
