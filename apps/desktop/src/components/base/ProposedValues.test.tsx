// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkspaceCommentRecord } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import {
  ProposedValueChip,
  ProposedValuesBar,
  proposedBy,
  proposedCellView,
  proposedOutcomeWords,
  proposedValueWords,
  type ProposedCell,
  type ProposedColumn,
} from "@plainva/ui";

/**
 * How a database shows a proposed value (plan KI-Harness P5-4, mockup chapter
 * 20, figure "Datenbank"), shared by both shells: the chip in the cell, the
 * line above the rows, and the words both use.
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

function show(node: ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const comment = (authorMemberId: string): WorkspaceCommentRecord =>
  ({ commentId: "k1", targetObjectId: "x", parentCommentId: null, authorMemberId, authorDeviceId: "dev", body: "", anchor: null, createdAt: "2026-10-07T09:00:00.000Z", suggestion: { replacement: "industry: Film\n", appliedAt: null, appliedBy: null, declinedAt: null }, resolvedCommentId: null, resolvedAt: null }) as WorkspaceCommentRecord;
const cell = (over: Partial<ProposedCell> = {}): ProposedCell => ({ path: "Clients/Hafenkante.md", column: "industry", comment: comment("plainva-ai/m-1"), value: "Film & Video", removed: false, ...over });
const column = (over: Partial<ProposedColumn> = {}): ProposedColumn => ({ label: "Industry", language: "en", ...over });

describe("a proposed value in words", () => {
  it("reads like the values beside it: a date as the view formats dates, an option by its label, a box for yes and no", () => {
    expect(proposedValueWords("Film & Video", column())).toBe("Film & Video");
    expect(proposedValueWords(["roof", "house"], column({ input: "tags" }))).toBe("roof, house");
    expect(proposedValueWords(42, column({ input: "number" }))).toBe("42");
    expect([proposedValueWords(true, column({ input: "checkbox" })), proposedValueWords(false, column())]).toEqual(["☑", "☐"]);
    expect(proposedValueWords("2026-10-16", column({ input: "date", dateFormat: "iso" }))).toBe("2026-10-16");
    expect(proposedValueWords("2026-10-16", column({ input: "date", dateFormat: "long" }))).toContain("2026");
    expect(proposedValueWords("2026-10-16", column({ input: "date", dateFormat: "long" }))).not.toBe("2026-10-16");
    const options = [{ value: "film", label: "Film & Video" }, { value: "health" }];
    expect(proposedValueWords("film", column({ input: "select", options }))).toBe("Film & Video");
    expect(proposedValueWords(["film", "health", "other"], column({ input: "multiselect", options }))).toBe("Film & Video, health, other");
    for (const empty of [undefined, null, "", "  ", []]) expect(proposedValueWords(empty, column())).toBe("");
  });

  it("names who proposed it as the user knows them — a person's own suggestion says only what it is", () => {
    const t = i18n.t.bind(i18n);
    expect(proposedBy(t, comment("plainva-ai/m-1"))).toBe("Suggested by Plainva AI · m-1");
    expect(proposedBy(t, comment("mcp:desk-client"))).toBe("Suggested by desk-client");
    expect(proposedBy(t, comment("acp:helper"))).toBe("Suggested by helper");
    expect(proposedBy(t, comment("member-anna"))).toBe("Suggested value");
  });

  it("is the property's before and after on the sheet of its cell", () => {
    expect(proposedCellView(cell(), undefined, column())).toEqual({ key: "Industry", before: "", after: "Film & Video", removed: false, added: true, stale: false });
    expect(proposedCellView(cell({ value: "Medicine" }), "Health", column())).toEqual({ key: "Industry", before: "Health", after: "Medicine", removed: false, added: false, stale: false });
    expect(proposedCellView(cell({ value: undefined, removed: true }), "Health", column())).toEqual({ key: "Industry", before: "Health", after: "", removed: true, added: false, stale: false });
  });

  it("says what a decision did: nothing about one cell that shows it, a count for a whole view, and why something stays", () => {
    const t = i18n.t.bind(i18n);
    const one = cell();
    const two = cell({ column: "city" });
    expect(proposedOutcomeWords(t, "applied", { decided: [one], failed: [], error: null }, 1)).toEqual({ done: null, failed: null });
    expect(proposedOutcomeWords(t, "applied", { decided: [one, two], failed: [], error: null }, 2)).toEqual({ done: "2 values applied", failed: null });
    expect(proposedOutcomeWords(t, "declined", { decided: [one], failed: [], error: null }, 2).done).toBe("1 suggestion declined");
    // One that no longer fits says so in the database's words, not in a text block's.
    expect(proposedOutcomeWords(t, "applied", { decided: [one], failed: [two], error: new Error("comment-suggestion-orphan") }, 2)).toEqual({
      done: "1 value applied",
      failed: "1 suggestion no longer fits its note and stays there.",
    });
    expect(proposedOutcomeWords(t, "applied", { decided: [], failed: [one, two], error: new Error("comment-suggestion-overlap") }, 2).failed).toBe("2 suggestions no longer fit their notes and stay there.");
    // Anything else is named: a decision already running, a write that failed.
    expect(proposedOutcomeWords(t, "applied", { decided: [], failed: [one], error: new Error("comment-operation-running") }, 1).failed).toBe(`1 suggestion stays open: ${t("comments.operationRunning")}`);
    expect(proposedOutcomeWords(t, "applied", { decided: [], failed: [one], error: new Error("disk full") }, 1).failed).toBe("1 suggestion stays open: disk full");
  });
});

describe("the chip in a cell", () => {
  it("is a button that opens the decision where the shell gives it one — and stops the cell's own click", () => {
    const onOpen = vi.fn();
    const onCell = vi.fn();
    const container = show(
      <div onClick={onCell}>
        <ProposedValueChip cell={cell()} current={undefined} column={column()} onOpen={onOpen} />
      </div>,
    );
    const chip = container.querySelector('[data-testid="cell-proposed-industry"]')!;
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.className).toContain("pv-chip--proposed");
    expect(chip.textContent).toBe("Film & Video");
    expect(chip.getAttribute("aria-label")).toBe("Suggested value for “Industry”: Film & Video");
    expect(chip.getAttribute("data-tip")).toBe(chip.getAttribute("aria-label"));
    act(() => (chip as HTMLElement).click());
    expect(onOpen).toHaveBeenCalledWith(chip);
    expect(onCell).not.toHaveBeenCalled();
  });

  it("is a label where the cell around it is what opens, and shows a removal as the value that goes", () => {
    const onCell = vi.fn();
    const container = show(
      <div onClick={onCell}>
        <ProposedValueChip cell={cell({ value: undefined, removed: true })} current="Health" column={column()} className="m-prop-proposed" />
      </div>,
    );
    const chip = container.querySelector('[data-testid="cell-proposed-industry"]')!;
    expect(chip.tagName).toBe("SPAN");
    expect(chip.className).toContain("pv-chip--removal");
    expect(chip.className).toContain("m-prop-proposed");
    expect(chip.textContent).toBe("Health");
    expect(chip.getAttribute("data-tip")).toBe("Suggested: clear “Industry”");
    // A label is no control: the tap is the cell's.
    act(() => (chip as HTMLElement).click());
    expect(onCell).toHaveBeenCalledTimes(1);
  });
});

describe("the line above the rows", () => {
  it("says how many values are proposed in the view and decides them all — and is not there while nothing is proposed", () => {
    const onAcceptAll = vi.fn();
    const onDeclineAll = vi.fn();
    const container = show(<ProposedValuesBar count={3} busy={false} onAcceptAll={onAcceptAll} onDeclineAll={onDeclineAll} />);
    const bar = container.querySelector('[data-testid="base-proposed-bar"]')!;
    expect(bar.textContent).toContain("3 suggested values in this view");
    const [accept, decline] = [bar.querySelector('[data-testid="base-proposed-accept-all"]') as HTMLButtonElement, bar.querySelector('[data-testid="base-proposed-decline-all"]') as HTMLButtonElement];
    expect([accept.textContent, decline.textContent]).toEqual(["Apply all", "Decline all"]);
    act(() => accept.click());
    act(() => decline.click());
    expect([onAcceptAll.mock.calls.length, onDeclineAll.mock.calls.length]).toEqual([1, 1]);

    act(() => root!.render(<ProposedValuesBar count={1} busy onAcceptAll={onAcceptAll} onDeclineAll={onDeclineAll} />));
    expect(container.textContent).toContain("1 suggested value in this view");
    // While a decision runs the buttons wait: a comment operation is one at a time.
    expect([...container.querySelectorAll("button")].map((button) => button.disabled)).toEqual([true, true]);

    act(() => root!.render(<ProposedValuesBar count={0} busy={false} onAcceptAll={onAcceptAll} onDeclineAll={onDeclineAll} />));
    expect(container.querySelector('[data-testid="base-proposed-bar"]')).toBeNull();
  });
});
