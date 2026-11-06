// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { aiSetupStep, AiConversation, AiSessionContext, failureSender, takeAiSettingsIntent, type AiSession } from "@plainva/ui";
import { CLOUD, LOCAL, mcpSession, turn } from "./mcpSessionHarness";

/**
 * The AI's surfaces as revised by plan KI-Oberflächen (2026-11-06), driven by
 * the real session: the one way to the first answer (K3), the conversation's
 * foot and what stands under an answer (K7, K8), and a failure that names its
 * sender and leads to the exact fix (K10).
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
  vi.unstubAllGlobals();
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
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const conversation = (props: { activeNote?: { path: string; title: string } | null; onOpenSettings?: () => void } = {}) => (
  <AiConversation dress="window" activeNote={props.activeNote ?? null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={props.onOpenSettings ?? (() => undefined)} />
);

describe("the way to the first answer", () => {
  it("names the one step that is missing: a provider, then the model new conversations start with", async () => {
    const { s } = await mcpSession([], { profiles: {} });
    expect(aiSetupStep(s.getState())).toBe("model");
    // Nothing set up at all: no provider, no key, no profile.
    expect(aiSetupStep({ settings: { ...s.getState().settings, providers: [], custom: [], profiles: {} }, keys: {}, tests: {} })).toBe("provider");
    await act(async () => void (await s.updateSettings((settings) => ({ ...settings, profiles: { balanced: CLOUD } }))));
    expect(aiSetupStep(s.getState())).toBeNull();
  });
});

describe("the conversation's foot and the field", () => {
  it("names the profile, not the model the marking line names already", async () => {
    const { s } = await mcpSession([], { profiles: { balanced: CLOUD, local: LOCAL } });
    const view = await show(s, conversation());
    expect(text(view.querySelector(".pv-ai-marking"))).toContain("m-1");
    expect(text(q("ai-profile-button"))).toBe("Balanced");
    expect(q("ai-profile-button")!.getAttribute("data-tip")).toBe("Anthropic · m-1");
  });

  it("asks about the open note where one is open, and about the vault where none is", async () => {
    const { s } = await mcpSession([]);
    await show(s, conversation());
    expect(q("ai-input")!.getAttribute("placeholder")).toBe("Ask about your vault…");
    act(() => root?.unmount());
    host?.remove();
    await show(s, conversation({ activeNote: { path: "Projects/Atlas.md", title: "Atlas" } }));
    expect(q("ai-input")!.getAttribute("placeholder")).toBe("Ask about “Atlas” or your vault…");
  });

  it("offers the context view as a labelled chip", async () => {
    const { s } = await mcpSession([]);
    await show(s, conversation());
    expect(text(q("ai-lens-open"))).toBe("What goes along?");
  });
});

describe("under an answer", () => {
  it("copies the answer, keeps the line quiet and opens the details on request", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText }, onLine: true });
    const { s } = await mcpSession([turn({ text: "The offer stands in [[Offer]]." })]);
    await show(s, conversation());
    await act(async () => void (await s.send("What is the offer?")));
    await settle();
    expect(q("ai-run-actions")).not.toBeNull();
    await click(q("ai-copy"));
    expect(writeText).toHaveBeenCalledWith("The offer stands in [[Offer]].");
    expect(text(q("ai-run-actions"))).toContain("To Anthropic");
    expect(q("ai-run-full")).toBeNull();
    await click(q("ai-run-details"));
    expect(text(q("ai-run-full"))).toContain("sent to Anthropic");
  });
});

describe("a failure", () => {
  it("names its sender and leads to the dialog that fixes it", async () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: true });
    const { s } = await mcpSession([[{ type: "httpError", status: 401, body: "" }]] as never);
    const openSettings = vi.fn();
    await show(s, conversation({ onOpenSettings: openSettings }));
    await act(async () => void (await s.send("What is the offer?")));
    await settle();
    expect(text(q("ai-notice-sender"))).toBe("Provider");
    expect(text(q("ai-notice-fix"))).toBe("Enter a new key");
    await click(q("ai-notice-fix"));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(takeAiSettingsIntent()).toEqual({ kind: "key", providerId: "anthropic" });
  });

  it("is said to come from the network when the device has none", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(failureSender({ kind: "offline", message: "" }, { label: "Anthropic" })).toBe("network");
    vi.stubGlobal("navigator", { onLine: true });
    expect(failureSender({ kind: "offline", message: "" }, { label: "Anthropic" })).toBe("provider");
    expect(failureSender({ kind: "offline", message: "" }, { label: "Ollama", here: true })).toBe("device");
    expect(failureSender({ kind: "no_key" }, { label: "Anthropic" })).toBe("device");
  });
});
