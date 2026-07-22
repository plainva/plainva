import { createWorkspaceObjectId } from "./identity.js";
import type { WorkspaceRekeyJob, WorkspaceRekeyMode, WorkspaceStateStore } from "./state.js";

function nowIso(): string { return new Date().toISOString(); }

/**
 * Creates a durable rekey cursor. Future-only rotation deliberately contains
 * no content items; a full rotation snapshots current revision ids and lets
 * the normal signed mutation queue rewrite every readable live object.
 */
export async function startWorkspaceRekey(input: {
  state: WorkspaceStateStore;
  mode: WorkspaceRekeyMode;
  subjectKind: WorkspaceRekeyJob["subjectKind"];
  subjectId: string;
  objectIds?: string[];
}): Promise<WorkspaceRekeyJob> {
  const meta = await input.state.loadMeta();
  if (!meta) throw new Error("workspace-state-missing");
  if (meta.rekeyJob && meta.rekeyJob.phase !== "complete" && meta.rekeyJob.phase !== "failed") throw new Error("workspace-rekey-already-running");
  const selected = input.objectIds ? new Set(input.objectIds) : null;
  const objects = input.mode === "full"
    ? (await input.state.listObjects()).filter((entry) => !selected || selected.has(entry.objectId))
    : [];
  const createdAt = nowIso();
  const job: WorkspaceRekeyJob = {
    jobId: createWorkspaceObjectId(), mode: input.mode, subjectKind: input.subjectKind, subjectId: input.subjectId,
    phase: input.mode === "future" || objects.length === 0 ? "complete" : "queued",
    createdAt, updatedAt: createdAt, completedAt: input.mode === "future" || objects.length === 0 ? createdAt : null,
    total: objects.length, completed: 0,
    items: objects.map((entry) => ({ objectId: entry.objectId, path: entry.path, baselineRevisionId: entry.currentRevisionId, complete: false })),
    lastError: null,
  };
  meta.rekeyJob = job;
  await input.state.saveMeta(meta);
  if (job.phase !== "complete") return (await resumeWorkspaceRekey(input.state))!;
  return job;
}

/** Idempotently resumes a full rekey after a crash, pause or process kill. */
export async function resumeWorkspaceRekey(state: WorkspaceStateStore): Promise<WorkspaceRekeyJob | null> {
  const meta = await state.loadMeta();
  const job = meta?.rekeyJob;
  if (!meta || !job || job.phase === "complete" || job.phase === "failed") return job ?? null;
  try {
    job.phase = "rewriting";
    for (const item of job.items) {
      if (item.complete) continue;
      const current = await state.getObjectById(item.objectId);
      if (!current || current.deleted || current.currentRevisionId !== item.baselineRevisionId) {
        item.complete = true;
        continue;
      }
      if (!await state.hasPendingForPath(current.path)) await state.enqueue(current.contentKind === "directory" ? "mkdir" : "write", current.path);
    }
    job.completed = job.items.filter((item) => item.complete).length;
    job.updatedAt = nowIso();
    if (job.completed === job.total) { job.phase = "complete"; job.completedAt = job.updatedAt; }
    job.lastError = null;
  } catch (error) {
    job.lastError = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  }
  meta.rekeyJob = job;
  await state.saveMeta(meta);
  return job;
}
