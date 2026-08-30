/**
 * Keeping a published slice current (Stufe B, S4b).
 *
 * `planPublicationRefresh` and `runPublicationRefresh` know how to compare a
 * manifest against a set of covered objects and how to write the difference.
 * What they do not know is where either side comes from - and that is
 * deliberate, because both answers involve things `packages/core` must not
 * reach for on its own: the vault's index database, and the OS credential store
 * that holds the publication's keys. This module is the seam. It answers the
 * two questions once, for both shells, so desktop and mobile cannot answer them
 * differently.
 *
 * Coverage comes from the slice's `materializedObjectIds` rather than from a
 * fresh evaluation of the slice rule. Two reasons, and the second is the one
 * that matters: the caller here is a background cycle with no database adapter,
 * so it could not enrich objects with tags and properties and would silently
 * mis-evaluate every dynamic slice; and `isScopeMatch` - the check that decides
 * whether a member may read an object at all - reads that same list. Publishing
 * from one source and authorising from another is how a publication comes to
 * contain a note the policy says nobody may see.
 */
import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { WorkspacePolicyPayload, WorkspacePolicySlice } from "./documents.js";
import {
  planPublicationRefresh,
  runPublicationRefresh,
  type PublicationRefreshItem,
  type PublicationSourceObject,
} from "./publication.js";
import { publicationStoreFor, projectPublishedMarkdown } from "./publishedSlices.js";
import type { WorkspaceObjectStore } from "./objectStore.js";
import type { PersonalWorkspaceRuntime } from "./personal.js";
import type { WorkspaceObjectRecord, WorkspacePublicationRecord, WorkspaceStateStore } from "./state.js";

/** Why a publication was left alone this cycle. Never an error - each one is a normal state. */
export type PublicationRefreshSkip =
  /** The slice is gone from the policy. Retracting is a decision a person makes, not a background job. */
  | "no-slice"
  /** This device holds no key for the publication. Another device of the same publisher does. */
  | "no-key"
  /** The publication already matches the slice. */
  | "up-to-date";

export interface PublicationRefreshOutcome {
  publicationId: string;
  planned: number;
  applied: number;
  /** Why the run stopped, or null when it finished (or never started - see `skipped`). */
  error: string | null;
  skipped: PublicationRefreshSkip | null;
}

export interface RefreshWorkspacePublicationsInput {
  state: Pick<WorkspaceStateStore, "listPublications" | "listObjects" | "savePublication">;
  vault: Pick<IVaultAdapter, "readTextFile">;
  /** Only the slice list is read; the rest of the policy has no say in what gets published. */
  policy: Pick<WorkspacePolicyPayload, "slices">;
  /** The provider store of the MAIN workspace; each publication is a namespace inside it. */
  store: WorkspaceObjectStore;
  /**
   * The MAIN workspace's id - not the publication's own, which is a different
   * value entirely (a publication bootstraps a workspace whose id IS its
   * publication id). The pair (this, sliceId) is what `derivePublicationId`
   * turned into the folder at creation time, so it is the only pair that finds
   * that folder again.
   */
  workspaceId: string;
  /**
   * Answers the one question core cannot: does THIS device hold the
   * publication's keys? Null when it does not. The shell owns only this,
   * because the runtime lives in the OS credential store - deriving the store
   * stays here, so a shell cannot address a publication under a name nobody
   * joined.
   */
  openPublicationRuntime: (record: WorkspacePublicationRecord) => Promise<PersonalWorkspaceRuntime | null>;
  now?: () => string;
  onProgress?: (publicationId: string, completed: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * The objects a slice currently covers, in the shape a refresh plan needs.
 *
 * Three filters, each closing a way a publication could go wrong:
 *
 * - A deleted object keeps its row (the tombstone is how other devices learn of
 *   the deletion), so publishing it would hand out a note the author removed.
 *   `listObjects()` already hides tombstones by default; this does not rely on
 *   that default staying the default.
 * - An object without a current revision has no content yet; there is nothing
 *   to project.
 * - Only text is published. A publication is Markdown, and an embed pointing at
 *   an excluded binary is already removed VISIBLY by the projection, which
 *   makes this consistent with what the preview shows rather than a second,
 *   silent drop.
 */
function coveredSourceObjects(
  slice: WorkspacePolicySlice,
  objects: readonly WorkspaceObjectRecord[],
): { covered: PublicationSourceObject[]; byId: Map<string, WorkspaceObjectRecord> } {
  const wanted = new Set(slice.materializedObjectIds);
  const covered: PublicationSourceObject[] = [];
  const byId = new Map<string, WorkspaceObjectRecord>();
  for (const object of objects) {
    if (!wanted.has(object.objectId)) continue;
    if (object.deleted || !object.currentRevisionId || object.contentKind !== "text") continue;
    covered.push({ sourceObjectId: object.objectId, path: object.path, sourceRevisionId: object.currentRevisionId });
    byId.set(object.objectId, object);
  }
  return { covered, byId };
}

/**
 * Brings every publication of this workspace back in line with its slice.
 *
 * Runs inside the sync cycle, after the vault itself is settled: publishing a
 * revision the main workspace has not accepted yet would put a note into a
 * publication that does not exist upstream.
 *
 * Failures are recorded, not thrown. A provider outage must not take the vault
 * sync down with it - and because nobody watches a background cycle, the reason
 * is written to the record so a person can be shown it later.
 */
export async function refreshWorkspacePublications(
  input: RefreshWorkspacePublicationsInput,
): Promise<PublicationRefreshOutcome[]> {
  const records = await input.state.listPublications();
  if (records.length === 0) return [];

  const now = input.now ?? (() => new Date().toISOString());
  const objects = await input.state.listObjects();
  const slices = new Map(input.policy.slices.map((slice) => [slice.sliceId, slice]));
  const outcomes: PublicationRefreshOutcome[] = [];

  for (const record of records) {
    if (input.signal?.aborted) break;

    const slice = slices.get(record.sliceId);
    if (!slice) {
      // Deliberately NOT a retraction of everything. That is what an empty
      // coverage set would mean here, and taking a whole publication down
      // because a slice vanished - or because a policy arrived half-read - is
      // a decision that belongs to a person and a dialog (S6).
      outcomes.push({ publicationId: record.publicationId, planned: 0, applied: 0, error: null, skipped: "no-slice" });
      continue;
    }

    const { covered, byId } = coveredSourceObjects(slice, objects);
    const plan = planPublicationRefresh({ manifest: record.manifest, covered });
    if (plan.length === 0) {
      // A stale reason would keep reporting a publication as broken long after
      // the next run got through, so a clean pass clears it.
      if (record.lastError !== null) {
        await input.state.savePublication({ ...record, lastError: null, lastRefreshedAt: now() });
      }
      outcomes.push({ publicationId: record.publicationId, planned: 0, applied: 0, error: null, skipped: "up-to-date" });
      continue;
    }

    const publicationRuntime = await input.openPublicationRuntime(record);
    if (!publicationRuntime) {
      // No key on THIS device is not a failure of the publication: the
      // publisher's other device still refreshes it, and writing an error here
      // would show a broken publication to someone who cannot act on it.
      outcomes.push({ publicationId: record.publicationId, planned: plan.length, applied: 0, error: null, skipped: "no-key" });
      continue;
    }

    // Derived here rather than handed in: the pair below is the same one
    // `createPublication` used, so the refresh cannot write into a folder
    // nobody joined. Passing a ready-made store would put that pairing in two
    // shells, where a publication's OWN workspace id is right there and looks
    // just as plausible - and picking it would produce a silent orphan rather
    // than an error.
    const handle = {
      publicationId: record.publicationId,
      runtime: publicationRuntime,
      store: publicationStoreFor(input.store, input.workspaceId, record.sliceId),
    };

    // The same set the plan was built from, so the projection cannot compute
    // against a different notion of "inside the publication" than the one the
    // objects were selected by. `previewPublishedProjection` derives it the
    // same way for the same reason.
    const includedPaths = covered.map((object) => object.path);

    const project = async (item: PublicationRefreshItem) => {
      const markdown = await input.vault.readTextFile(item.path);
      const source = byId.get(item.sourceObjectId);
      const text =
        record.config.mode === "exact"
          ? markdown
          : projectPublishedMarkdown({
              markdown,
              includedPaths,
              propertyAllowlist: record.config.propertyAllowlist,
              privateProperties: record.config.privateProperties,
            }).markdown;
      // The note's own timestamps, not the moment it was published: a reader
      // should see when the text was written.
      return { text, createdAt: source?.createdAt, modifiedAt: source?.modifiedAt };
    };

    const result = await runPublicationRefresh({
      handle,
      manifest: record.manifest,
      plan,
      project,
      // After every object rather than at the end: a run that dies mid-way must
      // leave a manifest that still describes the publication, or the next run
      // republishes what already landed.
      persist: async (manifest) => {
        await input.state.savePublication({ ...record, manifest });
      },
      onProgress: (completed, total) => input.onProgress?.(record.publicationId, completed, total),
      signal: input.signal,
    });

    await input.state.savePublication({
      ...record,
      manifest: result.manifest,
      lastError: result.error,
      // An aborted run says nothing about the publication's health, so it does
      // not claim a refresh either.
      lastRefreshedAt: result.aborted ? record.lastRefreshedAt : now(),
    });

    outcomes.push({
      publicationId: record.publicationId,
      planned: plan.length,
      applied: result.applied.length,
      error: result.error,
      skipped: null,
    });
  }

  return outcomes;
}
