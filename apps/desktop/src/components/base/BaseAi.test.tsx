// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_AI_APP_SETTINGS, type EgressManifest } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import {
  AiSendOverview,
  FillPlanBody,
  FillProgressBanner,
  FilterInWords,
  fillPlanLines,
  filterRuleWords,
  reportFill,
  toast,
  toastStore,
  useBaseAi,
  type AiSession,
  type AiState,
  type BaseAi,
  type FillColumn,
  type FillOutcome,
  type FilterSchemaColumn,
  type FilterWordsOutcome,
} from "@plainva/ui";

/**
 * The assistant at a database as both shells show it (plan KI-Harness P5-4,
 * mockup chapter 20, figure "Datenbank"): the plan of a run before it starts,
 * its progress above the entries, the words for how it ended — and the filter
 * a sentence becomes, shown as rules before anything is filtered.
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
  for (const item of toastStore.get()) toast.dismiss(item.id);
});

function show(node: ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const t = i18n.t.bind(i18n);
const model = { provider: "Anthropic", model: "m-1" };
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `N${i}.md`, title: `N${i}` }));
const stage: FillColumn = { key: "stage", label: "Stage", input: "select", options: ["Open", "Sent"] };
const text = (node: Element | null | undefined) => node?.textContent ?? "";
const byTest = (within: Element, id: string) => within.querySelector(`[data-testid="${id}"]`);

describe("the plan of a run, before it starts", () => {
  it("says how many entries, that each note is read on its own, that nothing is written, and which model", () => {
    expect(fillPlanLines(t, { rows: rows(3), missing: 3, waiting: 0 }, model)).toEqual([
      "3 entries have no value here.",
      "The AI reads each note on its own and suggests a value from it. Nothing is written until you accept a suggestion.",
      "Model: Anthropic · m-1",
    ]);
    expect(fillPlanLines(t, { rows: rows(1), missing: 1, waiting: 0 }, model)[0]).toBe("1 entry has no value here.");
    // More than a run takes: it says so. Entries a value already waits for are named, and left out.
    expect(fillPlanLines(t, { rows: rows(25), missing: 40, waiting: 2 }, model).slice(0, 2)).toEqual(["40 entries have no value here. A run takes the first 25 of them.", "2 more already have a suggested value waiting."]);
    expect(fillPlanLines(t, { rows: rows(2), missing: 2, waiting: 0 }, null)[2]).toBe("Choose a model first — in the AI settings.");
  });

  it("says that there is nothing to do, and why", () => {
    expect(fillPlanLines(t, { rows: [], missing: 0, waiting: 0 }, model)).toEqual(["Every entry already has a value here."]);
    expect(fillPlanLines(t, { rows: [], missing: 0, waiting: 4 }, model)).toEqual(["Every entry without a value here already has a suggested one waiting."]);
  });

  it("shows the column's choices with the plan", () => {
    const shown = show(<FillPlanBody column={stage} plan={{ rows: rows(2), missing: 2, waiting: 0 }} model={model} />);
    expect(text(byTest(shown, "base-fill-plan"))).toContain("2 entries have no value here.");
    expect([...shown.querySelectorAll(".pv-fillplan-choices .pv-chip")].map(text)).toEqual(["Open", "Sent"]);
    // Nothing to fill: no choices either.
    act(() => root!.render(<FillPlanBody column={stage} plan={{ rows: [], missing: 0, waiting: 0 }} model={model} />));
    expect(shown.querySelector(".pv-fillplan-choices")).toBeNull();
  });
});

describe("a run above the entries", () => {
  it("says how far it is, as a sentence and as a track — and can be ended", () => {
    const onStop = vi.fn();
    const shown = show(<FillProgressBanner fill={{ base: "Clients.base", column: "branche", label: "Branche", done: 2, total: 5 }} onStop={onStop} />);
    const banner = byTest(shown, "base-fill-progress")!;
    expect(text(banner)).toContain("Filling “Branche” · 2 of 5");
    const track = banner.querySelector('[role="progressbar"]')!;
    expect(track.getAttribute("aria-valuenow")).toBe("40");
    expect((track.firstElementChild as HTMLElement).style.width).toBe("40%");
    act(() => (byTest(shown, "base-fill-stop") as HTMLButtonElement).click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe("how a run ended, in one toast", () => {
  const done = (over: Partial<Extract<FillOutcome, { kind: "done" }>>): FillOutcome => ({ kind: "done", proposed: 0, silent: 0, kept: 0, failed: 0, stopped: false, provider: "Anthropic", model: "m-1", ...over });
  const toasts = () => toastStore.get().map((item) => [item.kind, item.message]);

  it("what was proposed, and what was not and why — in numbers", () => {
    reportFill(t, done({ proposed: 7, silent: 2, kept: 1, failed: 2 }), "Branche");
    expect(toasts()).toEqual([["success", "7 values suggested for “Branche” · 2 notes do not say it · 1 kept back by your rules · 2 without a usable answer"]]);
  });

  it("nothing proposed is no success; an early end is named", () => {
    reportFill(t, done({ silent: 3 }), "Branche");
    reportFill(t, done({ proposed: 1, stopped: true }), "Branche");
    expect(toasts()).toEqual([
      ["info", "0 values suggested for “Branche” · 3 notes do not say it"],
      ["success", "1 value suggested for “Branche” · stopped early"],
    ]);
  });

  it("a request that failed is an error, with what was laid down before it", () => {
    reportFill(t, done({ proposed: 2, failure: { kind: "rate_limited", status: 429 } }), "Branche");
    const [kind, message] = toasts()[0]!;
    expect(kind).toBe("error");
    expect(message).toContain("Anthropic");
    expect(message).toContain("2 values suggested for “Branche”");
  });

  it("says why a run did not start — and nothing where the user declined the overview", () => {
    reportFill(t, { kind: "refused", reason: "cancelled" }, "Branche");
    expect(toasts()).toEqual([]);
    reportFill(t, { kind: "refused", reason: "busy" }, "Branche");
    reportFill(t, { kind: "refused", reason: "kept" }, "Branche");
    reportFill(t, { kind: "refused", reason: "unfit" }, "Branche");
    expect(toasts()).toEqual([
      ["info", "The AI is busy with another request. Try again when it is done."],
      ["error", "Your rules keep all of these notes from this model."],
      ["error", "“Branche” cannot be filled this way."],
    ]);
  });
});

describe("a filter in words", () => {
  const columns: FilterSchemaColumn[] = [
    { key: "stage", label: "Stage", input: "select", options: ["Open", "Sent"] },
    { key: "amount", label: "Amount", input: "number" },
    { key: "due", label: "Due", input: "date" },
    { key: "done", label: "Done", input: "checkbox" },
  ];
  const entries = [
    { "file.path": "a.md", stage: "Sent", amount: 9000 },
    { "file.path": "b.md", stage: "Open", amount: 100 },
    { "file.path": "c.md", stage: "Sent", amount: 200 },
  ];
  const ai = (answer: (words: string) => FilterWordsOutcome): BaseAi & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      canFill: true,
      fill: null,
      busy: false,
      model,
      startFill: async () => ({ kind: "refused", reason: "off" }),
      stopFill: () => {},
      filterFromWords: async (words) => {
        asked.push(words);
        return answer(words);
      },
    };
  };
  const type = (shown: Element, value: string) => {
    const input = byTest(shown, "base-filter-words-input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  };
  const click = async (shown: Element, id: string) => {
    await act(async () => {
      (byTest(shown, id) as HTMLButtonElement).click();
      await Promise.resolve();
    });
  };

  it("writes a rule in the words the filter list uses", () => {
    expect(filterRuleWords(t, { column: "stage", op: "==", value: "Sent" }, columns)).toBe("Stage is Sent");
    expect(filterRuleWords(t, { column: "amount", op: ">", value: "5000" }, columns)).toBe("Amount greater than 5000");
    // A date speaks of before and after.
    expect(filterRuleWords(t, { column: "due", op: ">", value: "2026-10-07" }, columns)).toBe("Due after 2026-10-07");
    expect(filterRuleWords(t, { column: "done", op: "==", value: "true" }, columns)).toBe("Done is ☑");
    expect(filterRuleWords(t, { column: "stage", op: "notEmpty", value: "" }, columns)).toBe("Stage is not empty");
  });

  it("shows the rules a sentence would be, and how many entries they leave — and filters only on Apply", async () => {
    const onApply = vi.fn();
    const assistant = ai(() => ({ kind: "rules", logic: "all", rules: [{ column: "stage", op: "==", value: "Sent" }, { column: "amount", op: ">", value: "5000" }], model: "m-1" }));
    const shown = show(<FilterInWords ai={assistant} columns={columns} rows={entries} onApply={onApply} />);
    // Nothing typed: nothing to ask. What would go for it is said before anything is asked.
    expect((byTest(shown, "base-filter-words-ask") as HTMLButtonElement).disabled).toBe(true);
    expect(text(byTest(shown, "base-filter-words-sends"))).toBe("Only this database's columns go to the AI for this — their names, kinds and choices — and your sentence. No entry, no note.");
    type(shown, "  sent offers over 5000 ");
    await click(shown, "base-filter-words-ask");
    expect(assistant.asked).toEqual(["sent offers over 5000"]);
    const result = byTest(shown, "base-filter-words-result")!;
    expect(text(result)).toContain("Suggested — all of these have to hold:");
    expect([...result.querySelectorAll('[data-testid="base-filter-words-rule"]')].map(text)).toEqual(["Stage is Sent", "Amount greater than 5000"]);
    expect(text(byTest(shown, "base-filter-words-count"))).toBe("Matches 1 of 3 entries.");
    expect(onApply).not.toHaveBeenCalled();

    await click(shown, "base-filter-words-apply");
    expect(onApply).toHaveBeenCalledWith([{ column: "stage", op: "==", value: "Sent" }, { column: "amount", op: ">", value: "5000" }], "all");
    // Applied: the proposal is gone, and the field is free for the next sentence.
    expect(byTest(shown, "base-filter-words-result")).toBeNull();
    expect((byTest(shown, "base-filter-words-input") as HTMLInputElement).value).toBe("");
  });

  it("can be thrown away, and asks again on Enter", async () => {
    const onApply = vi.fn();
    const assistant = ai(() => ({ kind: "rules", logic: "any", rules: [{ column: "stage", op: "==", value: "Open" }], model: "m-1" }));
    const shown = show(<FilterInWords ai={assistant} columns={columns} rows={entries} onApply={onApply} />);
    const input = type(shown, "open ones");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
    // One rule is one rule: no talk of all or any.
    expect(text(byTest(shown, "base-filter-words-result"))).toContain("Suggested rule:");
    await click(shown, "base-filter-words-discard");
    expect(byTest(shown, "base-filter-words-result")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
    // The sentence stays, to be put differently.
    expect((byTest(shown, "base-filter-words-input") as HTMLInputElement).value).toBe("open ones");
  });

  it("says why there is no filter — and nothing where the user declined the overview", async () => {
    let outcome: FilterWordsOutcome = { kind: "refused", reason: "none" };
    const shown = show(<FilterInWords ai={ai(() => outcome)} columns={columns} rows={entries} onApply={() => {}} />);
    type(shown, "the nice ones");
    await click(shown, "base-filter-words-ask");
    expect(text(byTest(shown, "base-filter-words-problem"))).toBe("That cannot be said with this database's columns. Try other words, or add the filter by hand.");
    expect(byTest(shown, "base-filter-words-result")).toBeNull();

    outcome = { kind: "refused", reason: "failed", failure: { kind: "rate_limited", status: 429 }, provider: "Anthropic", model: "m-1" };
    await click(shown, "base-filter-words-ask");
    expect(text(byTest(shown, "base-filter-words-problem"))).toContain("Anthropic");

    outcome = { kind: "refused", reason: "cancelled" };
    await click(shown, "base-filter-words-ask");
    expect(byTest(shown, "base-filter-words-problem")).toBeNull();
  });
});

describe("whether the assistant is offered at a database", () => {
  const state = (patch: Partial<AiState>): AiState => ({ loaded: true, hasVault: true, fill: null, settings: { ...DEFAULT_AI_APP_SETTINGS, enabled: true }, ...patch }) as AiState;
  const fake = (initial: AiState) => {
    let current = initial;
    const listeners = new Set<() => void>();
    const calls: unknown[] = [];
    const session = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      getState: () => current,
      newConversationChoice: () => ({ providerId: "anthropic", model: "m-1" }),
      fillProperty: async (request: unknown) => {
        calls.push(request);
        return { kind: "refused", reason: "cancelled" } as FillOutcome;
      },
      stopFill: () => void calls.push("stop"),
      filterFromWords: async (request: unknown) => {
        calls.push(request);
        return { kind: "refused", reason: "none" } as FilterWordsOutcome;
      },
    } as unknown as AiSession;
    return {
      session,
      calls,
      set: (next: AiState) => {
        current = next;
        for (const listener of listeners) listener();
      },
    };
  };
  let seen: BaseAi | null = null;
  function Probe({ session, base, sealed }: { session: AiSession | null; base: string | null; sealed: boolean }) {
    seen = useBaseAi(session, base, { sealed });
    return null;
  }

  it("not while the AI is off, reads no vault, or there is no database", () => {
    const off = fake(state({ settings: { ...DEFAULT_AI_APP_SETTINGS, enabled: false } }));
    show(<Probe session={off.session} base="Clients.base" sealed={false} />);
    expect(seen).toBeNull();
    act(() => off.set(state({ hasVault: false })));
    expect(seen).toBeNull();
    act(() => off.set(state({})));
    expect(seen).not.toBeNull();
    act(() => root!.render(<Probe session={off.session} base={null} sealed={false} />));
    expect(seen).toBeNull();
    act(() => root!.render(<Probe session={null} base="Clients.base" sealed={false} />));
    expect(seen).toBeNull();
  });

  it("names the model a run would ask, shows only this database's run, and fills nothing inside a sealed workspace", async () => {
    const on = fake(state({}));
    show(<Probe session={on.session} base="Clients.base" sealed={false} />);
    expect(seen).toMatchObject({ canFill: true, fill: null, busy: false, model: { provider: "Anthropic", model: "m-1" } });
    // A run at another database: busy, but not this one's to show.
    act(() => on.set(state({ fill: { base: "Other.base", column: "x", label: "X", done: 1, total: 4 } })));
    expect(seen).toMatchObject({ fill: null, busy: true });
    act(() => on.set(state({ fill: { base: "Clients.base", column: "branche", label: "Branche", done: 1, total: 4 } })));
    expect(seen!.fill).toEqual({ base: "Clients.base", column: "branche", label: "Branche", done: 1, total: 4 });

    const column: FillColumn = { key: "branche", label: "Branche", input: "text" };
    await act(async () => {
      await seen!.startFill(column, [{ path: "A.md", title: "A" }]);
      await seen!.filterFromWords("open ones", []);
      seen!.stopFill();
    });
    expect(on.calls).toEqual([{ base: "Clients.base", column, rows: [{ path: "A.md", title: "A" }] }, { base: "Clients.base", words: "open ones", columns: [] }, "stop"]);

    act(() => root!.render(<Probe session={on.session} base="Clients.base" sealed />));
    expect(seen).toMatchObject({ canFill: false });
  });
});

describe("the send overview of a run and of a filter in words", () => {
  const manifest = (over: Partial<EgressManifest>): EgressManifest => ({
    providerId: "anthropic",
    providerLabel: "Anthropic",
    model: "m-1",
    local: false,
    sources: [],
    dataClasses: ["notes"],
    folders: ["Clients"],
    withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
    excluded: [],
    estimatedTokens: 900,
    tools: [],
    web: false,
    ...over,
  });
  const source = (path: string) => ({ path, title: path.replace(/\.md$/, ""), tier: "evidence" as const, chars: 100, reasons: [] });

  it("says that a column is being filled, and that the notes go one at a time", () => {
    const shown = show(<AiSendOverview manifest={manifest({ sources: [source("Acme.md"), source("Bolt.md"), { ...source("Core.md"), section: "" }], fill: { column: "Branche" }, withheld: { notes: 1, links: 0, places: 0, moodProperties: 0 } })} onSend={() => {}} onCancel={() => {}} onLeaveOut={() => {}} />);
    expect(text(byTest(shown, "ai-overview-fill"))).toBe("The column “Branche” is being filled: the 3 notes go one at a time, each in a request of its own.");
    // Every note can be left out of the run; a long one says that only its beginning goes.
    expect(shown.querySelectorAll(".pv-ai-overview-sources li")).toHaveLength(3);
    expect(shown.querySelectorAll(".pv-ai-overview-sources .pv-iconbtn")).toHaveLength(3);
    expect(text(shown.querySelectorAll(".pv-ai-overview-sources li")[2])).toContain("the beginning");
    expect(text(shown)).toContain("1 note your rules block");
  });

  it("names a database's columns as what goes, and offers no way to leave them out", () => {
    const shown = show(<AiSendOverview manifest={manifest({ sources: [{ path: "Clients/Clients.base", title: "Clients", tier: "evidence", chars: 80, reasons: [], columns: 2 }] })} onSend={() => {}} onCancel={() => {}} onLeaveOut={() => {}} />);
    expect(text(shown.querySelector(".pv-ai-overview-sources li"))).toContain("2 columns: their names, kinds and choices — no entry");
    expect(shown.querySelectorAll(".pv-ai-overview-sources .pv-iconbtn")).toHaveLength(0);
    expect(byTest(shown, "ai-overview-fill")).toBeNull();
  });
});
