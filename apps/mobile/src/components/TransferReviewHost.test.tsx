// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";

/**
 * The review of a copy into a new vault (plan "Verbinden-Assistent", E4;
 * review 2026-10-28): shown in place by the files step, as a sheet only when
 * no step shows it - and never left open by a run that ended, where it
 * blocked the next run's review until the app restarted.
 */

const run = vi.hoisted(() => ({ value: null as null | { id?: string; pending: string[] } }));
vi.mock("../services/connectQueue", () => ({ CONNECT_RUN_EVENT: "m-connect-run-changed", loadConnectQueue: async () => run.value }));
vi.mock("./CompareVersions", () => ({ CompareVersions: () => null }));
vi.mock("./SheetGrip", () => ({ SheetGrip: () => null }));

import { TransferReviewHost, reviewVaultTransfer, useInlineTransferReview, type TransferAnswer } from "./TransferReviewHost";

function Step() {
  const review = useInlineTransferReview(true);
  return <div data-testid="inline">{review ? review.folder : ""}</div>;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  run.value = { pending: ["files"] };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const plan = { local: [{ path: "a.md" }], remote: [], collisions: [] } as never;
const ask = () => reviewVaultTransfer(plan, { source: "Mine", target: "Google Drive · wiki", folder: "wiki", existing: false });

describe("the review of a copy", () => {
  it("is answered when a new run replaces the one that asked, even on its own files step", async () => {
    await act(async () => { root.render(<TransferReviewHost />); });
    run.value = { id: "old", pending: ["files"] };
    let answered: TransferAnswer | null = null;
    await act(async () => { void reviewVaultTransfer(plan, { source: "Mine", target: "T", folder: "wiki", existing: false, runId: "old" }).then((a) => { answered = a; }); });
    run.value = { id: "new", pending: ["files"] };
    await act(async () => { window.dispatchEvent(new CustomEvent("m-connect-run-changed")); });
    await act(async () => { await Promise.resolve(); });
    expect(answered).toBe("cancel");
  });

  it("shows as a sheet only while no step shows it in place", async () => {
    let answered: TransferAnswer | null = null;
    await act(async () => { root.render(<TransferReviewHost />); });
    await act(async () => { void ask().then((a) => { answered = a; }); });
    expect(container.querySelector(".m-sheet")).not.toBeNull();
    // The sheet offers no other folder: there is no step on screen to pick one.
    expect(container.querySelector('[data-testid="transfer-review-other"]')).toBeNull();
    await act(async () => { root.render(<><TransferReviewHost /><Step /></>); });
    expect(container.querySelector(".m-sheet")).toBeNull();
    expect(container.querySelector('[data-testid="inline"]')?.textContent).toBe("wiki");
    run.value = null;
    await act(async () => { window.dispatchEvent(new CustomEvent("m-connect-run-changed")); });
    await act(async () => { await Promise.resolve(); });
    expect(answered).toBe("cancel");
  });

  it("answers the question a stopped run left open, so the next run can ask its own", async () => {
    await act(async () => { root.render(<><TransferReviewHost /><Step /></>); });
    let answered: TransferAnswer | null = null;
    await act(async () => { void ask().then((a) => { answered = a; }); });
    run.value = null;
    await act(async () => { window.dispatchEvent(new CustomEvent("m-connect-run-changed")); });
    await act(async () => { await Promise.resolve(); });
    expect(answered).toBe("cancel");
    // A new review can be asked; it would throw "transfer_review_busy" otherwise.
    run.value = { pending: ["files"] };
    let second: Promise<TransferAnswer> | null = null;
    await act(async () => { second = ask(); });
    expect(second).not.toBeNull();
    run.value = null;
    await act(async () => { window.dispatchEvent(new CustomEvent("m-connect-run-changed")); });
    await act(async () => { await Promise.resolve(); });
    await expect(second!).resolves.toBe("cancel");
  });
});
