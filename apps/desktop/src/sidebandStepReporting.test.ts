import { describe, expect, it, vi } from "vitest";
import {
  emptyDiagnostics,
  recordSecretsResult,
  reportSyncStepFailure,
  reportSyncStepSuccess,
  settingsSyncFailureIsWaiting,
  type SyncDiagnostics,
  type SyncStepReporter,
} from "@plainva/ui";
import { sourceFile } from "./test-sourceTree";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const shellSource = () => strip(sourceFile("apps/desktop/src/services/settingsProfile.ts"));
/** The desktop runner's cycle: `DesktopSidebandRunner.run`. */
const runnerCycle = () => {
  const source = shellSource();
  const runner = source.slice(source.indexOf("class DesktopSidebandRunner"));
  const from = runner.indexOf("async run(target: ISyncTarget, vault: IVaultAdapter)");
  return runner.slice(from, runner.indexOf("private reporter(", from));
};

/**
 * One decision for every sideband step (issue 113).
 *
 * The comment step used to toast its raw provider sentence on EVERY desktop
 * cycle and to swallow the very same failure on the phone; the secrets step
 * toasted on every cycle in both shells. Since issue 113 every step goes through
 * `reportSyncStepFailure`, the decision the settings step has used since
 * 2026-08-21, with its own durable record per step.
 *
 * The first half drives the shared decision through a store that behaves like
 * this shell's (a durable JSON record per vault); the second half is a SOURCE
 * guard, because what regresses silently is a new `toast.error` in a catch
 * block, and no behaviour test looks at those.
 */

function memoryReporter() {
  let stored: SyncDiagnostics = emptyDiagnostics();
  const said: string[] = [];
  const io: SyncStepReporter = {
    load: async () => JSON.parse(JSON.stringify(stored)) as SyncDiagnostics,
    update: async (reduce) => { stored = JSON.parse(JSON.stringify(reduce(await io.load()))) as SyncDiagnostics; },
    announce: (failure) => { said.push(failure.message); },
    now: () => "2026-09-30T08:00:00.000Z",
  };
  return { io, said, record: () => stored };
}

const rejected = () => new Error("Sideband returned an unbound validator");
const timeout = () => new Error("request timed out after 30000ms");

describe("the comment step reports like the settings step", () => {
  it("announces two identical failures exactly once", async () => {
    const { io, said, record } = memoryReporter();
    await reportSyncStepFailure("comments", rejected(), io);
    await reportSyncStepFailure("comments", rejected(), io);
    expect(said).toHaveLength(1);
    expect(record().lastCommentsError?.reported).toBe(true);
    // Its own record: the settings entry stays untouched.
    expect(record().lastError).toBeUndefined();
  });

  it("waits out a dropped request and shows it as waiting", async () => {
    const { io, said, record } = memoryReporter();
    await reportSyncStepFailure("comments", timeout(), io);
    await reportSyncStepFailure("comments", timeout(), io);
    expect(said).toEqual([]);
    expect(settingsSyncFailureIsWaiting(record().lastCommentsError)).toBe(true);
    await reportSyncStepFailure("comments", timeout(), io);
    expect(said).toHaveLength(1);
  });

  it("clears after a good cycle, so the same failure is news again", async () => {
    const { io, said, record } = memoryReporter();
    await reportSyncStepFailure("comments", rejected(), io);
    await reportSyncStepSuccess("comments", io);
    expect(record().lastCommentsError).toBeUndefined();
    await reportSyncStepFailure("comments", rejected(), io);
    expect(said).toHaveLength(2);
  });

  it("writes nothing on success when there was nothing to clear", async () => {
    const { io } = memoryReporter();
    const update = vi.spyOn(io, "update");
    await reportSyncStepSuccess("comments", io);
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the secrets record separate and clears it with the next result", async () => {
    const { io, said, record } = memoryReporter();
    await reportSyncStepFailure("secrets", rejected(), io);
    await reportSyncStepFailure("secrets", rejected(), io);
    expect(said).toHaveLength(1);
    expect(record().lastSecretsError).toBeDefined();
    const cleared = recordSecretsResult(record(), "2026-09-30T08:05:00.000Z", {
      imported: [], unchanged: [], rejected: [], stale: [], errors: [], unknownAccounts: [], legacyEntries: [], entries: [],
    } as unknown as Parameters<typeof recordSecretsResult>[2]);
    expect(cleared.lastSecretsError).toBeUndefined();
  });
});

/** Every `toast.error` in the runner's cycle must be the announce callback of the decision. */
function toastsOutsideTheDecision(run: string): string[] {
  const bypasses: string[] = [];
  let at = run.indexOf("toast.error(");
  while (at !== -1) {
    const call = run.lastIndexOf("reportSyncStepFailure(", at);
    let depth = 0;
    if (call !== -1) for (let i = call; i < at; i++) { if (run[i] === "(") depth++; else if (run[i] === ")") depth--; }
    if (call === -1 || depth <= 0) bypasses.push(run.slice(at, run.indexOf("\n", at)));
    at = run.indexOf("toast.error(", at + 1);
  }
  return bypasses;
}

describe("no sync step toasts past the decision", () => {
  const run = runnerCycle();

  it("finds the cycle it guards", () => {
    expect(run).toMatch(/comments\.run\(target, vault\)/);
    expect(run).toMatch(/secrets\.run\(target, vault\)/);
  });

  it("routes every error toast of the cycle through reportSyncStepFailure", () => {
    expect(toastsOutsideTheDecision(run)).toEqual([]);
    for (const step of ["settings", "secrets", "comments"]) expect(run).toContain(`reportSyncStepFailure("${step}"`);
  });

  it("clears the comment record after a good cycle and is not silent on a bad one", () => {
    expect(run).toMatch(/reportSyncStepSuccess\("comments"/);
    const comments = run.slice(run.indexOf("comments.run(target, vault)"));
    expect(comments.slice(0, comments.indexOf("plainva-comments-synced"))).toMatch(/catch \(error\)/);
  });

  it("hands the comment step a way to log its transport notes", () => {
    const source = shellSource();
    const step = source.slice(source.indexOf("new CommentsSyncStep({"), source.indexOf("});", source.indexOf("new CommentsSyncStep({")));
    expect(step).toMatch(/onDiagnostic: \(line\) => logDiagnostic\("sync", line\)/);
  });
});
