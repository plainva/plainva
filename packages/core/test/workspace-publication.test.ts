import { describe, expect, it } from "vitest";
import {
  FakeWorkspaceObjectStore,
  PublishedSliceObjectStore,
  createPersonalWorkspaceBootstrap,
  createPublication,
  decodePublicationCard,
  derivePublicationId,
  derivePublishedObjectId,
  openPvo1Frame,
  parsePvo1Frame,
  parseWorkspaceDocument,
  personalWorkspaceRuntime,
  publicationStoreFor,
  publishSliceObjectContent,
  publishedSliceAccessCapabilities,
  workspaceRecipientGroupIds,
  type PublishedSliceConfig,
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
    expect(keys).toContain(nested(write.objectRemoteKey));
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
    const bytes = await handle.store.get(result.writes[0].objectRemoteKey);
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
    const bytes = await handle.store.get(result.writes[0].objectRemoteKey);
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
    const opened = await openPvo1Frame((await handle.store.get(result.writes[0].objectRemoteKey))!, [
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
