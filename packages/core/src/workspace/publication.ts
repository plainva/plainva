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
import type { WorkspacePolicyPayload } from "./documents.js";
import { sha256Hex, toBase64, utf8Encode } from "./encoding.js";
import { protocolAssert } from "./errors.js";
import { publishWorkspaceBootstrap } from "./governance.js";
import { createWorkspaceGroupKeyEpoch, createWorkspaceMemberId, type WorkspaceDevicePlatform } from "./identity.js";
import type { WorkspaceObjectStore } from "./objectStore.js";
import { createPersonalWorkspaceBootstrap, personalWorkspaceRuntime, type PersonalWorkspaceRuntime } from "./personal.js";
import { createWorkspacePolicySuccessor } from "./policy.js";
import {
  derivePublicationId,
  publicationStoreFor,
  publishedSliceAccessCapabilities,
  type PublishedSliceConfig,
  type PublishedSliceObjectStore,
} from "./publishedSlices.js";

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
