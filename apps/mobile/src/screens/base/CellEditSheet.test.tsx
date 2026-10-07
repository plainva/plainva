// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { CellEditSheet, type CellEditTarget, type CellProposal } from "./CellEditSheet";
import type { MobileVault } from "../../services/vaultService";

vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => lookup(key) }),
  };
});
// The sheet asks the vault for relation targets; nothing here is a relation.
vi.mock("../../services/baseOps", () => ({ relationCandidates: async () => [] }));

/**
 * The sheet of a cell that carries a proposed value (AI harness P5-4). On the
 * phone a proposed value is decided here: the cell's chip is a label, the cell
 * opens its sheet as it always does, and the proposal stands on top — above
 * the field, which stays what it was.
 */

const vault = { queryService: null } as unknown as MobileVault;
const target: CellEditTarget = { notePath: "Clients/Vogt.md", col: "industry", input: "text", value: "Health", options: [] };

function show(proposal?: CellProposal) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onCommit = vi.fn();
  const render = (next?: CellProposal) => act(async () => root.render(<CellEditSheet vault={vault} target={target} rows={[]} onCommit={onCommit} onClose={() => {}} proposal={next} />));
  return { host, onCommit, render: () => render(proposal), rerender: render };
}

const q = (host: Element, id: string) => host.querySelector(`[data-testid="${id}"]`);

describe("the sheet of a cell with a proposed value", () => {
  it("puts the proposal on top: who proposed it, the property's before and after, and the two answers", async () => {
    const proposal: CellProposal = { by: "Suggested by Plainva AI · m-1", view: { key: "Industry", before: "Health", after: "Medicine", removed: false }, canAccept: true, canDecline: true, busy: false, onAccept: vi.fn(), onDecline: vi.fn(), onOpenNote: vi.fn() };
    const sheet = show(proposal);
    await sheet.render();
    const block = q(sheet.host, "cell-proposal")!;
    expect(q(block, "cell-proposal-by")!.textContent).toBe("Suggested by Plainva AI · m-1");
    const diff = q(block, "comment-diff")!;
    expect(diff.getAttribute("data-property")).toBe("Industry");
    expect([diff.querySelector("del")!.textContent, diff.querySelector("ins")!.textContent]).toEqual(["Health", "Medicine"]);
    // Above the field, which is there as always: the value can also be entered by hand.
    const field = sheet.host.querySelector("textarea, input")!;
    expect(block.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => (q(block, "cell-proposal-accept") as HTMLButtonElement).click());
    await act(async () => (q(block, "cell-proposal-decline") as HTMLButtonElement).click());
    expect([(proposal.onAccept as ReturnType<typeof vi.fn>).mock.calls.length, (proposal.onDecline as ReturnType<typeof vi.fn>).mock.calls.length]).toEqual([1, 1]);
    // The way to the note — where the suggestion lives — is a row at the sheet's foot, not a third answer.
    const open = q(sheet.host, "cell-proposal-open") as HTMLButtonElement;
    expect(open.textContent).toBe("Show in the note");
    expect(block.contains(open)).toBe(false);
    await act(async () => open.click());
    expect(proposal.onOpenNote).toHaveBeenCalledTimes(1);
    // Deciding is not committing a value: the field's own save was not touched.
    expect(sheet.onCommit).not.toHaveBeenCalled();
  });

  it("says that a proposal takes the value away, and lets the answers wait while a decision runs", async () => {
    const proposal: CellProposal = { by: "Suggested value", view: { key: "Industry", before: "Health", after: "", removed: true }, canAccept: true, canDecline: true, busy: true, onAccept: vi.fn(), onDecline: vi.fn(), onOpenNote: vi.fn() };
    const sheet = show(proposal);
    await sheet.render();
    const block = q(sheet.host, "cell-proposal")!;
    expect(block.querySelector("ins")).toBeNull();
    expect(block.querySelector("del")!.textContent).toBe("Health");
    expect(block.textContent).toContain("removes this property");
    expect([(q(block, "cell-proposal-accept") as HTMLButtonElement).disabled, (q(block, "cell-proposal-decline") as HTMLButtonElement).disabled]).toEqual([true, true]);
  });

  it("offers only the answers this device may give: accepting writes the note, declining writes a remark", async () => {
    const proposal: CellProposal = { by: "Suggested value", view: { key: "Industry", before: "", after: "Film", removed: false }, canAccept: false, canDecline: true, busy: false, onAccept: vi.fn(), onDecline: vi.fn(), onOpenNote: vi.fn() };
    const sheet = show(proposal);
    await sheet.render();
    // May remark, may not write: the proposal is shown, and only declining is offered.
    expect(q(sheet.host, "cell-proposal-accept")).toBeNull();
    expect(q(sheet.host, "cell-proposal-decline")).not.toBeNull();
    // May do neither: the proposal and the way to its note stay, the answers do not.
    await sheet.rerender({ ...proposal, canDecline: false });
    expect(q(sheet.host, "cell-proposal")!.textContent).toContain("Film");
    expect(q(sheet.host, "cell-proposal")!.querySelector("button")).toBeNull();
    expect(q(sheet.host, "cell-proposal-open")).not.toBeNull();
  });

  it("is the sheet it always was where nothing is proposed", async () => {
    const sheet = show();
    await sheet.render();
    expect(q(sheet.host, "cell-proposal")).toBeNull();
    expect(q(sheet.host, "cell-proposal-open")).toBeNull();
    expect(q(sheet.host, "base-fill-column")).toBeNull();
    expect(sheet.host.querySelector("textarea, input")).not.toBeNull();
  });
});

/**
 * The door to a run that fills the cell's column (AI harness P5-4). The phone
 * has no column head to carry it, so it stands at the foot of the sheet a
 * cell opens — last, because it is about every entry, not about this one.
 */
describe("the door to filling the cell's column", () => {
  it("stands last at the sheet's foot and starts nothing but the plan", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onCommit = vi.fn();
    const onStart = vi.fn();
    const onComment = vi.fn();
    await act(async () => root.render(<CellEditSheet vault={vault} target={{ ...target, value: "" }} rows={[]} onCommit={onCommit} onClose={() => {}} onCommentProperty={onComment} fill={{ label: "Industry", onStart }} />));
    const door = q(host, "base-fill-column") as HTMLButtonElement;
    // The catalogue's own words (this file's translator leaves the column's name to the app).
    expect(door.textContent).toBe("Fill “{{column}}” with AI…");
    const rows = [...host.querySelectorAll("button.m-row")];
    expect(rows[rows.length - 1]).toBe(door);
    expect(rows[rows.length - 2]).toBe(q(host, "base-comment-property"));
    await act(async () => door.click());
    expect(onStart).toHaveBeenCalledTimes(1);
    // The door writes no value and starts no remark.
    expect(onCommit).not.toHaveBeenCalled();
    expect(onComment).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
  });
});
