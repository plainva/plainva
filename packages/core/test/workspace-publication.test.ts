import { describe, expect, it } from "vitest";
import {
  FakeWorkspaceObjectStore,
  PublishedSliceObjectStore,
  derivePublicationId,
  publicationStoreFor,
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
