/**
 * A publication is its own workspace (Stufe B, S2).
 *
 * The main vault is not shared and not re-keyed: publishing creates a SECOND,
 * self-contained encrypted workspace in a folder of its own, and the projected
 * objects are copied into it. Nothing crosses over - no key, no grant, no
 * policy line. The only link between the two is the derived id, and that is a
 * hash, so a provider hosting both folders cannot tell they belong together.
 *
 * That separation is what makes retraction honest. Revoking a member of the
 * main vault means a re-key; retracting a publication means abandoning a folder
 * that never held a key anything else depended on.
 *
 * Recipients get a group of their own carrying exactly the capabilities the
 * chosen access level implies - read, comment, or suggest. The list is written
 * out rather than derived from a role, because `evaluateWorkspaceAccess` reads
 * `assignment.capabilities`, and a role would round the set to the nearest
 * standard bundle.
 */
import { MAX_INLINE_PLAINTEXT_BYTES } from "./constants.js";
import {
  encodeWorkspaceDocument,
  signWorkspaceDocument,
  workspaceDocumentHash,
  type WorkspaceOperationPayload,
  type WorkspacePolicyPayload,
} from "./documents.js";
import { decodeBase64Exact, sha256Hex, toBase64, utf8Encode } from "./encoding.js";
import { protocolAssert } from "./errors.js";
import { publishWorkspaceBootstrap } from "./governance.js";
import {
  createWorkspaceGroupKeyEpoch,
  createWorkspaceMemberId,
  createWorkspaceObjectId,
  createWorkspaceRevisionId,
  type WorkspaceDevicePlatform,
} from "./identity.js";
import type { WorkspaceObjectStore } from "./objectStore.js";
import { createPersonalWorkspaceBootstrap, personalWorkspaceRuntime, type PersonalWorkspaceRuntime } from "./personal.js";
import { assertCanonicalVaultPath } from "./path.js";
import { createWorkspacePolicySuccessor } from "./policy.js";
import { sealInlinePvo1, type Pvo1Recipient } from "./pvo1.js";
import {
  derivePublicationId,
  publicationStoreFor,
  publishedSliceAccessCapabilities,
  type PublishedSliceConfig,
  type PublishedSliceObjectStore,
} from "./publishedSlices.js";
import { workspaceRecipientGroupIds, type WorkspaceSliceObject } from "./slices.js";

/** What a recipient sees before deciding to join. Deliberately unsigned. */
export interface PublicationCard {
  /** The slice's name, so the recipient recognises what they were handed. */
  name: string;
  mode: PublishedSliceConfig["mode"];
  access: PublishedSliceConfig["access"];
  createdAt: string;
}

/** Where the card lives, in the publication's own namespace. */
export const PUBLICATION_CARD_KEY = ".pvws/publication.pvpub";

export interface CreatePublicationInput {
  /** The MAIN vault. Read only - this function never writes into it. */
  runtime: PersonalWorkspaceRuntime;
  /**
   * Everything the caller decides. The id and the timestamp are deliberately
   * NOT in here: both are determined by this function, and a caller able to
   * pass an id could write to one folder while recording another - the silent
   * orphan the derivation exists to prevent. The stamped config comes back on
   * the handle, so what gets persisted is what was actually written.
   */
  config: Omit<PublishedSliceConfig, "publicationId" | "createdAt">;
  /** The main vault's remote; the publication lands in a folder inside it. */
  store: WorkspaceObjectStore;
  deviceDisplayName: string;
  platform: WorkspaceDevicePlatform;
  minimumClientVersion: string;
  now?: string;
  signal?: AbortSignal;
}

export interface PublicationHandle {
  publicationId: string;
  /** The caller's config with the id and timestamp filled in. Persist THIS. */
  config: PublishedSliceConfig;
  /** The publication's OWN runtime - separate keys, separate owner group. */
  runtime: PersonalWorkspaceRuntime;
  recipientGroupId: string;
  store: PublishedSliceObjectStore;
  card: PublicationCard;
}

/**
 * Creates the publication workspace and writes its bootstrap.
 *
 * `workspaceId` is deliberately set to the derived publication id. The invite
 * code (`PVINVITE1.`) already carries a workspace id, so making the two the
 * same lets a recipient derive `.pvws/publications/<id>/` from the code alone -
 * no second field to hand over, and no way for the two to drift apart.
 * Unlinkability survives it: the id is a hash of the MAIN workspace id and the
 * slice id, and neither is recoverable from it.
 */
export async function createPublication(input: CreatePublicationInput): Promise<PublicationHandle> {
  const { config } = input;
  protocolAssert(config.sliceId.length > 0, "format", "a publication needs a slice");
  const publicationId = derivePublicationId(input.runtime.workspaceId, config.sliceId);
  const now = input.now ?? new Date().toISOString();
  const store = publicationStoreFor(input.store, input.runtime.workspaceId, config.sliceId);

  const bootstrap = await createPersonalWorkspaceBootstrap({
    workspaceId: publicationId,
    ownerDisplayName: config.name,
    deviceDisplayName: input.deviceDisplayName,
    platform: input.platform,
    minimumClientVersion: input.minimumClientVersion,
    now,
  });
  const runtime = personalWorkspaceRuntime(bootstrap);

  const recipientGroupId = createWorkspaceMemberId();
  const recipientKey = await createWorkspaceGroupKeyEpoch({ groupId: recipientGroupId, keyEpoch: 1 });
  const capabilities = publishedSliceAccessCapabilities(config.access);
  const policy = createWorkspacePolicySuccessor({
    current: runtime.policy,
    signer: {
      signer: { algorithm: "Ed25519", signerId: runtime.device.publicIdentity.deviceId, signerKind: "device" },
      privateKey: runtime.device.secrets.signing.privateKey,
    },
    mutate: (draft: WorkspacePolicyPayload) => {
      // No members yet: the group is the door, and it stands empty until
      // somebody is let through. A join adds member and grant together.
      draft.groups.push({
        groupId: recipientGroupId,
        name: "Recipients",
        memberIds: [],
        keyEpoch: 1,
        hpkePublicKey: toBase64(recipientKey.hpke.publicKey),
      });
      draft.assignments.push({
        assignmentId: createWorkspaceMemberId(),
        subjectKind: "group",
        subjectId: recipientGroupId,
        role: "Reader",
        capabilities: [...capabilities],
        scopeKind: "workspace",
        scopeId: null,
      });
    },
  });
  const published: PersonalWorkspaceRuntime = { ...runtime, policy, groupKeys: [...runtime.groupKeys, recipientKey] };

  await publishWorkspaceBootstrap(store, published, input.signal);

  const card: PublicationCard = { name: config.name, mode: config.mode, access: config.access, createdAt: now };
  const bytes = utf8Encode(JSON.stringify(card));
  await store.putImmutable(PUBLICATION_CARD_KEY, bytes, sha256Hex(bytes), { signal: input.signal });

  return { publicationId, config: { ...config, publicationId, createdAt: now }, runtime: published, recipientGroupId, store, card };
}

/**
 * Reads the card back.
 *
 * Kept beside the writer so a format change breaks both at once, and defensive
 * because this is the one document in a publication that carries no signature:
 * it is read BEFORE the reader has any key, so it can only ever be a label.
 */
export function decodePublicationCard(bytes: Uint8Array): PublicationCard | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PublicationCard>;
    if (typeof parsed.name !== "string" || typeof parsed.createdAt !== "string") return null;
    if (parsed.mode !== "exact" && parsed.mode !== "sanitized") return null;
    if (parsed.access !== "read" && parsed.access !== "comment" && parsed.access !== "suggest") return null;
    return { name: parsed.name, mode: parsed.mode, access: parsed.access, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

/**
 * A projected object on its way into a publication (S3c).
 *
 * `text` is what the projection returned, never the source note. The caller
 * owns that step, which is why this type carries no mode: by the time an object
 * reaches here the decision "exact or sanitized" has already been made and
 * applied, and nothing in this file can accidentally publish an unprojected
 * note.
 */
export interface PublishedObjectContent {
  kind?: "publish";
  /** The object id in the SOURCE workspace. Never written out; only mixed into the derived id. */
  sourceObjectId: string;
  path: string;
  text: string;
  /**
   * The revision this publication already holds for the object, when it holds
   * one. Its presence is what turns a create into a write: the protocol refuses
   * a `create` that has parents and a `write` that has none, so a refresh that
   * forgot the parent would not produce a wrong revision - it would produce an
   * operation no recipient accepts.
   */
  parentRevisionId?: string | null;
  createdAt?: string;
  modifiedAt?: string;
}

/**
 * An object leaving a publication (S4).
 *
 * Nothing is unsent - the recipient may have synced the frame long ago. What a
 * tombstone does is stop the object being part of the publication going
 * forward, so a client that syncs it removes it and a client syncing for the
 * first time never sees it. The plan says this out loud (SS 4) rather than
 * implying that retraction reaches back.
 */
export interface RetractedObject {
  kind: "retract";
  sourceObjectId: string;
  /** The publication revision being retired. A delete without a parent is not a valid operation. */
  parentRevisionId: string;
}

export type PublicationChange = PublishedObjectContent | RetractedObject;

export interface PublishSliceContentInput {
  handle: PublicationHandle;
  objects: readonly PublicationChange[];
  /** Continues an existing device chain when republishing; a fresh publication starts at 1. */
  fromSequence?: number;
  previousOperationHash?: string | null;
  now?: string;
  signal?: AbortSignal;
}

interface PublishedObjectWriteBase {
  sourceObjectId: string;
  objectId: string;
  operationRemoteKey: string;
  operationHash: string;
  sequence: number;
}

export interface PublishedObjectPublishWrite extends PublishedObjectWriteBase {
  operation: "create" | "write";
  revisionId: string;
  objectRemoteKey: string;
}

export interface PublishedObjectRetractWrite extends PublishedObjectWriteBase {
  operation: "delete";
  /** A delete carries no revision of its own, and seals nothing - so there is no frame to point at. */
  revisionId: null;
  objectRemoteKey: null;
}

/**
 * A union rather than two nullable fields, so that one check narrows both.
 * `write.revisionId` being a `string | null` everywhere would push a cast onto
 * every caller that reads a published frame back; keyed on the operation, the
 * compiler knows a publish has a revision and a retraction does not.
 */
export type PublishedObjectWrite = PublishedObjectPublishWrite | PublishedObjectRetractWrite;

export interface PublishSliceContentResult {
  writes: PublishedObjectWrite[];
  lastSequence: number;
  lastOperationHash: string | null;
}

/**
 * The object id a source object carries INSIDE a publication.
 *
 * Two properties, and the publication would be wrong without either one:
 *
 * - Publishing the same note into the same publication twice yields the same
 *   id, so the second write is a revision of one object rather than a second
 *   copy of it.
 * - The same note published into two different slices yields two different
 *   ids, so a recipient who holds both cannot line them up and learn which
 *   slices overlap. Carrying the source id across would have given that away
 *   for free - and the source id is exactly the stable handle that makes such
 *   a correlation trivial.
 *
 * Derived rather than stored, the same technique and for the same reason as
 * `derivePublicationId`: there is nothing to keep in sync, so there is nothing
 * that can fall out of sync.
 */
export function derivePublishedObjectId(publicationId: string, sourceObjectId: string): string {
  return sha256Hex(utf8Encode(`plainva.publication.object:${publicationId}:${sourceObjectId}`)).slice(0, 32);
}

/** A caller timestamp that is not canonical is a bug in the caller, not a reason to write a broken object. */
function canonicalTimestamp(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

/**
 * Writes the projected objects into the publication workspace.
 *
 * Until this runs, a publication is a workspace with a policy, a genesis and a
 * label card - and no content at all. This is the step that makes a publication
 * readable.
 *
 * Each object is written the way every other workspace object is written: a
 * sealed PVO1 frame plus a signed operation that names it. Nothing here is a
 * special "publication format", and that is the point - a recipient's client
 * reads a publication with the code it already has.
 *
 * Two decisions worth keeping:
 *
 * - Recipients come from the publication's POLICY, not from the handle's
 *   `recipientGroupId`. That field names the door recipients come through; the
 *   policy also grants the publisher's own owner group `content.read`, and
 *   sealing only to the recipient group would lock the publisher out of what
 *   they just published. `workspaceRecipientGroupIds` is the authoritative
 *   recipient set everywhere else in the protocol, so it is the authoritative
 *   set here.
 * - Objects are sealed inline. The chunked frame exists for files above 8 MiB,
 *   a size no Markdown note reaches; rather than carry a second write path for
 *   a case that does not occur, an oversized object is refused by name. A
 *   refusal the caller can read beats half a publication.
 */
export async function publishSliceObjectContent(input: PublishSliceContentInput): Promise<PublishSliceContentResult> {
  const runtime = input.handle.runtime;
  const now = canonicalTimestamp(input.now, new Date().toISOString());
  const policyHash = workspaceDocumentHash(runtime.policy);
  const deviceId = runtime.device.publicIdentity.deviceId;

  let sequence = input.fromSequence ?? 1;
  let previous = input.previousOperationHash ?? null;
  protocolAssert(Number.isInteger(sequence) && sequence >= 1, "integrity", "published content sequence must be a positive integer");
  protocolAssert(sequence === 1 ? previous === null : previous !== null, "integrity", "published content device chain is inconsistent");

  const seen = new Set<string>();
  const writes: PublishedObjectWrite[] = [];

  for (const object of input.objects) {
    const objectId = derivePublishedObjectId(input.handle.publicationId, object.sourceObjectId);
    // Two source objects deriving the same publication id would mean one
    // silently overwriting the other - the caller handed us the same object
    // twice, and a publication missing a note is worse than a loud failure.
    protocolAssert(!seen.has(objectId), "integrity", "the same source object was published twice in one run");
    seen.add(objectId);

    if (object.kind === "retract") {
      // No frame: a retraction seals nothing. The operation alone is what tells
      // a syncing recipient the object has left the publication.
      const payload: WorkspaceOperationPayload = {
        operationId: createWorkspaceObjectId(),
        deviceId,
        memberId: runtime.memberId,
        sequence,
        previousDeviceOperationHash: previous,
        policyHash,
        capability: "content.delete",
        operation: "delete",
        objectId,
        revisionId: null,
        parentRevisionIds: [object.parentRevisionId],
        payloadHash: null,
        createdAt: now,
      };
      const operation = signWorkspaceDocument(
        { kind: "operation", protocolVersion: 1, workspaceId: runtime.workspaceId, payload },
        { algorithm: "Ed25519", signerId: deviceId, signerKind: "device" },
        runtime.device.secrets.signing.privateKey,
      );
      const operationHash = workspaceDocumentHash(operation);
      const operationRemoteKey = `.pvws/operations/${deviceId}/${sequence}-${operationHash}.pvop`;
      await input.handle.store.putImmutable(operationRemoteKey, encodeWorkspaceDocument(operation), operationHash, { signal: input.signal });
      writes.push({
        sourceObjectId: object.sourceObjectId, objectId, operation: "delete", revisionId: null,
        objectRemoteKey: null, operationRemoteKey, operationHash, sequence,
      });
      previous = operationHash;
      sequence += 1;
      continue;
    }

    const plaintext = utf8Encode(object.text);
    protocolAssert(plaintext.length <= MAX_INLINE_PLAINTEXT_BYTES, "bounds", "published note exceeds the inline object limit");

    // Per object rather than once: in a publication every assignment is
    // workspace-scoped, so the answer is the same each time - but it stops
    // being the same the moment a policy gains a slice scope, and the loop
    // should still be right then.
    // A non-canonical path would seal fine and then fail to line up with
    // anything a reader looks for. Better to refuse it here.
    const path = assertCanonicalVaultPath(object.path);
    const accessObject: WorkspaceSliceObject = { objectId, path, contentKind: "text" };
    const recipientGroupIds = workspaceRecipientGroupIds(runtime.policy.payload, accessObject);
    const recipients: Pvo1Recipient[] = recipientGroupIds.map((groupId) => {
      const group = runtime.policy.payload.groups.find((entry) => entry.groupId === groupId);
      protocolAssert(!!group, "integrity", "recipient group is missing from the publication policy");
      return { groupId, keyEpoch: group.keyEpoch, publicKey: decodeBase64Exact(group.hpkePublicKey, 32, "recipient group public key") };
    });
    protocolAssert(recipients.length > 0, "authorization", "the published object would be unreadable because no group has content.read");

    const revisionId = createWorkspaceRevisionId();
    const createdAt = canonicalTimestamp(object.createdAt, now);
    const objectBytes = await sealInlinePvo1({
      workspaceId: runtime.workspaceId,
      objectId,
      revisionId,
      recipients,
      metadata: {
        path,
        mime: "text/markdown",
        parentObjectId: null,
        createdAt,
        modifiedAt: canonicalTimestamp(object.modifiedAt, createdAt),
        contentKind: "text",
      },
      plaintext,
    });
    const objectHash = sha256Hex(objectBytes);

    const payload: WorkspaceOperationPayload = {
      operationId: createWorkspaceObjectId(),
      deviceId,
      memberId: runtime.memberId,
      sequence,
      previousDeviceOperationHash: previous,
      policyHash,
      capability: object.parentRevisionId ? "content.write" : "content.create",
      operation: object.parentRevisionId ? "write" : "create",
      objectId,
      revisionId,
      parentRevisionIds: object.parentRevisionId ? [object.parentRevisionId] : [],
      payloadHash: objectHash,
      createdAt: now,
    };
    const operation = signWorkspaceDocument(
      { kind: "operation", protocolVersion: 1, workspaceId: runtime.workspaceId, payload },
      { algorithm: "Ed25519", signerId: deviceId, signerKind: "device" },
      runtime.device.secrets.signing.privateKey,
    );
    const operationHash = workspaceDocumentHash(operation);

    const objectRemoteKey = `.pvws/objects/${objectId}/${objectHash}.pvobj`;
    const operationRemoteKey = `.pvws/operations/${deviceId}/${sequence}-${operationHash}.pvop`;
    // The frame first: an operation naming an object that is not there yet
    // would be a dangling pointer for anyone syncing mid-write, while a frame
    // nobody points at is merely unused.
    await input.handle.store.putImmutable(objectRemoteKey, objectBytes, objectHash, { signal: input.signal });
    await input.handle.store.putImmutable(operationRemoteKey, encodeWorkspaceDocument(operation), operationHash, { signal: input.signal });

    writes.push({
      sourceObjectId: object.sourceObjectId, objectId, operation: object.parentRevisionId ? "write" : "create",
      revisionId, objectRemoteKey, operationRemoteKey, operationHash, sequence,
    });
    previous = operationHash;
    sequence += 1;
  }

  return { writes, lastSequence: sequence - 1, lastOperationHash: previous };
}

/**
 * One object as a publication currently holds it (S4).
 *
 * Two revision ids, and both are load-bearing for a different reason:
 * `sourceRevisionId` answers "has the note changed since we published it", and
 * `publishedRevisionId` is the parent a follow-up write or a tombstone has to
 * name. Neither can be recovered from the publication folder without the key
 * and a download of every frame, which is why the publisher keeps them.
 */
export interface PublishedObjectRecord {
  sourceObjectId: string;
  path: string;
  sourceRevisionId: string;
  publishedRevisionId: string;
}

/**
 * What the publisher remembers about one publication.
 *
 * This is the only durable state a refresh needs. It is deliberately not a job
 * with per-item completion flags like the rekey cursor: a refresh plan is
 * *derivable* from the manifest and the current slice, so there is no second
 * copy of the truth that can fall out of step with the first. Advance the
 * manifest as each object lands and a resumed run simply re-plans - anything
 * already published is no longer in the plan.
 */
export interface PublicationManifest {
  publicationId: string;
  /** The next sequence number in the publishing device's chain inside the publication. */
  sequence: number;
  previousOperationHash: string | null;
  objects: PublishedObjectRecord[];
}

export function emptyPublicationManifest(publicationId: string): PublicationManifest {
  return { publicationId, sequence: 1, previousOperationHash: null, objects: [] };
}

/** A source object as the slice currently sees it. Cheap: no file is read to answer this. */
export interface PublicationSourceObject {
  sourceObjectId: string;
  path: string;
  sourceRevisionId: string;
}

interface PublicationRefreshItemBase {
  sourceObjectId: string;
  path: string;
}

export interface PublicationPublishItem extends PublicationRefreshItemBase {
  action: "publish" | "republish";
  sourceRevisionId: string;
  /** The publication revision to build on: null only for a first publish. */
  parentRevisionId: string | null;
}

export interface PublicationRetractItem extends PublicationRefreshItemBase {
  action: "retract";
  sourceRevisionId: null;
  /** Never null: the protocol refuses a delete that names no parent revision. */
  parentRevisionId: string;
  /** The path the object had when it was published. */
  path: string;
}

/**
 * A union, so the two rules that would otherwise live only in a runtime assert
 * are visible in the type: a retraction always names the revision it retires,
 * and a publish always knows which source revision it reflects.
 */
export type PublicationRefreshItem = PublicationPublishItem | PublicationRetractItem;

/**
 * Diffs what a publication holds against what the slice now covers.
 *
 * Pure on purpose, and it deliberately asks only for revision ids: deciding
 * *whether* a note needs republishing must not cost a file read and a
 * projection for every note in the slice. The caller materializes text only for
 * the items that come back.
 *
 * An object that fell out of the slice - the rule stopped matching, the note
 * moved, it was deleted (finding B5) - comes back as a retraction, because the
 * silent alternative is a publication that keeps handing out a note whose
 * author believes they took it back.
 */
export function planPublicationRefresh(input: {
  manifest: PublicationManifest;
  covered: readonly PublicationSourceObject[];
}): PublicationRefreshItem[] {
  const held = new Map(input.manifest.objects.map((record) => [record.sourceObjectId, record]));
  const items: PublicationRefreshItem[] = [];
  const seen = new Set<string>();

  for (const object of input.covered) {
    protocolAssert(!seen.has(object.sourceObjectId), "integrity", "the same source object appears twice in the slice");
    seen.add(object.sourceObjectId);
    const record = held.get(object.sourceObjectId);
    if (!record) {
      items.push({
        action: "publish",
        sourceObjectId: object.sourceObjectId,
        path: object.path,
        sourceRevisionId: object.sourceRevisionId,
        parentRevisionId: null,
      });
      continue;
    }
    // A move is a change even when the text did not move with it: the path is
    // sealed into the frame metadata, so a stale path leaves the recipient with
    // the note filed where it no longer belongs.
    if (record.sourceRevisionId !== object.sourceRevisionId || record.path !== object.path) {
      items.push({
        action: "republish",
        sourceObjectId: object.sourceObjectId,
        path: object.path,
        sourceRevisionId: object.sourceRevisionId,
        parentRevisionId: record.publishedRevisionId,
      });
    }
  }

  for (const record of input.manifest.objects) {
    if (seen.has(record.sourceObjectId)) continue;
    items.push({
      action: "retract",
      sourceObjectId: record.sourceObjectId,
      path: record.path,
      sourceRevisionId: null,
      parentRevisionId: record.publishedRevisionId,
    });
  }
  return items;
}

/** The projected text for one item, produced by the caller only for the items the plan named. */
export interface PublicationRefreshProjection {
  text: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface PublicationRefreshResult {
  manifest: PublicationManifest;
  applied: PublishedObjectWrite[];
  /** The item the run stopped on, if it stopped early. */
  stoppedAt: PublicationRefreshItem | null;
  error: string | null;
  aborted: boolean;
}

export interface RunPublicationRefreshInput {
  handle: PublicationHandle;
  manifest: PublicationManifest;
  plan: readonly PublicationRefreshItem[];
  /** Reads and projects one object. Called only for publish and republish items. */
  project: (item: PublicationRefreshItem) => Promise<PublicationRefreshProjection>;
  /** Durability hook: called with the advanced manifest after each object lands. */
  persist?: (manifest: PublicationManifest) => Promise<void>;
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Applies a refresh plan, one object at a time, advancing the manifest as it goes.
 *
 * The per-object granularity is the whole point. A provider outage halfway
 * through does leave a publication with some notes refreshed and some not -
 * that is unavoidable against an object store, and pretending otherwise would
 * be the dishonest part. What it must never leave is a publication the manifest
 * no longer describes, because then the next run would either skip an object it
 * never wrote or write a second copy of one it did. So the manifest advances
 * after each object, and a resumed run re-plans against it and continues.
 *
 * It stops rather than skips: an object that will not publish is reported with
 * its reason and the remaining items stay in the plan. Carrying on past a
 * failure would report a refresh as done while a note quietly kept its old text.
 */
export async function runPublicationRefresh(input: RunPublicationRefreshInput): Promise<PublicationRefreshResult> {
  let manifest = input.manifest;
  const applied: PublishedObjectWrite[] = [];
  const total = input.plan.length;

  for (const item of input.plan) {
    if (input.signal?.aborted) return { manifest, applied, stoppedAt: item, error: null, aborted: true };
    try {
      const change: PublicationChange =
        item.action === "retract"
          ? { kind: "retract", sourceObjectId: item.sourceObjectId, parentRevisionId: item.parentRevisionId }
          : {
              ...(await input.project(item)),
              sourceObjectId: item.sourceObjectId,
              path: item.path,
              parentRevisionId: item.parentRevisionId,
            };

      const result = await publishSliceObjectContent({
        handle: input.handle,
        objects: [change],
        fromSequence: manifest.sequence,
        previousOperationHash: manifest.previousOperationHash,
        signal: input.signal,
      });
      const write = result.writes[0]!;
      applied.push(write);

      const objects = manifest.objects.filter((record) => record.sourceObjectId !== item.sourceObjectId);
      // Keyed on what was WRITTEN rather than on what was planned: the record
      // has to describe the operation that actually landed in the publication.
      if (item.action !== "retract" && write.operation !== "delete") {
        objects.push({
          sourceObjectId: item.sourceObjectId,
          path: item.path,
          sourceRevisionId: item.sourceRevisionId,
          publishedRevisionId: write.revisionId,
        });
      }
      manifest = {
        ...manifest,
        sequence: result.lastSequence + 1,
        previousOperationHash: result.lastOperationHash,
        objects,
      };
      await input.persist?.(manifest);
      input.onProgress?.(applied.length, total);
    } catch (error) {
      if (input.signal?.aborted) return { manifest, applied, stoppedAt: item, error: null, aborted: true };
      const message = error instanceof Error ? error.message : String(error);
      return { manifest, applied, stoppedAt: item, error: message.slice(0, 1000), aborted: false };
    }
  }
  return { manifest, applied, stoppedAt: null, error: null, aborted: false };
}
