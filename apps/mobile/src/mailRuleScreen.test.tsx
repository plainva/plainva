// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices } from "@plainva/ui";
import type { MailRule } from "@plainva/ui/mail";
import { saveMailRules } from "@plainva/ui/mail";
import { MailRuleScreen } from "./screens/MailRuleScreen";

/**
 * The mobile rule editor (S16b).
 *
 * The model and both translations are pinned elsewhere; this screen owns the
 * SHAPE of the conversation. What is worth a test is the part where a wrong
 * answer would look like a broken editor: a rule the user opens must show its
 * two halves — what it matches, and what it does — and a rule that is gone must
 * say so rather than render an empty form that saves nothing.
 */

vi.mock("./services/mail/mailRuntime", () => ({ mailVaultId: () => "/vault" }));

let container: HTMLDivElement;
let root: Root;
const store = new Map<string, unknown>();

beforeEach(() => {
  store.clear();
  setPlatformServices({
    loadSettings: async () => ({
      get: async (k: string) => store.get(k),
      set: async (k: string, v: unknown) => void store.set(k, v),
      delete: async (k: string) => void store.delete(k),
      keys: async () => [...store.keys()],
      save: async () => {},
    }),
    credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const rule: MailRule = {
  id: "r1",
  name: "Newsletter",
  enabled: true,
  match: "all",
  conditions: [
    { field: "from", op: "contains", value: "newsletter@" },
    { field: "subject", op: "notContains", value: "Rechnung" },
  ],
  actions: [{ kind: "moveTo", mailbox: "Lesen" }],
};

async function mount(id: string) {
  await act(async () => {
    root.render(<MailRuleScreen ruleId={id} onBack={() => {}} />);
  });
  // Let the load settle.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the rule editor", () => {
  it("shows both halves of the rule, each condition and action on its own row", async () => {
    await saveMailRules("/vault", [rule]);
    await mount("r1");
    // Two conditions, one action — the shape the target image names "Wenn"/"Dann".
    expect(container.querySelector('[data-testid="rule-condition-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rule-condition-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rule-action-0"]')).not.toBeNull();
    expect(container.textContent).toContain("newsletter@");
    expect(container.textContent).toContain("Lesen");
  });

  it("says a rule is gone instead of rendering an empty form", async () => {
    // An editor that silently shows blanks would save a rule nobody wrote.
    await saveMailRules("/vault", [rule]);
    await mount("does-not-exist");
    expect(container.querySelector('[data-testid="rule-missing"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rule-condition-0"]')).toBeNull();
  });

  it("offers to remove a condition only while more than one is left", async () => {
    // Removing the last one would leave a rule that fires on every message.
    await saveMailRules("/vault", [{ ...rule, conditions: [rule.conditions[0]] }]);
    await mount("r1");
    const row = container.querySelector('[data-testid="rule-condition-0"]');
    expect(row?.querySelector("button")).toBeNull();
  });
});
