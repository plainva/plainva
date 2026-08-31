import { describe, expect, it } from "vitest";
import {
  FakeWorkspaceObjectStore,
  MemoryWorkspaceStateStore,
  PublishedSliceObjectStore,
  createPersonalWorkspaceBootstrap,
  createPublication,
  collectPublicationComments,
  createWorkspacePairingRequest,
  approveWorkspacePairing,
  buildCommentAnchor,
  acceptWorkspacePairing,
  derivePublishedObjectId,
  decodeBase64Exact,
  decodeWorkspaceInvite,
  decodePublicationCard,
  derivePublicationId,
  emptyPublicationManifest,
  applyWorkspaceGovernanceUpdate,
  evaluateWorkspaceAccess,
  openPvo1Frame,
  parsePvo1Frame,
  parseWorkspaceDocument,
  personalWorkspaceRuntime,
  planPublicationRefresh,
  prepareWorkspaceComment,
  publishWorkspaceComment,
  publicationRecipientGroupId,
  publicationRecipients,
  publicationRecipientStoreFor,
  publicationStoreFor,
  invitePublicationRecipient,
  planPublicationTeardown,
  revokePublicationRecipient,
  publishSliceObjectContent,
  sealInlinePvo1,
  publishedSliceAccessCapabilities,
  refreshWorkspacePublications,
  runPublicationRefresh,
  workspaceDocumentHash,
  workspaceRecipientGroupIds,
  type PersonalWorkspaceRuntime,
  type PublicationManifest,
  type WorkspaceCommentAnchor,
  type PublicationWriteHandle,
  type PublishedSliceConfig,
  type WorkspaceObjectRecord,
  type WorkspaceObjectStore,
  type WorkspacePolicySlice,
  type WorkspacePublicationRecord,
} from "../src/index.js";

/**
 * The publication as a real thing (Stufe B).
 *
 * Until S1 the publication existed as primitives with no caller: a store that
 * namespaces objects, a capability mapping, a Markdown projection. What was
 * missing is the identity that ties them together - the folder a publication
 * lives in, and the single place that derives it.
 */

const WORKSPACE = "a1".repeat(16);
const OTHER_WORKSPACE = "b2".repeat(16);
const SLICE = "slice-quarterly-review";

describe("publication identity", () => {
  it("derives the same folder for the same pair, every time", () => {
    // A refresh has to find the publication it wrote last week. Nothing is
    // stored, so stability IS the lookup - if this drifted, every refresh would
    // silently start a second publication beside the one recipients joined.
    expect(derivePublicationId(WORKSPACE, SLICE)).toBe(derivePublicationId(WORKSPACE, SLICE));
  });

  it("gives two slices of one vault two folders", () => {
    expect(derivePublicationId(WORKSPACE, "slice-a")).not.toBe(derivePublicationId(WORKSPACE, "slice-b"));
  });

  it("gives the same slice id in two vaults two folders", () => {
    // Slice ids are not globally unique - two vaults can both hold a slice
    // called "slice-team". Deriving from the slice alone would put both under
    // one folder on a shared provider.
    expect(derivePublicationId(WORKSPACE, SLICE)).not.toBe(derivePublicationId(OTHER_WORKSPACE, SLICE));
  });

  it("carries neither the vault nor the slice in the folder name", () => {
    // This is the whole reason the id is derived rather than reused. The folder
    // name is visible to the provider and to every recipient; the slice id
    // would tell them which internal row of the main vault they are looking at.
    const id = derivePublicationId(WORKSPACE, SLICE);
    expect(id).not.toContain(SLICE);
    expect(id).not.toContain(WORKSPACE);
    expect(WORKSPACE).not.toContain(id);
  });

  it("produces an id the object store accepts", () => {
    // The store validates the id itself and throws on a bad one. Deriving an id
    // the store then rejects would turn a publish into a crash at the last step.
    expect(() => new PublishedSliceObjectStore(new FakeWorkspaceObjectStore(), derivePublicationId(WORKSPACE, SLICE))).not.toThrow();
    expect(derivePublicationId(WORKSPACE, SLICE)).toMatch(/^[a-z0-9][a-z0-9-]{7,127}$/);
  });

  it("refuses to derive from nothing", () => {
    expect(() => derivePublicationId("", SLICE)).toThrow();
    expect(() => derivePublicationId(WORKSPACE, "")).toThrow();
  });
});

describe("publicationStoreFor", () => {
  it("writes into the derived folder and reads back through the local name", async () => {
    const root = new FakeWorkspaceObjectStore();
    const store = publicationStoreFor(root, WORKSPACE, SLICE);
    const bytes = new TextEncoder().encode("sealed");
    const { sha256Hex } = await import("../src/workspace/encoding.js");
    await store.putImmutable(".pvws/genesis.pvgen", bytes, sha256Hex(bytes));

    const remote = (await root.list(`.pvws/publications/${derivePublicationId(WORKSPACE, SLICE)}/`)).items;
    expect(remote.map((entry) => entry.key)).toEqual([`.pvws/publications/${derivePublicationId(WORKSPACE, SLICE)}/genesis.pvgen`]);
    // The publication workspace sees a plain `.pvws/` - that is what lets the
    // untouched join and sync code run inside it without knowing it is nested.
    expect((await store.list(".pvws/")).items.map((entry) => entry.key)).toEqual([".pvws/genesis.pvgen"]);
  });

  it("keeps two publications of one vault apart", async () => {
    const root = new FakeWorkspaceObjectStore();
    const { sha256Hex } = await import("../src/workspace/encoding.js");
    for (const [slice, body] of [["slice-a", "first"], ["slice-b", "second"]] as const) {
      const bytes = new TextEncoder().encode(body);
      await publicationStoreFor(root, WORKSPACE, slice).putImmutable(".pvws/genesis.pvgen", bytes, sha256Hex(bytes));
    }
    expect(new TextDecoder().decode(await publicationStoreFor(root, WORKSPACE, "slice-a").get(".pvws/genesis.pvgen") ?? new Uint8Array())).toBe("first");
    expect(new TextDecoder().decode(await publicationStoreFor(root, WORKSPACE, "slice-b").get(".pvws/genesis.pvgen") ?? new Uint8Array())).toBe("second");
  });
});

/**
 * Creating one (S2).
 *
 * A publication is its own workspace: separate genesis, separate keys, separate
 * owner. Nothing crosses over from the main vault, and these pin exactly that -
 * because the moment something did, retracting a publication would stop being
 * an act of abandoning a folder and start being a re-key of the vault itself.
 */
type PublicationDraft = Omit<PublishedSliceConfig, "publicationId" | "createdAt">;

async function makePublication(over: Partial<PublicationDraft> = {}) {
  const outer = new FakeWorkspaceObjectStore();
  const main = personalWorkspaceRuntime(
    await createPersonalWorkspaceBootstrap({
      workspaceId: WORKSPACE,
      ownerDisplayName: "Owner",
      deviceDisplayName: "Desktop",
      platform: "desktop",
      minimumClientVersion: "0.5.0",
      now: "2026-08-26T08:00:00.000Z",
    }),
  );
  const config: PublicationDraft = {
    sliceId: SLICE,
    name: "Quarterly review",
    mode: "sanitized",
    access: "read",
    provider: "webdav",
    propertyAllowlist: null,
    privateProperties: [],
    ...over,
  };
  const handle = await createPublication({
    runtime: main,
    config,
    store: outer,
    deviceDisplayName: "Desktop",
    platform: "desktop",
    minimumClientVersion: "0.5.0",
    now: "2026-08-26T09:00:00.000Z",
  });
  // The store rejects a bare `.pvws` prefix - a key needs a segment after it -
  // so the publication side is listed by its own folder, and the main vault's
  // namespace is checked by asking for its documents directly below.
  const keys = (await outer.list(".pvws/publications")).items.map((item) => item.key);
  return { outer, main, handle, keys };
}

describe("createPublication", () => {
  it("puts a genesis in the publication folder", async () => {
    // The one failure mode that would be invisible: every detect path in both
    // shells probes `.pvws/genesis.pvgen`, so a folder carrying only policies
    // and grants is a folder nothing ever offers to open. This is why the
    // bootstrap was lifted out of the migration rather than reusing the
    // governance update, which writes no genesis.
    const { handle, keys } = await makePublication();
    expect(keys).toContain(`.pvws/publications/${handle.publicationId}/genesis.pvgen`);
    expect(keys.some((key) => key.includes(`/publications/${handle.publicationId}/policies/`))).toBe(true);
  });

  it("leaves the main vault's own namespace alone", async () => {
    // Publishing must not touch the vault it publishes FROM. A genesis or a
    // policy at the outer root would mean the act of sharing rewrote the
    // workspace everyone else is already synced against.
    const { outer, keys } = await makePublication();
    expect(await outer.get(".pvws/genesis.pvgen")).toBeNull();
    expect((await outer.list(".pvws/policies")).items).toEqual([]);
    expect((await outer.list(".pvws/grants")).items).toEqual([]);
    // And everything that WAS written sits below the publication folder.
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.startsWith(".pvws/publications/"))).toBe(true);
  });

  it("names the workspace after the folder it lives in", async () => {
    // The invite code carries a workspace id and nothing else. Making the two
    // identical is what lets a recipient derive `.pvws/publications/<id>/` from
    // the code alone - no second field to hand over, and no way for the two to
    // drift apart. Unlinkability survives it: the id is a hash.
    const { handle } = await makePublication();
    expect(handle.publicationId).toBe(derivePublicationId(WORKSPACE, SLICE));
    expect(handle.runtime.workspaceId).toBe(handle.publicationId);
  });

  it("gives recipients exactly the capabilities their access level implies", async () => {
    // Written out rather than derived from a role: `evaluateWorkspaceAccess`
    // reads `assignment.capabilities` and never re-derives from `role`, so a
    // role would round the set to the nearest standard bundle - and "comment"
    // and "suggest" are not standard bundles.
    for (const access of ["read", "comment", "suggest"] as const) {
      const { handle } = await makePublication({ access });
      const assignment = handle.runtime.policy.payload.assignments.find((entry) => entry.subjectId === handle.recipientGroupId);
      expect(assignment?.capabilities).toEqual([...publishedSliceAccessCapabilities(access)]);
      expect(assignment?.scopeKind).toBe("workspace");
    }
  });

  it("opens the door without letting anyone through it yet", async () => {
    // The group exists so a join has something to add a member to. Seeding it
    // with the publisher would hand every later recipient a key epoch that a
    // member of the MAIN vault also holds.
    const { handle, main } = await makePublication();
    const group = handle.runtime.policy.payload.groups.find((entry) => entry.groupId === handle.recipientGroupId);
    expect(group?.memberIds).toEqual([]);
    expect(handle.runtime.policy.payload.groups.some((entry) => main.policy.payload.groups.some((own) => own.groupId === entry.groupId))).toBe(false);
  });

  it("shares no key with the vault it came from", async () => {
    // The whole reason a publication is a separate workspace. If one key were
    // shared, retracting a publication would mean re-keying the main vault.
    const { handle, main } = await makePublication();
    const mine = new Set(main.groupKeys.map((key) => key.groupId));
    expect(handle.runtime.groupKeys.some((key) => mine.has(key.groupId))).toBe(false);
    expect(handle.runtime.genesis.payload).not.toEqual(main.genesis.payload);
  });

  it("hands back a config stamped with the folder it wrote to", async () => {
    // The caller cannot pass an id, so it cannot record one that differs from
    // the folder - the silent orphan is unrepresentable rather than guarded
    // against. What comes back is what was written.
    const { handle } = await makePublication();
    expect(handle.config.publicationId).toBe(handle.publicationId);
    expect(handle.config.createdAt).toBe("2026-08-26T09:00:00.000Z");
    expect(handle.config.sliceId).toBe(SLICE);
  });

  it("leaves a card a recipient can read before they hold any key", async () => {
    const { handle, outer } = await makePublication({ name: "Quarterly review", access: "comment" });
    const bytes = await outer.get(`.pvws/publications/${handle.publicationId}/publication.pvpub`);
    expect(bytes).not.toBeNull();
    const card = decodePublicationCard(bytes!);
    expect(card).toEqual({ name: "Quarterly review", mode: "sanitized", access: "comment", createdAt: "2026-08-26T09:00:00.000Z" });
  });

  it("treats an unreadable card as no card", () => {
    // The one document in a publication that carries no signature, because it
    // is read BEFORE the reader has a key. So it can only ever be a label, and
    // anything malformed has to come back as "nothing" rather than as a crash.
    expect(decodePublicationCard(new TextEncoder().encode("not json"))).toBeNull();
    expect(decodePublicationCard(new TextEncoder().encode(JSON.stringify({ name: "x", mode: "live", access: "read", createdAt: "t" })))).toBeNull();
    expect(decodePublicationCard(new TextEncoder().encode(JSON.stringify({ name: "x", mode: "exact", access: "admin", createdAt: "t" })))).toBeNull();
  });
});

/**
 * Putting content into one (S3c).
 *
 * Everything above builds the container: a folder, a genesis, a policy, a card.
 * None of it is readable, because none of it holds a note. This is the step
 * that makes a publication a publication - and the two things worth pinning are
 * the two that are silent when wrong: which id a note carries inside the
 * publication, and who the note is sealed to.
 */
describe("publishSliceObjectContent", () => {
  const NOTE = { sourceObjectId: "c3".repeat(16), path: "Projects/Q3.md", text: "# Q3\n\nShipped." };

  it("derives a stable id, so republishing revises rather than duplicates", () => {
    // A refresh republishes the same note. If the id moved, the recipient would
    // end up with two copies of one note and no way to tell which is current.
    const id = derivePublishedObjectId("pub-a", NOTE.sourceObjectId);
    expect(derivePublishedObjectId("pub-a", NOTE.sourceObjectId)).toBe(id);
  });

  it("gives the same note two ids in two publications", () => {
    // The correlation this prevents is concrete: a recipient of two slices that
    // both contain one note would otherwise see one id twice and learn that the
    // slices overlap. Carrying the source id across would have handed that over
    // for free, because the source id is exactly the stable handle.
    expect(derivePublishedObjectId("pub-a", NOTE.sourceObjectId)).not.toBe(derivePublishedObjectId("pub-b", NOTE.sourceObjectId));
  });

  it("keeps the source id out of the derived one", () => {
    const id = derivePublishedObjectId("pub-a", NOTE.sourceObjectId);
    expect(id).not.toContain(NOTE.sourceObjectId);
    expect(NOTE.sourceObjectId).not.toContain(id);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("writes a frame and an operation into the publication folder", async () => {
    const { handle, outer } = await makePublication();
    const result = await publishSliceObjectContent({ handle, objects: [NOTE], now: "2026-08-26T10:00:00.000Z" });

    expect(result.writes).toHaveLength(1);
    const write = result.writes[0];
    expect(write.objectId).toBe(derivePublishedObjectId(handle.publicationId, NOTE.sourceObjectId));

    // The publication workspace sees a plain `.pvws/`; the outer vault sees it
    // nested. Both views have to agree, or a recipient syncing the folder finds
    // a frame the operation cannot name.
    const nested = (key: string) => key.replace(".pvws/", `.pvws/publications/${handle.publicationId}/`);
    const keys = (await outer.list(".pvws/publications")).items.map((item) => item.key);
    expect(keys).toContain(nested(write.objectRemoteKey!));
    expect(keys).toContain(nested(write.operationRemoteKey));
    expect(write.operationRemoteKey.endsWith(`1-${write.operationHash}.pvop`)).toBe(true);
  });

  it("leaves the vault it published FROM untouched", async () => {
    // The same guarantee `createPublication` makes, at the step that actually
    // moves content: publishing writes into the publication and nowhere else.
    const { handle, outer } = await makePublication();
    await publishSliceObjectContent({ handle, objects: [NOTE] });
    expect(await outer.get(".pvws/genesis.pvgen")).toBeNull();
    expect((await outer.list(".pvws/objects")).items).toEqual([]);
    expect((await outer.list(".pvws/operations")).items).toEqual([]);
  });

  it("seals to every group the policy grants read, not just the recipient group", async () => {
    // The load-bearing one. `handle.recipientGroupId` names the door recipients
    // come through; the policy ALSO grants the publisher's own owner group
    // `content.read`. Sealing to the recipient group alone would lock the
    // publisher out of what they had just published - and they would not find
    // out until they opened the publication to check it.
    const { handle } = await makePublication();
    const result = await publishSliceObjectContent({ handle, objects: [NOTE] });
    const bytes = await handle.store.get(result.writes[0].objectRemoteKey!);
    const groups = parsePvo1Frame(bytes!).envelopes.map((envelope) => envelope.groupId).sort();
    expect(groups).toContain(handle.recipientGroupId);
    expect(groups).toContain(handle.runtime.ownerGroup.groupId);
    expect(groups).toEqual([...workspaceRecipientGroupIds(handle.runtime.policy.payload, { objectId: result.writes[0].objectId, path: NOTE.path, contentKind: "text" })].sort());
  });

  it("stays readable to the publisher's own key", async () => {
    // The same claim from the other side, and the one a user would notice: open
    // the frame with the key the publishing device actually holds.
    const { handle } = await makePublication();
    const result = await publishSliceObjectContent({ handle, objects: [NOTE] });
    const bytes = await handle.store.get(result.writes[0].objectRemoteKey!);
    const owner = handle.runtime.ownerGroup;
    const opened = await openPvo1Frame(bytes!, [{ groupId: owner.groupId, keyEpoch: owner.keyEpoch, privateKey: owner.hpke.privateKey }]);
    expect(new TextDecoder().decode(opened.plaintext!)).toBe(NOTE.text);
    expect(opened.metadata.path).toBe(NOTE.path);
    expect(opened.metadata.mime).toBe("text/markdown");
  });

  it("publishes what the projection returned, not the source note", async () => {
    // This function never sees the source text, and that is deliberate: the
    // "exact or sanitized" decision is made and applied before an object gets
    // here, so nothing in this file can publish an unprojected note.
    const { handle } = await makePublication();
    const projected = { ...NOTE, text: "# Q3\n\nShipped.\n" };
    const result = await publishSliceObjectContent({ handle, objects: [projected] });
    const owner = handle.runtime.ownerGroup;
    const opened = await openPvo1Frame((await handle.store.get(result.writes[0].objectRemoteKey!))!, [
      { groupId: owner.groupId, keyEpoch: owner.keyEpoch, privateKey: owner.hpke.privateKey },
    ]);
    expect(new TextDecoder().decode(opened.plaintext!)).toBe(projected.text);
  });

  it("chains the device operations it writes", async () => {
    // A gap or a repeat in the chain makes every later operation unverifiable
    // for a recipient, so the whole publication stops opening - not just the
    // one note that broke it.
    const { handle } = await makePublication();
    const result = await publishSliceObjectContent({
      handle,
      objects: [NOTE, { sourceObjectId: "d4".repeat(16), path: "Projects/Q4.md", text: "# Q4" }],
    });
    expect(result.writes.map((write) => write.sequence)).toEqual([1, 2]);
    const first = parseWorkspaceDocument((await handle.store.get(result.writes[0].operationRemoteKey))!);
    const second = parseWorkspaceDocument((await handle.store.get(result.writes[1].operationRemoteKey))!);
    const firstPayload = first.payload as { previousDeviceOperationHash: string | null; objectId: string; payloadHash: string };
    const secondPayload = second.payload as { previousDeviceOperationHash: string | null };
    expect(firstPayload.previousDeviceOperationHash).toBeNull();
    expect(secondPayload.previousDeviceOperationHash).toBe(result.writes[0].operationHash);
    expect(result.lastOperationHash).toBe(result.writes[1].operationHash);
    expect(result.lastSequence).toBe(2);
  });

  it("continues an existing chain when asked to", async () => {
    // Republishing is a second run against a device that already has a
    // sequence. Starting over at 1 would collide with what is already there.
    const { handle } = await makePublication();
    const first = await publishSliceObjectContent({ handle, objects: [NOTE] });
    const second = await publishSliceObjectContent({
      handle,
      objects: [{ sourceObjectId: "d4".repeat(16), path: "Projects/Q4.md", text: "# Q4" }],
      fromSequence: first.lastSequence + 1,
      previousOperationHash: first.lastOperationHash,
    });
    expect(second.writes[0].sequence).toBe(2);
    const payload = parseWorkspaceDocument((await handle.store.get(second.writes[0].operationRemoteKey))!).payload as { previousDeviceOperationHash: string | null };
    expect(payload.previousDeviceOperationHash).toBe(first.lastOperationHash);
  });

  it("refuses a chain that does not add up", async () => {
    const { handle } = await makePublication();
    await expect(publishSliceObjectContent({ handle, objects: [NOTE], fromSequence: 2, previousOperationHash: null })).rejects.toThrow();
    await expect(publishSliceObjectContent({ handle, objects: [NOTE], fromSequence: 1, previousOperationHash: "aa".repeat(32) })).rejects.toThrow();
    await expect(publishSliceObjectContent({ handle, objects: [NOTE], fromSequence: 0 })).rejects.toThrow();
  });

  it("refuses the same source object twice in one run", async () => {
    // Two entries deriving one id means the second silently overwrites the
    // first. A publication quietly missing a note is worse than a loud failure.
    const { handle } = await makePublication();
    await expect(publishSliceObjectContent({ handle, objects: [NOTE, { ...NOTE, path: "Elsewhere.md" }] })).rejects.toThrow();
  });

  it("refuses a note too large to seal inline", async () => {
    // The chunked frame exists for files above 8 MiB, a size no Markdown note
    // reaches. Rather than carry a second write path for a case that does not
    // occur, an oversized object is refused by name.
    const { handle } = await makePublication();
    const huge = { sourceObjectId: "e5".repeat(16), path: "Huge.md", text: "x".repeat(8 * 1024 * 1024 + 1) };
    await expect(publishSliceObjectContent({ handle, objects: [huge] })).rejects.toThrow();
  });

  it("refuses a path that is not canonical", async () => {
    // A decomposed path seals fine and then fails to line up with anything a
    // reader looks for - the object is there and unfindable.
    const { handle } = await makePublication();
    await expect(publishSliceObjectContent({ handle, objects: [{ ...NOTE, path: "Projects/Qué.md" }] })).rejects.toThrow();
  });

  it("writes nothing at all when there is nothing to publish", async () => {
    const { handle, outer } = await makePublication();
    const result = await publishSliceObjectContent({ handle, objects: [] });
    expect(result.writes).toEqual([]);
    expect(result.lastSequence).toBe(0);
    expect(result.lastOperationHash).toBeNull();
    expect((await outer.list(`.pvws/publications/${handle.publicationId}/objects`)).items).toEqual([]);
  });
});

/**
 * Keeping it current, and taking it back (S4).
 *
 * A publication that only ever grows is a publication that lies: the note the
 * author edited last week still reads the old way, and the note they removed
 * from the slice is still being handed out. Both halves are the same mechanism -
 * an operation naming the revision the publication already holds - which is why
 * they are one function and one plan rather than two.
 */

const SOURCE_A = "c3".repeat(16);
const SOURCE_B = "d4".repeat(16);
const REV_1 = "r1".repeat(16);
const REV_2 = "r2".repeat(16);

const covered = (sourceObjectId: string, path: string, sourceRevisionId: string) => ({ sourceObjectId, path, sourceRevisionId });

describe("planPublicationRefresh", () => {
  it("publishes everything on the first run, with nothing to build on", () => {
    const plan = planPublicationRefresh({
      manifest: emptyPublicationManifest("pub-a"),
      covered: [covered(SOURCE_A, "Projects/Q3.md", REV_1)],
    });
    expect(plan).toEqual([
      { action: "publish", sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: REV_1, parentRevisionId: null },
    ]);
  });

  it("leaves an unchanged note alone", () => {
    // The count this feeds is shown to the user as "N Aenderungen ausstehend".
    // A planner that re-published everything would make that number meaningless
    // and every refresh a full re-upload of the slice.
    const manifest: PublicationManifest = {
      publicationId: "pub-a",
      sequence: 2,
      previousOperationHash: "aa".repeat(32),
      objects: [{ sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: REV_1, publishedRevisionId: "pp".repeat(16) }],
    };
    expect(planPublicationRefresh({ manifest, covered: [covered(SOURCE_A, "Projects/Q3.md", REV_1)] })).toEqual([]);
  });

  it("republishes a changed note onto the revision the publication holds", () => {
    // The parent is not decoration: the protocol refuses a `write` with no
    // parents, so a planner that forgot it would not produce a wrong revision -
    // it would produce an operation no recipient accepts.
    const published = "pp".repeat(16);
    const manifest: PublicationManifest = {
      publicationId: "pub-a",
      sequence: 2,
      previousOperationHash: "aa".repeat(32),
      objects: [{ sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: REV_1, publishedRevisionId: published }],
    };
    const plan = planPublicationRefresh({ manifest, covered: [covered(SOURCE_A, "Projects/Q3.md", REV_2)] });
    expect(plan).toEqual([
      { action: "republish", sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: REV_2, parentRevisionId: published },
    ]);
  });

  it("republishes a note that only moved", () => {
    // The subtle one. The path is sealed INTO the frame metadata, so a note
    // whose text never changed still needs a new revision after a move -
    // otherwise the recipient keeps it filed where it no longer belongs, and
    // nothing in the publication ever says otherwise.
    const published = "pp".repeat(16);
    const manifest: PublicationManifest = {
      publicationId: "pub-a",
      sequence: 2,
      previousOperationHash: "aa".repeat(32),
      objects: [{ sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: REV_1, publishedRevisionId: published }],
    };
    const plan = planPublicationRefresh({ manifest, covered: [covered(SOURCE_A, "Archive/Q3.md", REV_1)] });
    expect(plan).toEqual([
      { action: "republish", sourceObjectId: SOURCE_A, path: "Archive/Q3.md", sourceRevisionId: REV_1, parentRevisionId: published },
    ]);
  });

  it("retracts a note that left the slice", () => {
    // Finding B5: the rule stopped matching, the note moved out, it was deleted.
    // Whatever the cause, the publication must stop handing it out - the silent
    // alternative is an author who believes they took a note back and a
    // recipient who still syncs it.
    const published = "pp".repeat(16);
    const manifest: PublicationManifest = {
      publicationId: "pub-a",
      sequence: 2,
      previousOperationHash: "aa".repeat(32),
      objects: [{ sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: REV_1, publishedRevisionId: published }],
    };
    expect(planPublicationRefresh({ manifest, covered: [] })).toEqual([
      { action: "retract", sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: null, parentRevisionId: published },
    ]);
  });

  it("refuses a slice that lists the same object twice", () => {
    expect(() =>
      planPublicationRefresh({
        manifest: emptyPublicationManifest("pub-a"),
        covered: [covered(SOURCE_A, "One.md", REV_1), covered(SOURCE_A, "Two.md", REV_2)],
      }),
    ).toThrow();
  });
});

describe("runPublicationRefresh", () => {
  const project = async () => ({ text: "# Q3\n\nShipped." });

  async function firstRun(over: { path?: string } = {}) {
    const made = await makePublication();
    const plan = planPublicationRefresh({
      manifest: emptyPublicationManifest(made.handle.publicationId),
      covered: [covered(SOURCE_A, over.path ?? "Projects/Q3.md", REV_1)],
    });
    const result = await runPublicationRefresh({ handle: made.handle, manifest: emptyPublicationManifest(made.handle.publicationId), plan, project });
    return { ...made, result };
  }

  it("revises the same object rather than adding a second copy", async () => {
    // The derived id is what makes a refresh a refresh. If the second write
    // landed under a different id, the recipient would hold two copies of one
    // note with no way to tell which is current.
    const { handle, result } = await firstRun();
    const first = result.applied[0];

    const plan = planPublicationRefresh({ manifest: result.manifest, covered: [covered(SOURCE_A, "Projects/Q3.md", REV_2)] });
    const second = await runPublicationRefresh({ handle, manifest: result.manifest, plan, project: async () => ({ text: "# Q3\n\nShipped late." }) });

    expect(second.applied[0].objectId).toBe(first.objectId);
    expect(second.applied[0].operation).toBe("write");
    expect(second.applied[0].revisionId).not.toBe(first.revisionId);

    const payload = parseWorkspaceDocument((await handle.store.get(second.applied[0].operationRemoteKey))!).payload as {
      capability: string;
      operation: string;
      parentRevisionIds: string[];
    };
    expect(payload.capability).toBe("content.write");
    expect(payload.operation).toBe("write");
    expect(payload.parentRevisionIds).toEqual([first.revisionId]);
  });

  it("retracts by writing an operation and no frame", async () => {
    // Nothing is unsent - a recipient may have synced the frame long ago. What
    // a tombstone does is stop the object being part of the publication going
    // forward: a client that syncs it removes the note, and a client syncing
    // for the first time never sees it.
    const { handle, outer, result } = await firstRun();
    const published = result.applied[0];

    const plan = planPublicationRefresh({ manifest: result.manifest, covered: [] });
    const retracted = await runPublicationRefresh({ handle, manifest: result.manifest, plan, project });

    const write = retracted.applied[0];
    expect(write.operation).toBe("delete");
    expect(write.revisionId).toBeNull();
    expect(write.objectRemoteKey).toBeNull();

    const payload = parseWorkspaceDocument((await handle.store.get(write.operationRemoteKey))!).payload as {
      capability: string;
      operation: string;
      revisionId: string | null;
      payloadHash: string | null;
      parentRevisionIds: string[];
    };
    expect(payload.capability).toBe("content.delete");
    expect(payload.revisionId).toBeNull();
    expect(payload.payloadHash).toBeNull();
    expect(payload.parentRevisionIds).toEqual([published.revisionId]);

    // One frame, from the publish. The retraction added an operation beside it
    // and sealed nothing.
    const frames = (await outer.list(`.pvws/publications/${handle.publicationId}/objects`)).items;
    expect(frames).toHaveLength(1);
    expect(retracted.manifest.objects).toEqual([]);
  });

  it("refuses a tombstone that names no real revision", async () => {
    // The red counter-check for the parent. If the protocol accepted this, the
    // parent would be decoration and a retraction could not be verified against
    // what the publication actually holds.
    const { handle, result } = await firstRun();
    await expect(
      runPublicationRefresh({
        handle,
        manifest: result.manifest,
        plan: [{ action: "retract", sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: null, parentRevisionId: "not-a-revision" }],
        project,
      }),
    ).resolves.toMatchObject({ error: expect.any(String), applied: [] });
  });

  it("chains a retraction like any other operation", async () => {
    // A gap or a repeat in the device chain makes every LATER operation
    // unverifiable, so a tombstone that broke the chain would take the whole
    // publication down with it, not just the note it retires.
    const { handle, result } = await firstRun();
    const plan = planPublicationRefresh({ manifest: result.manifest, covered: [] });
    const retracted = await runPublicationRefresh({ handle, manifest: result.manifest, plan, project });

    expect(retracted.applied[0].sequence).toBe(result.applied[0].sequence + 1);
    const payload = parseWorkspaceDocument((await handle.store.get(retracted.applied[0].operationRemoteKey))!).payload as {
      previousDeviceOperationHash: string | null;
    };
    expect(payload.previousDeviceOperationHash).toBe(result.applied[0].operationHash);
    expect(retracted.manifest.sequence).toBe(retracted.applied[0].sequence + 1);
  });

  it("re-plans to nothing once everything has landed", async () => {
    // This IS the resumability claim. There is no stored job with per-item
    // flags: a resumed run derives the same plan, and anything already
    // published is simply not in it.
    const { result } = await firstRun();
    expect(planPublicationRefresh({ manifest: result.manifest, covered: [covered(SOURCE_A, "Projects/Q3.md", REV_1)] })).toEqual([]);
  });

  it("stops when abandoned, leaving a manifest that matches what landed", async () => {
    // A refresh interrupted halfway does leave some notes refreshed and some
    // not - unavoidable against an object store. What it must never leave is a
    // publication the manifest no longer describes, because the next run would
    // then either skip an object it never wrote or write a second copy of one
    // it did.
    const { handle } = await makePublication();
    const controller = new AbortController();
    const plan = planPublicationRefresh({
      manifest: emptyPublicationManifest(handle.publicationId),
      covered: [covered(SOURCE_A, "Projects/Q3.md", REV_1), covered(SOURCE_B, "Projects/Q4.md", REV_1)],
    });

    const result = await runPublicationRefresh({
      handle,
      manifest: emptyPublicationManifest(handle.publicationId),
      plan,
      project,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    expect(result.aborted).toBe(true);
    expect(result.applied).toHaveLength(1);
    expect(result.manifest.objects.map((record) => record.sourceObjectId)).toEqual([SOURCE_A]);

    // And the rest is still there to do, from the manifest alone.
    expect(
      planPublicationRefresh({
        manifest: result.manifest,
        covered: [covered(SOURCE_A, "Projects/Q3.md", REV_1), covered(SOURCE_B, "Projects/Q4.md", REV_1)],
      }).map((item) => item.sourceObjectId),
    ).toEqual([SOURCE_B]);
  });

  it("stops on a failure rather than skipping past it", async () => {
    // Carrying on would report the refresh as done while one note quietly kept
    // its old text - the exact failure a user cannot see.
    const { handle } = await makePublication();
    let writes = 0;
    const failing = {
      ...handle.store,
      putImmutable: async (...args: Parameters<typeof handle.store.putImmutable>) => {
        writes += 1;
        if (writes > 2) throw new Error("provider refused the write");
        return handle.store.putImmutable(...args);
      },
    } as typeof handle.store;

    const plan = planPublicationRefresh({
      manifest: emptyPublicationManifest(handle.publicationId),
      covered: [covered(SOURCE_A, "Projects/Q3.md", REV_1), covered(SOURCE_B, "Projects/Q4.md", REV_1)],
    });
    const result = await runPublicationRefresh({
      handle: { ...handle, store: failing },
      manifest: emptyPublicationManifest(handle.publicationId),
      plan,
      project,
    });

    expect(result.aborted).toBe(false);
    expect(result.error).toContain("provider refused the write");
    expect(result.stoppedAt?.sourceObjectId).toBe(SOURCE_B);
    expect(result.manifest.objects.map((record) => record.sourceObjectId)).toEqual([SOURCE_A]);
  });

  it("hands the advanced manifest over after every object", async () => {
    // The durability hook. Returning the manifest only at the end would lose it
    // to a hard crash, and the next run would re-derive a plan for objects that
    // are already in the publication.
    const { handle } = await makePublication();
    const seen: number[] = [];
    const plan = planPublicationRefresh({
      manifest: emptyPublicationManifest(handle.publicationId),
      covered: [covered(SOURCE_A, "Projects/Q3.md", REV_1), covered(SOURCE_B, "Projects/Q4.md", REV_1)],
    });
    await runPublicationRefresh({
      handle,
      manifest: emptyPublicationManifest(handle.publicationId),
      plan,
      project,
      persist: async (manifest) => {
        seen.push(manifest.objects.length);
      },
    });
    expect(seen).toEqual([1, 2]);
  });
});


describe("publication state store", () => {
  const config: PublishedSliceConfig = {
    publicationId: "pub-a",
    sliceId: "slice-a",
    name: "Quarterly review",
    mode: "sanitized",
    access: "read",
    provider: "webdav",
    propertyAllowlist: ["title"],
    privateProperties: ["salary"],
    createdAt: "2026-08-30T08:00:00.000Z",
  };

  const record = (over: Partial<WorkspacePublicationRecord> = {}): WorkspacePublicationRecord => ({
    publicationId: config.publicationId,
    sliceId: config.sliceId,
    config,
    manifest: emptyPublicationManifest(config.publicationId),
    lastError: null,
    lastRefreshedAt: null,
    createdAt: config.createdAt,
    ...over,
  });

  it("round-trips a publication with its config and manifest", async () => {
    const state = new MemoryWorkspaceStateStore();
    await state.savePublication(record());

    const read = await state.getPublication("pub-a");
    expect(read?.config.privateProperties).toEqual(["salary"]);
    expect(read?.manifest.sequence).toBe(1);
    // `null` is a value here, not an absence: "the last refresh ran to the end"
    // and "we have never refreshed" have to stay distinguishable from a string.
    expect(read?.lastError).toBeNull();
    expect(await state.listPublications()).toHaveLength(1);
  });

  it("keeps the creation moment when a later refresh saves over it", async () => {
    const state = new MemoryWorkspaceStateStore();
    await state.savePublication(record());
    await state.savePublication(
      record({
        manifest: { ...emptyPublicationManifest("pub-a"), sequence: 4 },
        lastRefreshedAt: "2026-08-30T09:30:00.000Z",
        // A caller that re-derives the record has no reason to carry the
        // original timestamp forward, so the store must not take this one.
        createdAt: "2026-08-30T09:30:00.000Z",
      }),
    );

    const read = await state.getPublication("pub-a");
    expect(read?.manifest.sequence).toBe(4);
    expect(read?.lastRefreshedAt).toBe("2026-08-30T09:30:00.000Z");
    expect(read?.createdAt).toBe("2026-08-30T08:00:00.000Z");
    expect(await state.listPublications()).toHaveLength(1);
  });

  it("remembers why a refresh stopped, because nobody watches a background cycle", async () => {
    const state = new MemoryWorkspaceStateStore();
    await state.savePublication(record({ lastError: "provider rejected the upload" }));
    expect((await state.getPublication("pub-a"))?.lastError).toBe("provider rejected the upload");

    // And forgets it again once a refresh gets through - a stale reason would
    // report a publication as broken long after it recovered.
    await state.savePublication(record({ lastError: null, lastRefreshedAt: "2026-08-30T10:00:00.000Z" }));
    expect((await state.getPublication("pub-a"))?.lastError).toBeNull();
  });

  it("drops a publication on request and reports a missing one as null", async () => {
    const state = new MemoryWorkspaceStateStore();
    await state.savePublication(record());
    await state.deletePublication("pub-a");
    expect(await state.getPublication("pub-a")).toBeNull();
    expect(await state.listPublications()).toEqual([]);
  });

  it("hands out copies, so a caller cannot edit the stored record by accident", async () => {
    const state = new MemoryWorkspaceStateStore();
    await state.savePublication(record());
    const read = (await state.getPublication("pub-a"))!;
    read.config.privateProperties.push("bonus");
    expect((await state.getPublication("pub-a"))?.config.privateProperties).toEqual(["salary"]);
  });
});


describe("publication recipients", () => {
  // Reuses the fixture the rest of this file is built on, so the recipient
  // side follows any later change to how a publication is made.
  const publish = async (access: "read" | "comment" | "suggest") => (await makePublication({ access })).handle;

  it("lets a recipient in through the group that already holds the key", async () => {
    const handle = await publish("read");
    const invited = await invitePublicationRecipient({
      runtime: handle.runtime,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Ada",
    });

    const group = invited.policy.payload.groups.find((entry) => entry.groupId === handle.recipientGroupId)!;
    // Membership is the whole mechanism: the group carries the epoch key the
    // published content is sealed to, so being in it IS being able to read.
    expect(group.memberIds).toContain(invited.memberId);
    expect(invited.policy.payload.groups).toHaveLength(handle.runtime.policy.payload.groups.length);
  });

  it("gives the recipient no assignment of their own", async () => {
    const handle = await publish("read");
    const invited = await invitePublicationRecipient({
      runtime: handle.runtime,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Ada",
    });

    expect(
      invited.policy.payload.assignments.filter(
        (assignment) => assignment.subjectKind === "member" && assignment.subjectId === invited.memberId,
      ),
    ).toEqual([]);
  });

  it("leaves nothing behind when a recipient is taken out of the group", async () => {
    // This is why the member-scoped assignment is dropped. A workspace-scoped
    // line survives group membership: the recipient would lose the key and keep
    // a policy saying they may read, and policy and crypto would disagree.
    const handle = await publish("read");
    const invited = await invitePublicationRecipient({
      runtime: handle.runtime,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Ada",
    });
    const removed = structuredClone(invited.policy.payload);
    const group = removed.groups.find((entry) => entry.groupId === handle.recipientGroupId)!;
    group.memberIds = [];

    expect(
      evaluateWorkspaceAccess(removed, { memberId: invited.memberId, capability: "content.read" }).allowed,
    ).toBe(false);
  });

  it("grants exactly what the publication's access level says, and nothing more", async () => {
    const handle = await publish("comment");
    const invited = await invitePublicationRecipient({
      runtime: handle.runtime,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Ada",
    });
    const policy = invited.policy.payload;
    const may = (capability: Parameters<typeof evaluateWorkspaceAccess>[1]["capability"]) =>
      evaluateWorkspaceAccess(policy, { memberId: invited.memberId, capability }).allowed;

    expect(may("content.read")).toBe(true);
    expect(may("comment.create")).toBe(true);
    // A recipient of a published slice never administers it.
    expect(may("content.write")).toBe(false);
    expect(may("members.invite")).toBe(false);
    expect(may("keys.rotate")).toBe(false);
  });

  it("carries the append right of a suggest publication, which no role bundles", async () => {
    // `suggest` is read + comment.create + content.create - a set no standard
    // role matches. Deriving capabilities from a role would round it down and
    // leave a recipient unable to write the suggestion they were invited for.
    const handle = await publish("suggest");
    const invited = await invitePublicationRecipient({
      runtime: handle.runtime,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Ada",
    });

    expect(
      evaluateWorkspaceAccess(invited.policy.payload, { memberId: invited.memberId, capability: "content.create" })
        .allowed,
    ).toBe(true);
  });

  it("hands out a code that points at the publication, not at the vault behind it", async () => {
    const handle = await publish("read");
    const invited = await invitePublicationRecipient({
      runtime: handle.runtime,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Ada",
    });
    const decoded = decodeWorkspaceInvite(invited.invite);

    expect(decoded.workspaceId).toBe(handle.publicationId);
    expect(decoded.workspaceId).not.toBe(WORKSPACE);
    expect(decoded.memberId).toBe(invited.memberId);
    // No role: the joining side never reads the field, and `suggest` has no
    // role to name - a label there could only ever describe the wrong thing.
    expect(decoded.role).toBeUndefined();
  });

  it("lists who a publication reaches, and keeps listing them as more join", async () => {
    const handle = await publish("read");
    const first = await invitePublicationRecipient({
      runtime: handle.runtime,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Zoe",
    });
    const afterFirst = { ...handle.runtime, policy: first.policy };
    const second = await invitePublicationRecipient({
      runtime: afterFirst,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Ada",
    });

    expect(publicationRecipients(second.policy.payload, handle.recipientGroupId).map((r) => r.displayName)).toEqual([
      "Ada",
      "Zoe",
    ]);
    expect(publicationRecipients(second.policy.payload, "no-such-group")).toEqual([]);
    expect(second.memberId).not.toBe(first.memberId);
  });

  it("refuses a group that is not this publication's", async () => {
    const handle = await publish("read");
    await expect(
      invitePublicationRecipient({ runtime: handle.runtime, recipientGroupId: "made-up", displayName: "Ada" }),
    ).rejects.toThrow();
    await expect(
      invitePublicationRecipient({
        runtime: handle.runtime,
        recipientGroupId: handle.recipientGroupId,
        displayName: "   ",
      }),
    ).rejects.toThrow();
  });
});


/**
 * The seam that keeps a publication current (S4b).
 *
 * `planPublicationRefresh` and `runPublicationRefresh` are pure and already
 * proven above. What is new here is the orchestrator that answers the two
 * questions they deliberately do not: which objects a slice covers, and where
 * the publication's key comes from. Every case below is one of those answers
 * going wrong quietly.
 */
describe("refreshWorkspacePublications", () => {
  const OBJ_TEXT = "d4".repeat(16);
  const OBJ_DELETED = "d5".repeat(16);
  const OBJ_NO_REVISION = "d6".repeat(16);
  const OBJ_BINARY = "d7".repeat(16);

  const object = (over: Partial<WorkspaceObjectRecord> & { objectId: string; path: string }): WorkspaceObjectRecord => ({
    currentRevisionId: REV_1,
    payloadHash: null,
    plaintextSha256: null,
    contentKind: "text",
    deleted: false,
    authorMemberId: "",
    createdAt: "2026-08-20T08:00:00.000Z",
    modifiedAt: "2026-08-29T08:00:00.000Z",
    ...over,
  });

  const slice = (ids: string[]): WorkspacePolicySlice => ({
    sliceId: SLICE,
    name: "Quarterly review",
    kind: "selection",
    definition: "",
    materializedObjectIds: ids,
  });

  /**
   * Only the three methods the refresh actually uses, so a test cannot pass by
   * leaning on something the real caller does not hand over.
   */
  function fakeState(records: WorkspacePublicationRecord[], objects: WorkspaceObjectRecord[]) {
    const saved: WorkspacePublicationRecord[] = [];
    return {
      saved,
      store: {
        listPublications: async () => records.map((record) => ({ ...record })),
        listObjects: async () => objects.map((entry) => ({ ...entry })),
        savePublication: async (record: WorkspacePublicationRecord) => {
          saved.push({ ...record });
          const index = records.findIndex((entry) => entry.publicationId === record.publicationId);
          if (index >= 0) records[index] = { ...record };
        },
      },
    };
  }

  function makeRecord(handle: PublicationWriteHandle, over: Partial<WorkspacePublicationRecord> = {}): WorkspacePublicationRecord {
    return {
      publicationId: handle.publicationId,
      sliceId: SLICE,
      config: {
        publicationId: handle.publicationId,
        sliceId: SLICE,
        name: "Quarterly review",
        mode: "sanitized",
        access: "read",
        provider: "webdav",
        propertyAllowlist: null,
        privateProperties: ["salary"],
        createdAt: "2026-08-26T09:00:00.000Z",
      },
      manifest: emptyPublicationManifest(handle.publicationId),
      lastError: null,
      lastRefreshedAt: null,
      createdAt: "2026-08-26T09:00:00.000Z",
      ...over,
    };
  }

  it("publishes only what a reader may actually be handed", async () => {
    // The three exclusions are each a way a publication could hand out
    // something it must not: a note the author deleted, a note with no content
    // yet, and a binary that is not Markdown at all. A slice that names all
    // four still publishes one.
    const { handle, outer } = await makePublication();
    const objects = [
      object({ objectId: OBJ_TEXT, path: "Projects/Q3.md" }),
      object({ objectId: OBJ_DELETED, path: "Projects/Gone.md", deleted: true }),
      object({ objectId: OBJ_NO_REVISION, path: "Projects/Empty.md", currentRevisionId: null }),
      object({ objectId: OBJ_BINARY, path: "Projects/chart.png", contentKind: "binary" }),
    ];
    const state = fakeState([makeRecord(handle)], objects);

    const outcomes = await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "# Q3\n\nShipped." },
      policy: { slices: [slice([OBJ_TEXT, OBJ_DELETED, OBJ_NO_REVISION, OBJ_BINARY])] },
      store: outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => handle.runtime,
      now: () => "2026-08-30T10:00:00.000Z",
    });

    expect(outcomes).toEqual([
      { publicationId: handle.publicationId, planned: 1, applied: 1, error: null, skipped: null },
    ]);
    const final = state.saved.at(-1)!;
    expect(final.manifest.objects).toHaveLength(1);
    expect(final.manifest.objects[0].sourceObjectId).toBe(OBJ_TEXT);
    expect(final.lastRefreshedAt).toBe("2026-08-30T10:00:00.000Z");
    expect((await outer.list(`.pvws/publications/${handle.publicationId}/objects`)).items.length).toBeGreaterThan(0);
  });

  it("leaves a publication alone when its slice is gone from the policy", async () => {
    // The load-bearing one. An empty coverage set plans a retraction of
    // EVERYTHING, so a policy that arrived half-read - or a slice someone
    // renamed - would silently strip a publication a recipient is reading.
    // Taking one down belongs to a person and a dialog (S6).
    const { handle, outer } = await makePublication();
    const record = makeRecord(handle, {
      manifest: {
        publicationId: handle.publicationId,
        sequence: 4,
        previousOperationHash: null,
        objects: [
          {
            sourceObjectId: OBJ_TEXT,
            path: "Projects/Q3.md",
            sourceRevisionId: REV_1,
            publishedRevisionId: "e2".repeat(16),
          },
        ],
      },
    });
    const state = fakeState([record], [object({ objectId: OBJ_TEXT, path: "Projects/Q3.md" })]);

    const outcomes = await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => { throw new Error("must not read"); } },
      policy: { slices: [] },
      store: outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => { throw new Error("must not open"); },
    });

    expect(outcomes[0]).toEqual({ publicationId: handle.publicationId, planned: 0, applied: 0, error: null, skipped: "no-slice" });
    expect(state.saved).toEqual([]);
  });

  it("does not call a missing key a failure", async () => {
    // The publisher's other device holds the key and refreshes this fine.
    // Writing an error here would show a broken publication to someone who
    // cannot do anything about it.
    const { handle, outer } = await makePublication();
    const state = fakeState([makeRecord(handle)], [object({ objectId: OBJ_TEXT, path: "Projects/Q3.md" })]);

    const outcomes = await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "# Q3" },
      policy: { slices: [slice([OBJ_TEXT])] },
      store: outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => null,
    });

    expect(outcomes[0]).toEqual({ publicationId: handle.publicationId, planned: 1, applied: 0, error: null, skipped: "no-key" });
    expect(state.saved).toEqual([]);
  });

  it("clears a stale reason once nothing is left to publish", async () => {
    // A publication that recovered must stop reporting last week's outage.
    const { handle, outer } = await makePublication();
    const state = fakeState([makeRecord(handle, { lastError: "provider rejected the upload" })], []);

    const outcomes = await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "" },
      policy: { slices: [slice([])] },
      store: outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => { throw new Error("must not open"); },
      now: () => "2026-08-30T11:00:00.000Z",
    });

    expect(outcomes[0].skipped).toBe("up-to-date");
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0].lastError).toBeNull();
    expect(state.saved[0].lastRefreshedAt).toBe("2026-08-30T11:00:00.000Z");
  });

  it("writes nothing at all when there is nothing to say", async () => {
    // A clean publication saves no record, so the common case does not rewrite
    // a row on every cycle.
    const { handle, outer } = await makePublication();
    const state = fakeState([makeRecord(handle)], []);

    await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "" },
      policy: { slices: [slice([])] },
      store: outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => { throw new Error("must not open"); },
    });

    expect(state.saved).toEqual([]);
  });

  it("stops on a failure and keeps the reason where a person can be shown it", async () => {
    // Nobody watches a background cycle. Carrying on past the failure would
    // report the refresh as done while the second note quietly kept its old
    // text - so the run stops, and the record says why.
    const { handle, outer } = await makePublication();
    const objects = [
      object({ objectId: OBJ_TEXT, path: "Projects/A.md" }),
      object({ objectId: OBJ_BINARY, path: "Projects/B.md", contentKind: "text" }),
    ];
    const state = fakeState([makeRecord(handle)], objects);

    const outcomes = await refreshWorkspacePublications({
      state: state.store,
      vault: {
        readTextFile: async (path: string) => {
          if (path === "Projects/B.md") throw new Error("vault file vanished");
          return "# A";
        },
      },
      policy: { slices: [slice([OBJ_TEXT, OBJ_BINARY])] },
      store: outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => handle.runtime,
      now: () => "2026-08-30T12:00:00.000Z",
    });

    expect(outcomes[0].planned).toBe(2);
    expect(outcomes[0].applied).toBe(1);
    expect(outcomes[0].error).toContain("vault file vanished");
    // The one that DID land stays landed - the manifest advances per object, so
    // the next run republishes only what is missing.
    const final = state.saved.at(-1)!;
    expect(final.manifest.objects).toHaveLength(1);
    expect(final.lastError).toContain("vault file vanished");
  });

  it("advances the manifest after every object, not at the end", async () => {
    // A run that dies mid-way has to leave a manifest that still describes the
    // publication, or the next run publishes a second copy of what already
    // landed. Two objects, and the store is written to more than once.
    const { handle, outer } = await makePublication();
    const objects = [
      object({ objectId: OBJ_TEXT, path: "Projects/A.md" }),
      object({ objectId: OBJ_BINARY, path: "Projects/B.md", contentKind: "text" }),
    ];
    const state = fakeState([makeRecord(handle)], objects);

    await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "# Note" },
      policy: { slices: [slice([OBJ_TEXT, OBJ_BINARY])] },
      store: outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => handle.runtime,
    });

    // Two per-object saves plus the closing one.
    expect(state.saved.length).toBeGreaterThanOrEqual(3);
    expect(state.saved[0].manifest.objects).toHaveLength(1);
    expect(state.saved.at(-1)!.manifest.objects).toHaveLength(2);
  });

  it("sanitizes on the way out, and only when the publication says so", async () => {
    // The projection is what stands between a private property and a stranger.
    // Both modes are pinned here because the difference between them is a
    // config field a person picked once, in a wizard, weeks ago.
    const markdown = "---\ntitle: Q3\nsalary: 120000\n---\n\nSee [notes](Private/Secret.md).\n";
    const read = async () => markdown;

    const sanitized = await makePublication();
    const sanitizedState = fakeState([makeRecord(sanitized.handle)], [object({ objectId: OBJ_TEXT, path: "Projects/Q3.md" })]);
    await refreshWorkspacePublications({
      state: sanitizedState.store,
      vault: { readTextFile: read },
      policy: { slices: [slice([OBJ_TEXT])] },
      store: sanitized.outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => sanitized.handle.runtime,
    });
    const sanitizedWrite = sanitizedState.saved.at(-1)!.manifest.objects[0];
    const sanitizedText = await readPublishedText(sanitized, sanitizedWrite.sourceObjectId);
    expect(sanitizedText).not.toContain("120000");
    expect(sanitizedText).not.toContain("Private/Secret.md");
    expect(sanitizedText).toContain("notes");

    const exact = await makePublication({ mode: "exact" });
    const exactRecord = makeRecord(exact.handle);
    const exactState = fakeState(
      [{ ...exactRecord, config: { ...exactRecord.config, mode: "exact" } }],
      [object({ objectId: OBJ_TEXT, path: "Projects/Q3.md" })],
    );
    await refreshWorkspacePublications({
      state: exactState.store,
      vault: { readTextFile: read },
      policy: { slices: [slice([OBJ_TEXT])] },
      store: exact.outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => exact.handle.runtime,
    });
    const exactWrite = exactState.saved.at(-1)!.manifest.objects[0];
    expect(await readPublishedText(exact, exactWrite.sourceObjectId)).toBe(markdown);
  });

  it("refreshes into the same folder the publication was created in", async () => {
    // The one way this could go wrong without ever raising an error. A
    // publication bootstraps a workspace whose id IS its publication id, so
    // when a caller reaches for "the runtime" and derives a store from it, the
    // pair (publicationId, sliceId) hashes to a DIFFERENT folder than the pair
    // (workspaceId, sliceId) that creation used. Every write then succeeds, in
    // a folder nobody joined, and the recipient sees a publication that never
    // moves. So this asserts on the bytes' address, not on the outcome.
    const { handle, outer } = await makePublication();
    const state = fakeState([makeRecord(handle)], [object({ objectId: OBJ_TEXT, path: "Projects/Q3.md" })]);

    await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "# Q3\n\nShipped." },
      policy: { slices: [slice([OBJ_TEXT])] },
      store: outer,
      workspaceId: WORKSPACE,
      openPublicationRuntime: async () => handle.runtime,
    });

    // Same address as creation, reached from the outside: the refresh wrote
    // under the publication's own prefix, and nothing landed anywhere else.
    const published = await outer.list(`.pvws/publications/${handle.publicationId}/objects`);
    expect(published.items).toHaveLength(1);
    const strays = (await outer.list(".pvws/publications")).items
      .filter((item) => !item.key.startsWith(`.pvws/publications/${handle.publicationId}/`));
    expect(strays).toEqual([]);
  });

  /**
   * Reads back what a recipient would actually see, rather than trusting the plan.
   *
   * The manifest names the SOURCE object, while the frame is filed under the
   * derived publication id - the same derivation the publisher used - so the
   * lookup has to go through it rather than through the id the caller knows.
   */
  async function readPublishedText(
    made: Awaited<ReturnType<typeof makePublication>>,
    sourceObjectId: string,
  ): Promise<string> {
    const objectId = derivePublishedObjectId(made.handle.publicationId, sourceObjectId);
    // Through the publication store, whose keys are namespaced: asking the
    // outer store for the same path and then reading through the inner one
    // would prefix it twice.
    const page = await made.handle.store.list(`.pvws/objects/${objectId}`);
    expect(page.items).toHaveLength(1);
    const bytes = (await made.handle.store.get(page.items[0]!.key))!;
    const owner = made.handle.runtime.ownerGroup;
    const opened = await openPvo1Frame(bytes, [
      { groupId: owner.groupId, keyEpoch: owner.keyEpoch, privateKey: owner.hpke.privateKey },
    ]);
    return new TextDecoder().decode(opened.plaintext!);
  }
});

describe("publicationRecipientGroupId", () => {
  it("names the group an invite has to join, without a field that could drift", async () => {
    const { handle } = await makePublication();

    expect(publicationRecipientGroupId(handle.runtime.policy.payload)).toBe(handle.recipientGroupId);
  });

  it("refuses to guess on a policy that is not a publication's", async () => {
    const main = personalWorkspaceRuntime(
      await createPersonalWorkspaceBootstrap({
        workspaceId: WORKSPACE,
        ownerDisplayName: "Owner",
        deviceDisplayName: "Desktop",
        platform: "desktop",
        minimumClientVersion: "0.5.0",
        now: "2026-08-26T08:00:00.000Z",
      }),
    );

    // A plain vault hangs Owner on the owner MEMBER and has no group subject
    // at all. Returning null here is what keeps a caller from inviting someone
    // into the publisher's own group.
    expect(publicationRecipientGroupId(main.policy.payload)).toBeNull();
  });
});

describe("the shared folder, seen by its recipient", () => {
  /**
   * What the provider actually hands a recipient.
   *
   * The publisher shares `.pvws/publications/<id>/` and nothing above it, so
   * the recipient's root IS that folder: keys arrive without the prefix, and
   * without the `.pvws/` segment the publisher's wrapper stripped on the way
   * out. This view models exactly that cut.
   */
  class SharedFolderView implements Pick<WorkspaceObjectStore, "get" | "head" | "list"> {
    constructor(private readonly store: FakeWorkspaceObjectStore, private readonly prefix: string) {}
    get(key: string) { return this.store.get(`${this.prefix}${key}`); }
    async head(key: string) {
      const info = await this.store.head(`${this.prefix}${key}`);
      return info ? { ...info, key } : null;
    }
    async list(prefix: string) {
      const page = await this.store.list(`${this.prefix}${prefix}`);
      return { items: page.items.map((entry) => ({ ...entry, key: entry.key.slice(this.prefix.length) })) };
    }
  }

  it("reads back what the publisher wrote", async () => {
    // The load-bearing claim of the recipient side: the two wrappers are
    // inverses. Break either mapping and a shared publication folder looks
    // EMPTY to the person it was shared with - no error, nothing to act on,
    // because every workspace read asks for `.pvws/...` and finds nothing.
    const remote = new FakeWorkspaceObjectStore();
    const publisher = publicationStoreFor(remote, WORKSPACE, SLICE);
    const bytes = new TextEncoder().encode("genesis");
    const { sha256Hex } = await import("../src/workspace/encoding.js");
    await publisher.putImmutable(".pvws/genesis.pvgen", bytes, sha256Hex(bytes));

    const shared = new SharedFolderView(remote, `.pvws/publications/${derivePublicationId(WORKSPACE, SLICE)}/`);
    // Unwrapped, the same folder answers nothing - that is the bug this exists
    // to prevent, kept here so it cannot come back unnoticed.
    expect(await shared.get(".pvws/genesis.pvgen")).toBeNull();

    const recipient = publicationRecipientStoreFor(shared as unknown as WorkspaceObjectStore);
    expect(await recipient.get(".pvws/genesis.pvgen")).toEqual(bytes);
    expect((await recipient.head(".pvws/genesis.pvgen"))?.key).toBe(".pvws/genesis.pvgen");
    expect((await recipient.list(".pvws/")).items.map((entry) => entry.key)).toEqual([".pvws/genesis.pvgen"]);
  });
});

describe("revokePublicationRecipient", () => {
  /** Mints one recipient so there is somebody to take back out again. */
  async function withRecipient() {
    const made = await makePublication();
    const update = await invitePublicationRecipient({
      runtime: made.handle.runtime,
      recipientGroupId: made.handle.recipientGroupId,
      displayName: "Reviewer",
    });
    applyWorkspaceGovernanceUpdate(made.handle.runtime, update);
    return { ...made, memberId: update.memberId };
  }

  it("closes the door and changes the lock behind it", async () => {
    const { handle, memberId } = await withRecipient();
    const before = handle.runtime.policy.payload.groups.find(
      (group) => group.groupId === handle.recipientGroupId,
    )!;

    const update = await revokePublicationRecipient({
      runtime: handle.runtime,
      memberId,
      reason: "no longer on the project",
    });

    const group = update.policy.payload.groups.find((entry) => entry.groupId === handle.recipientGroupId)!;
    // Both halves matter and neither is sufficient alone: dropped from the
    // group, so no new grant is ever minted for them, AND a fresh epoch, so
    // the key they already hold opens nothing written from here on.
    expect(group.memberIds ?? []).not.toContain(memberId);
    expect(group.keyEpoch).toBe(before.keyEpoch + 1);
    expect(group.hpkePublicKey).not.toBe(before.hpkePublicKey);
    expect(update.policy.payload.members.find((member) => member.memberId === memberId)?.state).toBe("revoked");
    expect(
      update.policy.payload.revocations.some(
        (entry) => entry.subjectKind === "member" && entry.subjectId === memberId,
      ),
    ).toBe(true);
  });

  it("refuses to revoke the publisher out of their own publication", async () => {
    // The failure this guard exists for, and the red probe confirms it is not
    // hypothetical: with the guard removed, this call does not throw at all -
    // `revokeWorkspaceMemberAndRotate` has no notion of publications and
    // revokes the Owner without complaint -
    // and a workspace has exactly one, with no second Owner to restore it. The
    // publication would still be out there, still readable to its recipients,
    // and permanently unmanageable by the person who published it.
    const { handle } = await withRecipient();

    await expect(
      revokePublicationRecipient({
        runtime: handle.runtime,
        memberId: handle.runtime.ownerMemberId,
        reason: "wrong id",
      }),
    ).rejects.toThrow(/not a publication recipient/);
  });

  it("refuses an id that belongs to nobody", async () => {
    const { handle } = await withRecipient();

    await expect(
      revokePublicationRecipient({ runtime: handle.runtime, memberId: "not-a-member", reason: "typo" }),
    ).rejects.toThrow(/not a publication recipient/);
  });
});

const PUB_1 = "e5".repeat(16);
const PUB_2 = "f6".repeat(16);

describe("planPublicationTeardown", () => {
  it("retracts everything the publication holds", async () => {
    const manifest: PublicationManifest = {
      ...emptyPublicationManifest("pub"),
      objects: [
        { sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: REV_1, publishedRevisionId: PUB_1 },
        { sourceObjectId: SOURCE_B, path: "Projects/Q4.md", sourceRevisionId: REV_2, publishedRevisionId: PUB_2 },
      ],
    };

    const plan = planPublicationTeardown(manifest);

    expect(plan.map((item) => item.action)).toEqual(["retract", "retract"]);
    // The parent revision is what makes a tombstone a link in the chain rather
    // than an orphan; the protocol refuses a delete that names none.
    expect(plan.map((item) => item.parentRevisionId).sort()).toEqual([PUB_1, PUB_2].sort());
  });

  it("is the same plan a refresh against an empty slice would produce", async () => {
    // Not a tautology dressed as a test: it pins that withdrawal has exactly
    // one definition. The day teardown grows its own planner, this goes red.
    const manifest: PublicationManifest = {
      ...emptyPublicationManifest("pub"),
      objects: [
        { sourceObjectId: SOURCE_A, path: "Projects/Q3.md", sourceRevisionId: REV_1, publishedRevisionId: PUB_1 },
      ],
    };

    expect(planPublicationTeardown(manifest)).toEqual(planPublicationRefresh({ manifest, covered: [] }));
  });

  it("has nothing to do for a publication that never published anything", async () => {
    expect(planPublicationTeardown(emptyPublicationManifest("pub"))).toEqual([]);
  });
});

describe("a recipient key against the vault it came from", () => {
  /**
   * The one assurance the whole of Stufe B rests on (S8).
   *
   * Everything else in this file checks that a publication CONTAINS the right
   * things. This checks the other half - that it does not open the vault it was
   * cut from. `createPublication` bootstraps a fresh workspace, so the claim is
   * true by construction; that is exactly why it needs a test that would notice
   * if the construction ever changed.
   *
   * The test above it ("shares no key with the vault it came from") compares
   * group ids and genesis payloads. That is an identity claim: it would stay
   * green if two workspaces used disjoint ids and the same key material. Here
   * we attempt an actual decrypt, which is the claim a recipient cares about.
   */
  const SECRET = "Salaries 2026\n\nNot in any slice.";

  /** The key material a join hands over - nothing more. */
  function recipientReaderKey(handle: PublicationWriteHandle, recipientGroupId: string) {
    const group = handle.runtime.groupKeys.find((key) => key.groupId === recipientGroupId);
    expect(group, "the publication carries its recipient group's key").toBeDefined();
    return { groupId: group!.groupId, keyEpoch: group!.keyEpoch, privateKey: group!.hpke.privateKey };
  }

  /** A note sealed in the MAIN vault, addressed to the main vault's owner. */
  async function sealInMainVault(main: Pick<PersonalWorkspaceRuntime, "workspaceId" | "ownerGroup">) {
    return await sealInlinePvo1({
      workspaceId: main.workspaceId,
      objectId: "ab".repeat(16),
      revisionId: "cd".repeat(16),
      recipients: [{ groupId: main.ownerGroup.groupId, keyEpoch: main.ownerGroup.keyEpoch, publicKey: main.ownerGroup.hpke.publicKey }],
      metadata: {
        path: "Private/Salaries.md",
        mime: "text/markdown",
        parentObjectId: null,
        createdAt: "2026-08-26T08:00:00.000Z",
        modifiedAt: "2026-08-26T08:00:00.000Z",
        contentKind: "text",
      },
      plaintext: new TextEncoder().encode(SECRET),
    });
  }

  it("opens nothing in the main vault", async () => {
    const { handle, main } = await makePublication();
    const frame = await sealInMainVault(main);

    // `openPvo1Frame` throws rather than returning null, and deliberately does
    // not say WHICH binding failed - so the assertion is on the refusal, not on
    // an empty result somebody could mistake for a decode.
    await expect(openPvo1Frame(frame, [recipientReaderKey(handle, handle.recipientGroupId)])).rejects.toThrow(/no reader key/);
  });

  it("but the main vault's own key opens that very frame", async () => {
    // The red counter-probe. Without it the test above passes for the wrong
    // reason: a malformed frame, a changed header, anything that makes EVERY
    // key fail would read as "the boundary holds". This proves the frame is
    // sound and that only the recipient is shut out.
    const { main } = await makePublication();
    const frame = await sealInMainVault(main);
    const owner = main.ownerGroup;
    const opened = await openPvo1Frame(frame, [{ groupId: owner.groupId, keyEpoch: owner.keyEpoch, privateKey: owner.hpke.privateKey }]);
    expect(new TextDecoder().decode(opened.plaintext!)).toBe(SECRET);
  });

  it("stays shut out after being invited into the publication", async () => {
    // Being a recipient is the state in which somebody actually holds this key.
    // Deriving the boundary from an un-invited publication would test a door
    // nobody had walked through yet.
    const { handle, main } = await makePublication();
    const update = await invitePublicationRecipient({
      runtime: handle.runtime,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Reviewer",
    });
    applyWorkspaceGovernanceUpdate(handle.runtime, update);

    // What they CAN open: the publication.
    const published = await publishSliceObjectContent({
      handle,
      objects: [{ sourceObjectId: "c3".repeat(16), path: "Projects/Q3.md", text: "# Q3" }],
    });
    const reader = recipientReaderKey(handle, handle.recipientGroupId);
    const inside = await openPvo1Frame((await handle.store.get(published.writes[0].objectRemoteKey!))!, [reader]);
    expect(new TextDecoder().decode(inside.plaintext!)).toBe("# Q3");

    // What they cannot: anything from the vault the slice was cut from.
    await expect(openPvo1Frame(await sealInMainVault(main), [reader])).rejects.toThrow(/no reader key/);
  });
});

describe("one publication, start to finish", () => {
  /**
   * The lifecycle S8 asks for, in one run and with real crypto: create,
   * let a recipient in, change an object, watch the projection follow, drop
   * the object out of the slice, revoke the recipient.
   *
   * Every step above this in the file checks one link of that chain against
   * fakes. This one walks the whole chain once, because the links are joined
   * by state - a manifest that a refresh rewrites, a policy that a revoke
   * rotates - and a chain that holds link by link can still come apart at the
   * joints.
   */
  const READ = (handle: PublicationWriteHandle, groupId: string) => {
    const group = handle.runtime.groupKeys.find((key) => key.groupId === groupId)!;
    return { groupId: group.groupId, keyEpoch: group.keyEpoch, privateKey: group.hpke.privateKey };
  };

  it("walks the whole arc", async () => {
    // 1. Created, and a recipient let in.
    const { handle } = await makePublication();
    const invite = await invitePublicationRecipient({
      runtime: handle.runtime,
      recipientGroupId: handle.recipientGroupId,
      displayName: "Reviewer",
    });
    applyWorkspaceGovernanceUpdate(handle.runtime, invite);
    const reader = READ(handle, handle.recipientGroupId);

    // 2. An object published - and readable by the person it was published for.
    const first = await publishSliceObjectContent({
      handle,
      objects: [{ sourceObjectId: SOURCE_A, path: "Projects/Q3.md", text: "# Q3\n\nDraft." }],
    });
    const opened = await openPvo1Frame((await handle.store.get(first.writes[0].objectRemoteKey!))!, [reader]);
    expect(new TextDecoder().decode(opened.plaintext!)).toContain("Draft.");

    // 3. The source note changes. The publisher's manifest is the record of
    //    what the recipient has; the plan compares it against the slice and
    //    notices by REVISION, not by content, so an edit that happens to
    //    produce the same bytes still counts as one they have not seen.
    const manifest: PublicationManifest = {
      publicationId: handle.publicationId,
      sequence: first.lastSequence,
      previousOperationHash: first.lastOperationHash,
      objects: [{
        sourceObjectId: SOURCE_A,
        path: "Projects/Q3.md",
        sourceRevisionId: REV_1,
        publishedRevisionId: first.writes[0].revisionId!,
      }],
    };
    const changed = planPublicationRefresh({
      manifest,
      covered: [covered(SOURCE_A, "Projects/Q3.md", REV_2)],
    });
    expect(changed.map((entry) => entry.action)).toEqual(["republish"]);

    // 4. Republished, and the projection followed: the recipient's key opens
    //    the NEW text.
    const second = await publishSliceObjectContent({
      handle,
      fromSequence: first.lastSequence + 1,
      previousOperationHash: first.lastOperationHash,
      objects: [{ sourceObjectId: SOURCE_A, path: "Projects/Q3.md", text: "# Q3\n\nFinal." }],
    });
    const again = await openPvo1Frame((await handle.store.get(second.writes[0].objectRemoteKey!))!, [reader]);
    expect(new TextDecoder().decode(again.plaintext!)).toContain("Final.");
    // Same source note, same published object id - a recipient watching a
    // note over time sees one note, not two.
    expect(second.writes[0].objectId).toBe(first.writes[0].objectId);

    // 5. The note leaves the slice. Not a deletion in the vault - a withdrawal
    //    from this publication, which is why the plan retracts rather than deletes.
    expect(planPublicationRefresh({ manifest, covered: [] }).map((e) => e.action)).toEqual(["retract"]);

    // 6. The recipient is revoked. What they hold opens nothing minted after
    //    this point: the group's epoch moved, and the old private key has no
    //    binding to the new one.
    const before = handle.runtime.policy.payload.groups.find((g) => g.groupId === handle.recipientGroupId)!;
    const beforeKey = handle.runtime.groupKeys.find(
      (key) => key.groupId === handle.recipientGroupId && key.keyEpoch === before.keyEpoch,
    )!;
    applyWorkspaceGovernanceUpdate(
      handle.runtime,
      await revokePublicationRecipient({ runtime: handle.runtime, memberId: invite.memberId, reason: "left the project" }),
    );
    const after = handle.runtime.policy.payload.groups.find((g) => g.groupId === handle.recipientGroupId)!;
    expect(after.keyEpoch).toBe(before.keyEpoch + 1);

    // The rotated key comes out of the runtime rather than out of the policy
    // document, because that is the key the publisher would actually seal to.
    const rotated = handle.runtime.groupKeys.find(
      (key) => key.groupId === handle.recipientGroupId && key.keyEpoch === after.keyEpoch,
    );
    expect(rotated, "the rotation left a usable key behind").toBeDefined();

    const nextEpoch = await sealInlinePvo1({
      workspaceId: handle.runtime.workspaceId,
      objectId: "ef".repeat(16),
      revisionId: "01".repeat(16),
      recipients: [{ groupId: rotated!.groupId, keyEpoch: rotated!.keyEpoch, publicKey: rotated!.hpke.publicKey }],
      metadata: {
        path: "Projects/Q4.md",
        mime: "text/markdown",
        parentObjectId: null,
        createdAt: "2026-08-26T09:00:00.000Z",
        modifiedAt: "2026-08-26T09:00:00.000Z",
        contentKind: "text",
      },
      plaintext: new TextEncoder().encode("# Q4"),
    });
    await expect(openPvo1Frame(nextEpoch, [reader])).rejects.toThrow(/no reader key/);

    // Red counter-probe. The same seal, addressed to the epoch the recipient
    // actually holds, opens - so the line above fails because the epoch moved,
    // not because sealing to this group stopped working at all.
    const sameEpoch = await sealInlinePvo1({
      workspaceId: handle.runtime.workspaceId,
      objectId: "ef".repeat(16),
      revisionId: "02".repeat(16),
      recipients: [{ groupId: beforeKey.groupId, keyEpoch: beforeKey.keyEpoch, publicKey: beforeKey.hpke.publicKey }],
      metadata: {
        path: "Projects/Q4.md",
        mime: "text/markdown",
        parentObjectId: null,
        createdAt: "2026-08-26T09:00:00.000Z",
        modifiedAt: "2026-08-26T09:00:00.000Z",
        contentKind: "text",
      },
      plaintext: new TextEncoder().encode("# Q4"),
    });
    expect(new TextDecoder().decode((await openPvo1Frame(sameEpoch, [reader])).plaintext!)).toBe("# Q4");
  });
});

/**
 * Reading back what the recipients wrote (D7).
 *
 * Everything up to here moves in one direction: the publisher projects notes
 * out. This is the return leg, and without it a recipient's comment is a file
 * that is correctly encrypted, correctly signed, and never seen by anybody.
 */
describe("collectPublicationComments", () => {
  const NOW = "2026-08-27T10:00:00.000Z";

  /** A publication with one note in it and one paired recipient device. */
  async function published(over: Partial<PublicationDraft> = {}) {
    const made = await makePublication({ mode: "exact", access: "comment", ...over });
    const invite = await invitePublicationRecipient({
      runtime: made.handle.runtime,
      recipientGroupId: made.handle.recipientGroupId,
      displayName: "Reviewer",
    });
    applyWorkspaceGovernanceUpdate(made.handle.runtime, invite);

    const empty = emptyPublicationManifest(made.handle.publicationId);
    const refreshed = await runPublicationRefresh({
      handle: made.handle,
      manifest: empty,
      plan: planPublicationRefresh({ manifest: empty, covered: [covered(SOURCE_A, "Projects/Q3.md", REV_1)] }),
      project: async () => ({ text: "# Q3\n\nShipped." }),
    });

    // A real second device, not a hand-forged document: the point of the
    // collector is the verification chain, and a fake operation would walk
    // straight past the part being tested.
    const request = await createWorkspacePairingRequest({
      workspaceId: made.handle.runtime.workspaceId,
      workspaceFingerprint: workspaceDocumentHash(made.handle.runtime.genesis),
      memberId: invite.memberId,
      deviceDisplayName: "Reviewer laptop",
      platform: "desktop",
      now: "2026-08-27T09:00:00.000Z",
    });
    const beforePairing = made.handle.runtime.policy;
    const approval = await approveWorkspacePairing({ token: request.token, runtime: made.handle.runtime, now: "2026-08-27T09:01:00.000Z" });
    const reviewer = await acceptWorkspacePairing({ created: request, genesis: made.handle.runtime.genesis, previousPolicy: beforePairing, approval, now: "2026-08-27T09:02:00.000Z" });
    // The approval mints the successor; the approving runtime has to adopt it,
    // or its own policy still has no record of the device it just admitted.
    made.handle.runtime.policy = approval.policy;

    return {
      ...made,
      memberId: invite.memberId,
      reviewer,
      beforePairing,
      manifest: refreshed.manifest,
      publishedRevisionId: refreshed.manifest.objects[0].publishedRevisionId,
    };
  }

  /** Seals the way a recipient can: to the recipient group's public key from the policy. */
  async function comment(
    ctx: Awaited<ReturnType<typeof published>>,
    over: {
      targetObjectId?: string;
      body?: string;
      suggestion?: { replacement: string } | null;
      anchor?: WorkspaceCommentAnchor | null;
    } = {},
  ) {
    const group = ctx.handle.runtime.policy.payload.groups.find((entry) => entry.groupId === ctx.handle.recipientGroupId)!;
    const prepared = await prepareWorkspaceComment({
      runtime: ctx.reviewer,
      policyHash: workspaceDocumentHash(ctx.reviewer.policy),
      sequence: 1,
      previousDeviceOperationHash: null,
      targetObjectId: over.targetObjectId ?? derivePublishedObjectId(ctx.handle.publicationId, SOURCE_A),
      targetRevisionId: ctx.publishedRevisionId,
      body: over.body ?? "The date in the second paragraph is wrong.",
      anchor: over.anchor ?? null,
      suggestion: over.suggestion ?? null,
      recipients: [{ groupId: group.groupId, keyEpoch: group.keyEpoch, publicKey: decodeBase64Exact(group.hpkePublicKey, 32, "recipient group key") }],
      now: NOW,
    });
    await publishWorkspaceComment(ctx.handle.store, prepared);
    return prepared;
  }

  const collect = (
    ctx: Awaited<ReturnType<typeof published>>,
    over: Partial<Parameters<typeof collectPublicationComments>[0]> = {},
  ) =>
    collectPublicationComments({
      publicationId: ctx.handle.publicationId,
      runtime: ctx.handle.runtime,
      store: ctx.handle.store,
      manifest: ctx.manifest,
      mode: "exact",
      ...over,
    });

  it("brings a recipient's comment home under the source id", async () => {
    // `derivePublishedObjectId` is one-way on purpose, so a recipient holding
    // two publications cannot tell which notes they have in common. The
    // publisher is the one party who has the inputs, so the map is built
    // forwards from the manifest and read backwards - which is also why an
    // unknown target is simply not theirs to show.
    const ctx = await published();
    const written = await comment(ctx);

    const collected = await collect(ctx);
    expect(collected).toHaveLength(1);
    expect(collected[0].comment.commentId).toBe(written.comment.commentId);
    expect(collected[0].comment.targetObjectId).toBe(SOURCE_A);
    expect(collected[0].comment.body).toBe("The date in the second paragraph is wrong.");
    expect(collected[0].path).toBe("Projects/Q3.md");
    // A recipient is not a member of the main vault, so the sidebar's usual
    // name map cannot resolve them - the publication's own policy has to.
    expect(collected[0].authorDisplayName).toBe("Reviewer");
    expect(collected[0].authorActive).toBe(true);
  });

  it("leaves the publisher's own remarks out of the column", async () => {
    // The column answers one question: what did the RECIPIENTS say. The
    // publisher holds the recipient group's keys, so their own comment in this
    // workspace opens just as readily - only the author tells them apart.
    const ctx = await published();
    const group = ctx.handle.runtime.policy.payload.groups.find((entry) => entry.groupId === ctx.handle.recipientGroupId)!;
    const own = await prepareWorkspaceComment({
      runtime: ctx.handle.runtime,
      policyHash: workspaceDocumentHash(ctx.handle.runtime.policy),
      sequence: 1,
      previousDeviceOperationHash: null,
      targetObjectId: derivePublishedObjectId(ctx.handle.publicationId, SOURCE_A),
      targetRevisionId: ctx.publishedRevisionId,
      body: "Note to self: check the figure.",
      anchor: null,
      suggestion: null,
      recipients: [{
        groupId: group.groupId,
        keyEpoch: group.keyEpoch,
        publicKey: decodeBase64Exact(group.hpkePublicKey, 32, "recipient group key"),
      }],
      now: NOW,
    });
    await publishWorkspaceComment(ctx.handle.store, own);

    expect(await collect(ctx)).toEqual([]);
  });

  it("shows a remark from someone the publication only let read, and says so", async () => {
    // Anyone in the group can write into the folder; the capability decides
    // whether they were entitled to. Dropping such a comment would hide from
    // the publisher that someone is writing where they should not - so it is
    // shown, and marked.
    const ctx = await published({ access: "read" });
    await comment(ctx, { body: "May I suggest a different order?" });

    const collected = await collect(ctx);
    expect(collected).toHaveLength(1);
    expect(collected[0].comment.body).toBe("May I suggest a different order?");
    expect(collected[0].authorActive).toBe(false);
  });

  it("loses a recipient's earlier remarks once their access is withdrawn", async () => {
    // Not a decision of the collector: withdrawing access rotates the recipient
    // group, and the rotation replaces the epoch instead of archiving it
    // (governance.ts). The publisher no longer holds the key the comment was
    // sealed to, so it cannot be opened - the same property the main vault has
    // after any revocation. The durable fix belongs to the WRITER: a recipient
    // can seal to the publisher's owner group as well, because a PVO1 recipient
    // needs only a public key and the policy carries one for every group.
    const ctx = await published();
    await comment(ctx);
    expect(await collect(ctx)).toHaveLength(1);

    const revoked = await revokePublicationRecipient({
      runtime: ctx.handle.runtime,
      memberId: ctx.memberId,
      reason: "review finished",
    });
    applyWorkspaceGovernanceUpdate(ctx.handle.runtime, revoked);

    expect(await collect(ctx)).toEqual([]);
  });

  it("drops a comment aimed at something the publication never carried", async () => {
    const ctx = await published();
    await comment(ctx, { targetObjectId: "cc".repeat(16) });
    expect(await collect(ctx)).toEqual([]);
  });

  it("narrows to one note when the column asks for one", async () => {
    const ctx = await published();
    await comment(ctx);
    expect(await collect(ctx, { sourceObjectIds: [SOURCE_B] })).toEqual([]);
    expect(await collect(ctx, { sourceObjectIds: [SOURCE_A] })).toHaveLength(1);
  });

  it("ignores an operation from a device the policy does not list", async () => {
    // Anybody who can write to the shared folder can drop a file in it. A
    // signature is only worth as much as the check that the signer belongs
    // here, so this runs the collector against the policy from BEFORE the
    // pairing: the same bytes, the same valid signature, an unknown device.
    //
    // Two guards catch this independently - the device lookup and the
    // signature check, which has no key to verify against once the device is
    // gone. Removing either alone leaves this green; removing both fails it.
    // The assertion measures the behaviour, not one particular guard.
    const ctx = await published();
    await comment(ctx);
    expect(await collect(ctx, { runtime: { ...ctx.handle.runtime, policy: ctx.beforePairing } })).toEqual([]);
  });

  it("shows a suggestion from a sanitized publication but never offers to apply it", async () => {
    // A sanitized projection is different text: excluded links become plain
    // words, excluded embeds are gone. A character range into it does not
    // address the same characters in the source, so applying it would be a
    // guess - and throwing the feedback away would be worse than showing it.
    const ctx = await published({ mode: "sanitized", access: "suggest" });
    await comment(ctx, {
      body: "Wrong quarter.",
      // The real anchor the editor writes: marker id, quote and its context.
      anchor: buildCommentAnchor("# Q3\n\nShipped.", 2, 4, "0a1b"),
      suggestion: { replacement: "Q4" },
    });

    const sanitized = await collect(ctx, { mode: "sanitized" });
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].comment.suggestion?.replacement).toBe("Q4");
    expect(sanitized[0].suggestionApplicable).toBe(false);
    // The same suggestion against an exact projection addresses the characters
    // the source really has, and may be offered.
    expect((await collect(ctx, { mode: "exact" }))[0].suggestionApplicable).toBe(true);
  });
});
