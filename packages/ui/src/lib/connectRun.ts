import type { CloudServiceId } from "./cloudAccounts";

/**
 * The account setup after the sign-in, as both shells name it (plan
 * "Verbinden-Assistent", 2026-10-28, E1/E3/E6).
 *
 * The sign-in is a step of the setup and is counted as done: the person has
 * just come back from it. The services follow in one fixed order, and each is
 * done, the one being set up, still to come, or skipped. What a step is
 * CALLED says what the person does in it: the files service is set up by
 * choosing a folder, so its step is "Folder" - the service keeps its name
 * "Files" everywhere else.
 */

export const CONNECT_SERVICE_ORDER: readonly CloudServiceId[] = ["files", "calendar", "mail"];

export type ConnectStepId = "signin" | CloudServiceId;
export type ConnectStepState = "done" | "active" | "pending" | "skipped";

export interface ConnectStep {
  id: ConnectStepId;
  state: ConnectStepState;
}

/** What a run knows of its services; `skipped` is absent in runs saved before skipping existed. */
export interface ConnectRunProgress {
  pending: readonly CloudServiceId[];
  done: readonly CloudServiceId[];
  skipped?: readonly CloudServiceId[];
}

export function connectRunSteps(run: ConnectRunProgress): ConnectStep[] {
  const skipped = run.skipped ?? [];
  const steps: ConnectStep[] = [{ id: "signin", state: "done" }];
  for (const service of CONNECT_SERVICE_ORDER) {
    if (run.done.includes(service)) steps.push({ id: service, state: "done" });
    else if (skipped.includes(service)) steps.push({ id: service, state: "skipped" });
    else if (run.pending.includes(service)) steps.push({ id: service, state: run.pending[0] === service ? "active" : "pending" });
  }
  return steps;
}

/** The label key of a step: "Sign in", "Folder", "Calendar", "Email". */
export function connectStepLabelKey(id: ConnectStepId): string {
  if (id === "signin") return "cloudAccounts.stepSignIn";
  return id === "files" ? "connectRun.stepFiles" : id === "calendar" ? "connectRun.stepCalendar" : "connectRun.stepMail";
}

/** The "skip" label of a service's step. */
export function connectSkipLabelKey(service: CloudServiceId): string {
  return service === "files" ? "connectRun.skipFiles" : service === "calendar" ? "connectRun.skipCalendar" : "connectRun.skipMail";
}

/** A run with one service skipped: it leaves the queue without being done. */
export function withSkipped<T extends ConnectRunProgress>(run: T, service: CloudServiceId): T {
  if (run.pending[0] !== service) return run;
  return { ...run, pending: run.pending.slice(1), skipped: [...(run.skipped ?? []), service] };
}

/** What stopping the setup leaves: the services already set up stay, the rest is not set up. */
export function connectRunEnding(run: ConnectRunProgress): { kept: CloudServiceId[]; notSetUp: CloudServiceId[] } {
  return {
    kept: CONNECT_SERVICE_ORDER.filter((service) => run.done.includes(service)),
    notSetUp: CONNECT_SERVICE_ORDER.filter((service) => run.pending.includes(service) || (run.skipped ?? []).includes(service)),
  };
}
