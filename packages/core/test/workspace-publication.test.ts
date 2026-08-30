import { describe, expect, it } from "vitest";
import {
  FakeWorkspaceObjectStore,
  MemoryWorkspaceStateStore,
  PublishedSliceObjectStore,
  createPersonalWorkspaceBootstrap,
  createPublication,
  derivePublishedObjectId,
  decodeWorkspaceInvite,
  decodePublicationCard,
  derivePublicationId,
  emptyPublicationManifest,
  evaluateWorkspaceAccess,
  openPvo1Frame,
  parsePvo1Frame,
  parseWorkspaceDocument,
  personalWorkspaceRuntime,
  planPublicationRefresh,
  publicationRecipients,
  publicationStoreFor,
  invitePublicationRecipient,
  publishSliceObjectContent,
  publishedSliceAccessCapabilities,
  refreshWorkspacePublications,
  runPublicationRefresh,
  workspaceRecipientGroupIds,
  type PublicationManifest,
  type PublicationWriteHandle,
  type PublishedSliceConfig,
  type WorkspaceObjectRecord,
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
      openPublication: async () => handle,
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
    const { handle } = await makePublication();
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
      openPublication: async () => { throw new Error("must not open"); },
    });

    expect(outcomes[0]).toEqual({ publicationId: handle.publicationId, planned: 0, applied: 0, error: null, skipped: "no-slice" });
    expect(state.saved).toEqual([]);
  });

  it("does not call a missing key a failure", async () => {
    // The publisher's other device holds the key and refreshes this fine.
    // Writing an error here would show a broken publication to someone who
    // cannot do anything about it.
    const { handle } = await makePublication();
    const state = fakeState([makeRecord(handle)], [object({ objectId: OBJ_TEXT, path: "Projects/Q3.md" })]);

    const outcomes = await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "# Q3" },
      policy: { slices: [slice([OBJ_TEXT])] },
      openPublication: async () => null,
    });

    expect(outcomes[0]).toEqual({ publicationId: handle.publicationId, planned: 1, applied: 0, error: null, skipped: "no-key" });
    expect(state.saved).toEqual([]);
  });

  it("clears a stale reason once nothing is left to publish", async () => {
    // A publication that recovered must stop reporting last week's outage.
    const { handle } = await makePublication();
    const state = fakeState([makeRecord(handle, { lastError: "provider rejected the upload" })], []);

    const outcomes = await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "" },
      policy: { slices: [slice([])] },
      openPublication: async () => { throw new Error("must not open"); },
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
    const { handle } = await makePublication();
    const state = fakeState([makeRecord(handle)], []);

    await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "" },
      policy: { slices: [slice([])] },
      openPublication: async () => { throw new Error("must not open"); },
    });

    expect(state.saved).toEqual([]);
  });

  it("stops on a failure and keeps the reason where a person can be shown it", async () => {
    // Nobody watches a background cycle. Carrying on past the failure would
    // report the refresh as done while the second note quietly kept its old
    // text - so the run stops, and the record says why.
    const { handle } = await makePublication();
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
      openPublication: async () => handle,
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
    const { handle } = await makePublication();
    const objects = [
      object({ objectId: OBJ_TEXT, path: "Projects/A.md" }),
      object({ objectId: OBJ_BINARY, path: "Projects/B.md", contentKind: "text" }),
    ];
    const state = fakeState([makeRecord(handle)], objects);

    await refreshWorkspacePublications({
      state: state.store,
      vault: { readTextFile: async () => "# Note" },
      policy: { slices: [slice([OBJ_TEXT, OBJ_BINARY])] },
      openPublication: async () => handle,
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
      openPublication: async () => sanitized.handle,
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
      openPublication: async () => exact.handle,
    });
    const exactWrite = exactState.saved.at(-1)!.manifest.objects[0];
    expect(await readPublishedText(exact, exactWrite.sourceObjectId)).toBe(markdown);
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
