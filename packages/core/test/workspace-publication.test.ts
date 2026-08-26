import { describe, expect, it } from "vitest";
import {
  FakeWorkspaceObjectStore,
  PublishedSliceObjectStore,
  createPersonalWorkspaceBootstrap,
  createPublication,
  decodePublicationCard,
  derivePublicationId,
  personalWorkspaceRuntime,
  publicationStoreFor,
  publishedSliceAccessCapabilities,
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
