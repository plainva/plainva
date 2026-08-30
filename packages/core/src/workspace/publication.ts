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
  /** The object id in the SOURCE workspace. Never written out; only mixed into the derived id. */
  sourceObjectId: string;
  path: string;
  text: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface PublishSliceContentInput {
  handle: PublicationHandle;
  objects: readonly PublishedObjectContent[];
  /** Continues an existing device chain when republishing; a fresh publication starts at 1. */
  fromSequence?: number;
  previousOperationHash?: string | null;
  now?: string;
  signal?: AbortSignal;
}

export interface PublishedObjectWrite {
  sourceObjectId: string;
  objectId: string;
  revisionId: string;
  objectRemoteKey: string;
  operationRemoteKey: string;
  operationHash: string;
  sequence: number;
}

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
      capability: "content.create",
      operation: "create",
      objectId,
      revisionId,
      parentRevisionIds: [],
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

    writes.push({ sourceObjectId: object.sourceObjectId, objectId, revisionId, objectRemoteKey, operationRemoteKey, operationHash, sequence });
    previous = operationHash;
    sequence += 1;
  }

  return { writes, lastSequence: sequence - 1, lastOperationHash: previous };
}
