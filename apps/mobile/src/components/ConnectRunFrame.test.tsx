// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";

/**
 * The frame of the account setup's steps (plan "Verbinden-Assistent",
 * 2026-10-28; device finding 2026-10-28, TestFlight 148): one bar with
 * "Stop", who is signed in, the steps of the whole way, ONE question - and a
 * failure with its sender, where the banner before it said "the provider's
 * answer" to a database the phone itself had closed.
 */

const calls = vi.hoisted(() => ({ cleared: 0, skipped: [] as string[], abandoned: 0, order: [] as string[], confirm: true, confirmMessage: "" }));
vi.mock("../services/connectQueue", () => ({
  clearConnectQueue: vi.fn(async () => { calls.cleared += 1; }),
  skipConnectStep: vi.fn(async (service: string) => { calls.skipped.push(service); calls.order.push(`skip:${service}`); }),
  loadConnectQueue: async () => null,
  runServices: (q: { pending: string[]; done: string[]; skipped?: string[] }) => ["files", "calendar", "mail"].filter((s) => q.pending.includes(s) || q.done.includes(s) || (q.skipped ?? []).includes(s)),
}));
vi.mock("../services/accountVaultTransfer", () => ({ abandonPreparedFiles: vi.fn(async () => { calls.abandoned += 1; calls.order.push("abandon"); }) }));
vi.mock("../services/cloudAccountsStore", () => ({ loadCloudAccounts: async () => [{ id: "acc", family: "google", label: "anna@example.com", services: {} }] }));
vi.mock("../services/mobileDialogs", () => ({ mConfirm: vi.fn(async (opts: { message: string }) => { calls.confirmMessage = opts.message; return calls.confirm; }) }));
vi.mock("../services/pim/pimOAuth", () => ({ hasReceivedPimOAuthResult: async () => false, resumePimOAuthResult: async () => {} }));

import { ConnectRunFooter, ConnectRunFrame, ConnectRunSummary } from "./ConnectRunFrame";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  calls.cleared = 0; calls.skipped = []; calls.abandoned = 0; calls.order = []; calls.confirm = true; calls.confirmMessage = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const run = (over: Record<string, unknown> = {}) => ({
  id: "run", family: "google", context: { vaultId: "v", cloudAccountId: "acc", runId: "run" },
  pending: ["files", "calendar"], done: [], skipped: [], outcomes: {}, selectionConfirmed: false, createdAt: 1, ...over,
}) as never;

const q = (selector: string) => container.querySelector(selector);
const click = async (selector: string) => { await act(async () => { (q(selector) as HTMLElement).click(); }); };

describe("the frame of a setup step", () => {
  it("shows who is signed in and the steps of the whole way, the sign-in done and the folder active", async () => {
    await act(async () => { root.render(<ConnectRunFrame run={run()} service="files" heading="Where is your vault in Google?" onLeave={() => {}} />); });
    expect(q('[data-testid="connectrun-account"]')?.textContent).toContain("anna@example.com");
    const steps = [...container.querySelectorAll('[data-testid="connectrun-steps"] li')].map((li) => `${li.textContent}:${li.getAttribute("data-state")}`);
    expect(steps).toEqual(["Sign in:done", "2Folder:active", "3Calendar:pending"]);
    expect(q('[data-testid="connectrun-heading"]')?.textContent).toBe("Where is your vault in Google?");
  });

  it("names the device as the sender of a closed database, with its words below", async () => {
    await act(async () => {
      root.render(<ConnectRunFrame run={run({ outcomes: { files: { state: "failed", message: "Query: Connection to plainva-45e9259f not available" } } })} service="files" heading="h" onLeave={() => {}} onRetry={() => {}} />);
    });
    const note = q('[data-testid="connectrun-outcome"]')!;
    expect(note.getAttribute("data-source")).toBe("device");
    expect(note.querySelector("strong")?.textContent).toBe("Error on this device");
    expect(note.textContent).not.toMatch(/provider's answer/i);
    expect(note.querySelector("code")?.textContent).toBe("Query: Connection to plainva-45e9259f not available");
    expect(q('[data-testid="connectrun-retry"]')).not.toBeNull();
  });

  it("offers signing in again where the provider no longer accepts the sign-in", async () => {
    await act(async () => {
      root.render(<ConnectRunFrame run={run({ outcomes: { files: { state: "failed", message: "invalid_grant" } } })} service="files" heading="h" onLeave={() => {}} onSignIn={() => {}} onRetry={() => {}} />);
    });
    expect(q('[data-testid="connectrun-outcome"]')?.getAttribute("data-source")).toBe("provider");
    expect(q('[data-testid="connectrun-signin"]')).not.toBeNull();
  });

  it("stops only after asking, and the question names what is not set up", async () => {
    let left = 0;
    await act(async () => { root.render(<ConnectRunFrame run={run()} service="files" heading="h" onLeave={() => { left += 1; }} />); });
    calls.confirm = false;
    await click('[data-testid="connectrun-cancel"]');
    expect(calls.cleared).toBe(0);
    expect(left).toBe(0);
    expect(calls.confirmMessage).toContain("Files, Calendar");
    calls.confirm = true;
    await click('[data-testid="connectrun-cancel"]');
    expect(calls.cleared).toBe(1);
    expect(calls.abandoned).toBe(1);
    expect(left).toBe(1);
  });

  it("skips the step on screen", async () => {
    await act(async () => { root.render(<ConnectRunFooter run={run()} service="files" />); });
    expect(q('[data-testid="connectrun-skip"]')?.textContent).toBe("Skip files");
    await click('[data-testid="connectrun-skip"]');
    expect(calls.skipped).toEqual(["files"]);
    // A destination the files step prepared is let go of first (third review 2026-10-28).
    expect(calls.order).toEqual(["abandon", "skip:files"]);
  });

  it("skipping the calendar leaves the files step's destination alone", async () => {
    await act(async () => { root.render(<ConnectRunFooter run={run({ pending: ["calendar"], done: ["files"] })} service="calendar" />); });
    await click('[data-testid="connectrun-skip"]');
    expect(calls.order).toEqual(["skip:calendar"]);
  });
});

describe("the summary of a setup", () => {
  it("names each service, a skipped one as skipped, and ends the run with Done", async () => {
    let done = 0;
    await act(async () => {
      root.render(<ConnectRunSummary run={run({ pending: [], done: ["files"], skipped: ["calendar"] })} onDone={() => { done += 1; }} />);
    });
    expect(q('[data-testid="connectrun-summary-files"]')?.getAttribute("data-state")).toBe("connected");
    expect(q('[data-testid="connectrun-summary-calendar"]')?.getAttribute("data-state")).toBe("skipped");
    expect(q('[data-testid="connectrun-cancel"]')).toBeNull();
    await click('[data-testid="connectrun-done"]');
    expect(calls.cleared).toBe(1);
    expect(done).toBe(1);
  });
});
