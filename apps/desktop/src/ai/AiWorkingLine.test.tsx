// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BUILTIN_PROVIDERS, type ModelFailure } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiWorkingLine, WORKING_HERE_AFTER, aiFailureText, failureRecipient, providerStatus } from "@plainva/ui";

/**
 * Patience for a model on this device (plan KI-Harness P7, ADR 0030): it may
 * read for minutes before its first word. The waiting line says where the
 * thinking happens and counts along — only for a model on this device, only
 * after a few seconds, and without reading a number to a screen reader every
 * second. And two failures name what is the matter when the one that does not
 * answer is a server on this device.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

function show(here: boolean): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<AiWorkingLine here={here} />));
  return host;
}
const wait = (seconds: number) => act(() => void vi.advanceTimersByTime(seconds * 1000));
const t = i18n.t.bind(i18n) as unknown as (key: string, options?: Record<string, unknown>) => string;
const provider = (id: string) => BUILTIN_PROVIDERS.find((p) => p.id === id)!;

describe("the waiting line", () => {
  it("says the ordinary thing for a provider, however long it takes", () => {
    const line = show(false);
    expect(line.textContent).toBe("Thinking…");
    wait(120);
    expect(line.textContent).toBe("Thinking…");
    expect(line.querySelector('[data-testid="ai-working-here"]')).toBeNull();
  });

  it("starts like any other for a model on this device, then says where the thinking happens and counts", () => {
    const line = show(true);
    expect(line.textContent).toBe("Thinking…");
    wait(WORKING_HERE_AFTER - 1);
    expect(line.textContent).toBe("Thinking…");
    wait(1);
    expect(line.querySelector('[data-testid="ai-working-here"]')).not.toBeNull();
    expect(line.textContent).toBe("Thinking on this device· 0:10");
    wait(55);
    expect(line.textContent).toBe("Thinking on this device· 1:05");
    wait(600);
    expect(line.textContent).toBe("Thinking on this device· 11:05");
  });

  it("keeps the count from a screen reader: the sentence is read once, the seconds are not", () => {
    const line = show(true);
    wait(WORKING_HERE_AFTER + 3);
    const count = line.querySelector('[data-testid="ai-working-here"] span');
    expect(count?.getAttribute("aria-hidden")).toBe("true");
    expect(count?.textContent).toBe("· 0:13");
  });
});

describe("a failure of a model on this device", () => {
  const offline: ModelFailure = { kind: "offline", message: "connection refused" };
  const broken: ModelFailure = { kind: "stream_broken", message: "the provider did not answer" };

  it("asks whether the server runs, where a provider would be called unreachable", () => {
    expect(aiFailureText(t, offline, failureRecipient(provider("ollama")))).toBe("Ollama does not answer on this device. Is the server running?");
    expect(aiFailureText(t, offline, failureRecipient(provider("anthropic")))).toBe("Could not reach Anthropic.");
    // A caller that knows only a name gets the ordinary words.
    expect(aiFailureText(t, offline, "Ollama")).toBe("Could not reach Ollama.");
  });

  it("names the two things that make a server on this device fall silent", () => {
    expect(aiFailureText(t, broken, failureRecipient(provider("ollama")))).toBe("Ollama stopped answering. The server may have stopped, or the model is too large for this device.");
    expect(aiFailureText(t, broken, failureRecipient(provider("openai")))).toBe("The connection broke off in the middle of the answer.");
  });

  it("is said the same way in the settings' row of that server", () => {
    const row = { provider: provider("ollama"), needsKey: false, hasKey: false, test: { state: "failed" as const, at: "2026-10-09T10:00:00Z", failure: offline } };
    expect(providerStatus(t, row)).toContain("Ollama does not answer on this device. Is the server running?");
  });
});
