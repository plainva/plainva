import { describe, expect, it } from "vitest";
import { workspaceActivationStore } from "./workspaceActivationStore";

/**
 * The store behind the app-level activation overlay (K8, finding 2026-09-03).
 *
 * Its contract is small and load-bearing: a running sweep is visible from
 * `start` until `finish`, a failure keeps the slot until the user dismisses
 * it, and progress after the sweep ended cannot resurrect the window.
 */
describe("workspaceActivationStore", () => {
  it("shows a sweep from start to finish and reports progress in between", () => {
    const seen: string[] = [];
    const stop = workspaceActivationStore.subscribe(() => seen.push(workspaceActivationStore.get().phase));
    workspaceActivationStore.start("/vault", "activate");
    workspaceActivationStore.progress(3, 10);
    const running = workspaceActivationStore.get();
    expect(running).toEqual({ phase: "running", vaultPath: "/vault", kind: "activate", done: 3, total: 10 });
    workspaceActivationStore.finish();
    expect(workspaceActivationStore.get()).toEqual({ phase: "idle" });
    expect(seen).toEqual(["running", "running", "idle"]);
    stop();
  });

  it("keeps a failure on screen until it is dismissed, and ignores late progress", () => {
    workspaceActivationStore.start("/vault", "resume");
    workspaceActivationStore.fail("object store unreachable");
    expect(workspaceActivationStore.get()).toEqual({ phase: "error", vaultPath: "/vault", kind: "resume", message: "object store unreachable" });
    workspaceActivationStore.progress(9, 10);
    expect(workspaceActivationStore.get().phase).toBe("error");
    workspaceActivationStore.finish();
    expect(workspaceActivationStore.get()).toEqual({ phase: "idle" });
    workspaceActivationStore.start("/vault", "activate");
    workspaceActivationStore.fail("x");
    workspaceActivationStore.dismiss();
    expect(workspaceActivationStore.get()).toEqual({ phase: "idle" });
  });

  it("does not notify for a repeated identical progress value", () => {
    let calls = 0;
    const stop = workspaceActivationStore.subscribe(() => { calls += 1; });
    workspaceActivationStore.start("/vault", "activate");
    workspaceActivationStore.progress(1, 4);
    workspaceActivationStore.progress(1, 4);
    expect(calls).toBe(2);
    workspaceActivationStore.finish();
    stop();
  });
});
