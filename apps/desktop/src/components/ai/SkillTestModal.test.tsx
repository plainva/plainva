// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EMPTY_INSTRUCTION_APPROVALS, resolveInstructions, type SkillTestRecord } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiSessionContext, APP_SKILL_SOURCES, type AiSession, type AiState, type SkillTestOutcome, type SkillTestPlan } from "@plainva/ui";
import { SkillTestModal } from "./SkillTestModal";

/**
 * The regression run's dialog (plan KI-Harness P3-8): it says what would run
 * before anything runs, starts only on the button, hands the ceiling over,
 * and shows what the run found.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const DAILY = "plainva:daily-orientation";
const plan: SkillTestPlan = {
  choice: { providerId: "p", model: "m-2" },
  providerLabel: "Provider",
  local: false,
  priced: true,
  targets: [
    { id: DAILY, version: "v1", scenarios: 2, notApplicable: 0, problems: [] },
    { id: "plainva:project-status", version: "v1", scenarios: 0, notApplicable: 2, problems: [] },
  ],
  total: 2,
};
const record: SkillTestRecord = {
  id: DAILY,
  version: "v1",
  providerId: "p",
  model: "m-2",
  at: "2026-10-06T10:00:00.000Z",
  scenarios: [
    { id: "today", passed: true, checks: [{ id: "answered", ok: true }], stop: "answered", tokens: 1200 },
    { id: "next-step", passed: false, checks: [{ id: "answered", ok: false }], stop: "limit", tokens: 800 },
  ],
};

/** The session as the dialog uses it: its state, the run and the stop. */
function stubSession() {
  let state = {
    loaded: true,
    settings: { enabled: true },
    hasVault: true,
    draftChoice: null,
    skills: { entries: resolveInstructions(APP_SKILL_SOURCES, EMPTY_INSTRUCTION_APPROVALS), omitted: [] },
    skillTests: { records: [], running: null },
  } as unknown as AiState;
  const listeners = new Set<() => void>();
  let finish: (outcome: SkillTestOutcome) => void = () => {};
  const testSkills = vi.fn(() => new Promise<SkillTestOutcome>((resolve) => (finish = resolve)));
  const stop = vi.fn();
  const session = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    testSkills,
    stop,
  } as unknown as AiSession;
  const patch = (next: Partial<AiState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  return { session, testSkills, stop, patch, finish: (outcome: SkillTestOutcome) => finish(outcome) };
}

/** The dialog with the plan the workshop hands it: the facts are there with the first frame. */
async function mount(session: AiSession, thePlan: SkillTestPlan) {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <AiSessionContext.Provider value={session}>
        <SkillTestModal ids={null} plan={thePlan} onClose={() => {}} />
      </AiSessionContext.Provider>,
    );
  });
  return document.querySelector('[data-testid="ai-skill-test"]') as HTMLElement;
}

describe("the regression run's dialog", () => {
  it("says what would run and against which model, starts only on the button, and hands the ceiling over", async () => {
    const stub = stubSession();
    const dialog = await mount(stub.session, plan);
    expect(dialog.textContent).toContain("Test with m-2");
    expect(dialog.textContent).toContain("Provider · m-2");
    expect(dialog.querySelector('[data-testid="ai-skill-test-scope"]')!.textContent).toBe("2 scenarios from 1 skill");
    expect(dialog.textContent).toContain("2 more scenarios were written for another vault and do not run here.");
    expect(stub.testSkills).not.toHaveBeenCalled();

    const ceiling = dialog.querySelector('[data-testid="ai-skill-test-ceiling"]') as HTMLInputElement;
    expect(ceiling.value).toBe("0.5");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(ceiling, "0,25");
      ceiling.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (dialog.querySelector('[data-testid="ai-skill-test-start"]') as HTMLElement).click();
    });
    // A comma is a decimal sign too; all skills, the amount as the ceiling.
    expect(stub.testSkills).toHaveBeenCalledWith(null, { maxCostUsd: 0.25 });

    // While it runs: the scenario it is at, and a way to stop.
    await act(async () => {
      stub.patch({ skillTests: { records: [], running: { skill: DAILY, scenario: "today", done: 0, total: 2 } } });
    });
    expect(dialog.textContent).toContain("Scenario 1 of 2 is running: today");
    await act(async () => {
      (dialog.querySelector('[data-testid="ai-skill-test-stop"]') as HTMLElement).click();
    });
    expect(stub.stop).toHaveBeenCalledTimes(1);

    // Afterwards: how it ended, and each scenario's verdict.
    await act(async () => {
      stub.patch({ skillTests: { records: [record], running: null } });
      stub.finish({ kind: "done", ran: 2, passed: 1, failed: 1, stopped: null });
    });
    expect(dialog.textContent).toContain("Passed: 1 of 2.");
    const lines = [...dialog.querySelectorAll('[data-testid="ai-skill-test-line"]')];
    expect(lines.map((line) => [line.getAttribute("data-mark"), line.textContent])).toEqual([
      ["pass", "today — passed"],
      ["fail", "next-step — no answer"],
    ]);
    expect(dialog.querySelector('[data-testid="ai-skill-test-start"]')).not.toBeNull();
  });

  it("offers no amount where none applies, and no start where nothing would run", async () => {
    const local = stubSession();
    const dialog = await mount(local.session, { ...plan, local: true, priced: false });
    expect(dialog.querySelector('[data-testid="ai-skill-test-ceiling"]')).toBeNull();
    expect(dialog.textContent).toContain("None: the model runs on this device.");
    await act(async () => {
      (dialog.querySelector('[data-testid="ai-skill-test-start"]') as HTMLElement).click();
    });
    expect(local.testSkills).toHaveBeenCalledWith(null, { maxCostUsd: null, maxTokens: Number.MAX_SAFE_INTEGER });
    act(() => root?.unmount());
    host?.remove();

    const empty = stubSession();
    const nothing = await mount(empty.session, { ...plan, targets: [], total: 0 });
    expect(nothing.textContent).toContain("No active skill brings scenarios that apply in this vault.");
    expect((nothing.querySelector('[data-testid="ai-skill-test-start"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
