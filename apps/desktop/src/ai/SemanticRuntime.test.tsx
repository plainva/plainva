// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { AiSessionContext } from "@plainva/ui";
import { mcpSession } from "./mcpSessionHarness";

/**
 * Befunde 06.11., B3: a build without the ONNX runtime offered the local
 * model packages and said "This build has no runtime for models." only after
 * one was chosen and loaded. The card asks first: without a runtime, the
 * packages cannot be chosen and a line says why; "Own provider" stays.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { runtime } = vi.hoisted(() => ({ runtime: { available: true } }));
vi.mock("../services/ai/localModels", () => ({
  desktopLocalModels: {
    runtimeAvailable: async () => runtime.available,
    status: async () => [],
  },
}));
vi.mock("../services/appDialogs", () => ({ appConfirm: async () => false }));

import { SemanticSearchCard } from "../components/settings/SemanticSearchCard";

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

const settle = async () => {
  await act(async () => {
    for (let turns = 0; turns < 12; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const q = (selector: string) => document.body.querySelector<HTMLInputElement>(selector);

async function open(available: boolean) {
  runtime.available = available;
  const { s } = await mcpSession([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiSessionContext.Provider value={s}>
        <SemanticSearchCard session={s} onChooseModel={() => undefined} />
      </AiSessionContext.Provider>,
    );
  });
  await act(async () => q('[data-testid="semantic-change"]')!.click());
  await settle();
}

describe("search by meaning without a runtime for models (B3)", () => {
  it("locks the packages with a line that says why, and keeps the own provider", async () => {
    await open(false);
    expect(document.body.textContent).toContain(i18n.t("ai.semantic.runtimeAbsent"));
    const packages = [...document.body.querySelectorAll<HTMLInputElement>('[data-testid^="semantic-model-"] input, input[data-testid^="semantic-model-"]')].filter(
      (input) => !(input.closest("[data-testid]")?.getAttribute("data-testid") ?? "").endsWith("provider"),
    );
    expect(packages.length).toBeGreaterThan(0);
    for (const input of packages) expect(input.disabled).toBe(true);
    const provider = q('[data-testid="semantic-model-provider"] input') ?? q('input[data-testid="semantic-model-provider"]');
    expect(provider!.disabled).toBe(false);
  });

  it("with a runtime offers the packages as before", async () => {
    await open(true);
    expect(document.body.textContent).not.toContain(i18n.t("ai.semantic.runtimeAbsent"));
    const first = q('[data-testid^="semantic-model-"] input') ?? q('input[data-testid^="semantic-model-"]');
    expect(first!.disabled).toBe(false);
  });
});
