// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RepeatTaskSheet } from "./RepeatTaskSheet";
import { CommentsSheet } from "./CommentsSheet";
import { activeLeaveGuard, armLeaveGuard, armedLeaveGuards, resetLeaveGuard } from "../services/leaveGuard";
import { askBeforeLeaving } from "../services/leaveQuestion";
import { closeTopSheet, openSheetCount } from "../services/sheetStack";
import { currentMobileDialog, dismissMobileDialog } from "../services/mobileDialogs";

/**
 * A sheet that holds what the person typed (finding 2026-10-22, § 3.139 Nr. 3).
 *
 * A tap beside it, a drag on its grip, Android back or its "Cancel" closed it
 * and the text went without a word; and a step that took the screen did not
 * know the sheet was there — nine screens armed a leave guard, no sheet did.
 * The sheets here are the real ones.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const answer = (discard: boolean) => {
  const dialog = currentMobileDialog();
  expect(dialog?.kind, "the question is on screen").toBe("confirm");
  if (dialog?.kind !== "confirm") throw new Error("no question");
  dialog.resolve(discard);
  dismissMobileDialog(dialog);
};
/** Types into a controlled field the way a person does: React hears the input event. */
function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  resetLeaveGuard();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  const open = currentMobileDialog();
  if (open) dismissMobileDialog(open);
  resetLeaveGuard();
});

function RepeatHost({ onClose }: { onClose: () => void }) {
  return <RepeatTaskSheet taskTitle="Water the plants" initial={null} currentDue="2026-11-02" onClose={onClose} onSubmit={async () => {}} />;
}

describe("a sheet with typed input", () => {
  it("closes at once while nothing is typed, and arms nothing", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<RepeatHost onClose={onClose} />));
    expect(activeLeaveGuard()).toBeNull();
    await act(async () => document.querySelector<HTMLElement>(".m-sheet-backdrop")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(currentMobileDialog()).toBeNull();
  });

  it("asks before a tap beside it takes what was typed, and keeps it on cancel", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<RepeatHost onClose={onClose} />));
    const field = document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    await act(async () => typeInto(field, "3"));
    expect(field.value).toBe("3");
    // Every step that would take the screen now knows the sheet is there.
    expect(activeLeaveGuard()?.id).toBe("repeat-task");

    await act(async () => document.querySelector<HTMLElement>(".m-sheet-backdrop")!.click());
    await settle();
    expect(onClose, "the sheet went without a question").not.toHaveBeenCalled();
    await act(async () => answer(false));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(field.value).toBe("3");

    await act(async () => document.querySelector<HTMLElement>(".m-sheet-backdrop")!.click());
    await settle();
    await act(async () => answer(true));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Android back asks too, and a back declined leaves the sheet in charge of the next press", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<RepeatHost onClose={onClose} />));
    await act(async () => typeInto(document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!, "4"));
    expect(openSheetCount()).toBe(1);

    await act(async () => { closeTopSheet(); });
    await settle();
    await act(async () => answer(false));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    // Had the press taken the sheet's entry, the next one would pop the screen below.
    expect(openSheetCount(), "the sheet is still the back button's").toBe(1);

    await act(async () => { closeTopSheet(); });
    await settle();
    await act(async () => answer(true));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a comment being written is asked about", async () => {
    const onClose = vi.fn();
    const props = { comments: [], memberNames: new Map<string, string>(), selfMemberId: "me", canComment: true, canWrite: true,
      onSubmit: async () => {}, onResolve: () => {}, onApplySuggestion: () => {}, onDeclineSuggestion: () => {},
      onPromoteToTask: () => {}, onRevealAnchor: () => {}, onClose };
    await act(async () => root.render(<CommentsSheet {...props} />));
    const field = document.querySelector<HTMLTextAreaElement>(".pv-comment-compose textarea")!;
    await act(async () => typeInto(field, "Please look at this"));
    expect(activeLeaveGuard()?.id).toBe("comment-compose");
    await act(async () => document.querySelector<HTMLElement>(".m-sheet-backdrop")!.click());
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer(true));
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("over a screen that holds input, both are asked about, and closing the sheet keeps the screen's guard", async () => {
    armLeaveGuard({ id: "cell-screen", message: "The screen's input." });
    const onClose = vi.fn();
    await act(async () => root.render(<RepeatHost onClose={onClose} />));
    await act(async () => typeInto(document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!, "5"));
    expect(armedLeaveGuards().map((g) => g.id)).toEqual(["cell-screen", "repeat-task"]);

    // A step that takes the screen takes both, so the one question names both.
    const leaving = askBeforeLeaving();
    await settle();
    const dialog = currentMobileDialog();
    expect(dialog?.kind === "confirm" ? dialog.message : "").toContain("The screen's input.");
    await act(async () => answer(false));
    expect(await leaving).toBe(false);

    // The sheet goes; the screen's input is still guarded.
    await act(async () => root.render(<></>));
    expect(armedLeaveGuards().map((g) => g.id)).toEqual(["cell-screen"]);
  });
});
