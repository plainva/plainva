// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AI_AUDIO_PROFILE, type AiProfileSlot } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiConversation, AiSessionContext, useAiState, type AiSession } from "@plainva/ui";
import { AiModelDialog } from "../components/settings/AiDialogs";
import { AiModeCard } from "../components/settings/AiModeCard";
import { CLOUD, LOCAL, chat, mcpSession, turn } from "./mcpSessionHarness";

/**
 * "Fully local" as the reader meets it on the desktop (plan KI-Harness P7,
 * ADR 0030, mockup chapter 23): the mode card with its one switch, what a
 * user says about a model on a server of this device, and the conversation
 * while the switch is on — each driven by the real session.
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

async function show(session: AiSession, node: ReactNode): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AiSessionContext.Provider value={session}>{node}</AiSessionContext.Provider>);
  });
  return host;
}
const settle = async () => {
  await act(async () => {
    for (let turns = 0; turns < 12; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const click = async (el: Element | null | undefined) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
};
/** Types into a field the way a person does: the value, then the event React listens for. */
const type = async (el: Element | null, value: string) => {
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    setter.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const fullyLocal = (session: AiSession) => act(async () => void (await session.updateSettings((settings) => ({ ...settings, localOnly: true }))));

function Card({ session, onSetUp }: { session: AiSession; onSetUp: () => void }) {
  const state = useAiState();
  return state ? <AiModeCard session={session} state={state} onSetUp={onSetUp} /> : null;
}
function Dialog({ session, profile, onClose }: { session: AiSession; profile: AiProfileSlot; onClose: () => void }) {
  const state = useAiState();
  return state ? <AiModelDialog session={session} state={state} profile={profile} onClose={onClose} /> : null;
}
const conversation = <AiConversation dress="window" activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={() => undefined} />;

describe("the mode card", () => {
  it("says what holds now, and that only the switch promises something", async () => {
    const { s } = await mcpSession([], { profiles: { balanced: CLOUD } });
    const card = await show(s, <Card session={s} onSetUp={() => undefined} />);
    expect(text(card)).toContain("Now: Cloud — a provider answers");
    expect(text(card)).toContain("New conversations start with Anthropic · m-1.");
    expect(q("ai-local-only")!.getAttribute("aria-checked")).toBe("false");
    expect(text(card)).toContain("Only “Fully local” is a switch, because only it promises something.");
    expect(text(card)).not.toContain("this rests");
  });

  it("switched on, names the model that answers and lists what of the set-up rests", async () => {
    const { s } = await mcpSession([], { profiles: { balanced: CLOUD, local: LOCAL } });
    const card = await show(s, <Card session={s} onSetUp={() => undefined} />);
    await click(q("ai-local-only"));
    expect(s.getState().settings.localOnly).toBe(true);
    expect(q("ai-local-only")!.getAttribute("aria-checked")).toBe("true");
    expect(text(card)).toContain("Now: Fully local — nothing leaves this device");
    expect(text(card)).toContain("Ollama · granite3.3:8b answers, the model of the profile “Local”.");
    expect(text(card)).toContain("While “Fully local” is on, this rests");
    // Every provider of the cloud that is set up, in one row; under it the profiles that will not answer.
    expect(text(card)).toContain("Anthropic, OpenAI, Google Gemini, and OpenRouter");
    expect(text(card)).toContain("Stay set up and receive nothing. This profile does not answer: Balanced.");
    expect(text(card)).toContain("The switch is about the AI.");
    expect(q("ai-mode-setup")).toBeNull();
    // Off again: the card is as it was.
    await click(q("ai-local-only"));
    expect(s.getState().settings.localOnly).toBe(false);
    expect(text(card)).toContain("Now: Hybrid — this device sorts, a provider answers");
  });

  it("without a model on this device says what is missing and offers the way there", async () => {
    const { s } = await mcpSession([], { profiles: { balanced: CLOUD } });
    const setUp = vi.fn();
    const card = await show(s, <Card session={s} onSetUp={setUp} />);
    await click(q("ai-local-only"));
    expect(text(card)).toContain("Now: Fully local — and no model is set up on this device");
    expect(text(card)).toContain("Until one is, the AI cannot answer.");
    await click(q("ai-mode-setup"));
    expect(setUp).toHaveBeenCalledTimes(1);
  });
});

describe("choosing a model on a server of this device", () => {
  it("takes what its user says about it: the window, and that it takes no tools", async () => {
    const { s } = await mcpSession([], { profiles: { balanced: CLOUD, local: LOCAL } });
    const close = vi.fn();
    await show(s, <Dialog session={s} profile="local" onClose={close} />);
    expect(q("ai-model-window")).not.toBeNull();
    expect(q("ai-model-tools")!.getAttribute("aria-checked")).toBe("true");
    expect(text(q("ai-model-window-hint"))).toContain("A server on this device does not tell Plainva");
    await type(q("ai-model-window"), "8 192");
    await click(q("ai-model-tools"));
    await click(q("ai-model-save"));
    expect(s.getState().settings.profiles.local).toEqual({ ...LOCAL, contextTokens: 8192, tools: false });
    expect(close).toHaveBeenCalled();
  });

  it("shows what was said before, and takes it back when the fields are cleared", async () => {
    const { s } = await mcpSession([], { profiles: { local: { ...LOCAL, contextTokens: 16_384, tools: false } } });
    await show(s, <Dialog session={s} profile="local" onClose={() => undefined} />);
    expect((q("ai-model-window") as HTMLInputElement).value).toBe("16384");
    expect(q("ai-model-tools")!.getAttribute("aria-checked")).toBe("false");
    await type(q("ai-model-window"), "");
    await click(q("ai-model-tools"));
    await click(q("ai-model-save"));
    expect(s.getState().settings.profiles.local).toEqual(LOCAL);
  });

  it("does not save what is no window, and says what one is", async () => {
    const { s } = await mcpSession([], { profiles: { local: LOCAL } });
    await show(s, <Dialog session={s} profile="local" onClose={() => undefined} />);
    await type(q("ai-model-window"), "4096.0");
    expect(text(q("ai-model-window-hint"))).toBe("A whole number between 1,024 and 2,000,000, or empty.");
    expect((q("ai-model-save") as HTMLButtonElement).disabled).toBe(true);
    await click(q("ai-model-save"));
    expect(s.getState().settings.profiles.local).toEqual(LOCAL);
  });

  it("asks neither of a provider's model nor of a model that transcribes", async () => {
    const cloud = await mcpSession([], { profiles: { balanced: CLOUD } });
    await show(cloud.s, <Dialog session={cloud.s} profile="balanced" onClose={() => undefined} />);
    expect(q("ai-model-window")).toBeNull();
    expect(q("ai-model-tools")).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const audio = await mcpSession([], { profiles: { [AI_AUDIO_PROFILE]: { providerId: "ollama", model: "whisper" } } });
    await show(audio.s, <Dialog session={audio.s} profile={AI_AUDIO_PROFILE} onClose={() => undefined} />);
    expect(q("ai-model-dialog")).not.toBeNull();
    expect(q("ai-model-window")).toBeNull();
  });
});

describe("the conversation while the device is fully local", () => {
  it("says so in its marking, beside the model on this device that answers", async () => {
    const { s } = await mcpSession([], { profiles: { balanced: CLOUD, local: LOCAL } });
    const view = await show(s, conversation);
    expect(q("ai-local-marking")).toBeNull();
    await fullyLocal(s);
    await settle();
    expect(text(q("ai-local-marking"))).toBe("Fully local: nothing leaves this device.");
    expect(text(view.querySelector(".pv-ai-marking"))).toContain("granite3.3:8b via Ollama");
  });

  it("without a model on this device says what is missing instead of offering a field to type into", async () => {
    const { s } = await mcpSession([], { profiles: { balanced: CLOUD } });
    await show(s, conversation);
    expect(q("ai-input")).not.toBeNull();
    await fullyLocal(s);
    await settle();
    expect(text(q("ai-local-empty"))).toContain("No model on this device");
    expect(text(q("ai-local-empty"))).toContain("“Fully local” is on, and no profile names a model that runs on this device.");
    expect(q("ai-input")).toBeNull();
  });

  it("an open conversation that ran with a provider's model rests — said before anyone types, with the way on", async () => {
    const { s } = await mcpSession([turn({ text: "An offer for Northwind." })], { profiles: { balanced: CLOUD, local: LOCAL } });
    const view = await show(s, conversation);
    await act(async () => {
      await s.send("What is the offer?");
    });
    await settle();
    expect(q("ai-local-rests")).toBeNull();
    await fullyLocal(s);
    await settle();
    expect(text(q("ai-local-rests"))).toBe("This conversation ran with m-1 via Anthropic. While “Fully local” is on it does not go on: no conversation changes its model silently.");
    // What was said stays readable; the field does not send.
    expect(text(view)).toContain("An offer for Northwind.");
    await type(q("ai-input"), "And for whom?");
    expect((q("ai-send") as HTMLButtonElement).disabled).toBe(true);
    // The way on: a new conversation, which starts with the model that answers here.
    await click(q("ai-local-new"));
    expect(s.getState().active).toBeNull();
    expect(q("ai-local-rests")).toBeNull();
    expect(text(view.querySelector(".pv-ai-marking"))).toContain("granite3.3:8b via Ollama");
    expect(q("ai-local-marking")).not.toBeNull();
  });

  it("where no model on this device could take a new conversation, the way on leads to the settings", async () => {
    const { s } = await mcpSession([turn({ text: "An offer for Northwind." })], { profiles: { balanced: CLOUD } });
    const settings = vi.fn();
    await show(s, <AiConversation dress="window" activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={settings} />);
    await act(async () => {
      await s.send("What is the offer?");
    });
    await fullyLocal(s);
    await settle();
    expect(q("ai-local-new")).toBeNull();
    await click(q("ai-local-setup"));
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it("answers with the model on this device, and the answer is marked like any other", async () => {
    const { s, fake } = await mcpSession([chat({ text: "For Northwind." })], { profiles: { balanced: CLOUD, local: LOCAL } });
    const view = await show(s, conversation);
    await fullyLocal(s);
    await act(async () => {
      await s.send("Who is the offer for?");
    });
    await settle();
    expect(text(view)).toContain("For Northwind.");
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["ollama"]);
    expect(q("ai-local-marking")).not.toBeNull();
  });
});
