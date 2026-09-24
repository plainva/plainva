import { describe, expect, it } from "vitest";
import { mapNativeWatchBatch, WATCH_RESCAN_MARKER } from "./TauriVaultAdapter";

/**
 * Issue 110 (E8): the native watcher reports every path of every event —
 * FSEvents delivers the two sides of a move unpaired, and sometimes only the
 * target. Each path becomes an event with its kind; the kind is what tells
 * VaultContext to reconcile the parent folder.
 */
describe("mapNativeWatchBatch", () => {
  const roots = ["/private/var/vaults/md-handbook", "/var/vaults/md-handbook"];

  it("keeps a rename that carries only its target", () => {
    const { events } = mapNativeWatchBatch(
      [{ kind: "rename", paths: ["/private/var/vaults/md-handbook/4 blog/taken/link-50.md"] }],
      roots,
    );
    expect(events).toEqual([{ path: "4 blog/taken/link-50.md", type: "rename" }]);
  });

  it("keeps both sides of an unpaired move, in order", () => {
    const { events } = mapNativeWatchBatch(
      [
        { kind: "rename", paths: ["/var/vaults/md-handbook/4 blog/link-50.md"] },
        { kind: "rename", paths: ["/private/var/vaults/md-handbook/4 blog/taken/link-50.md"] },
        { kind: "remove", paths: ["/var/vaults/md-handbook/old.md"] },
        { kind: "create", paths: ["/var/vaults/md-handbook/new.md"] },
        { kind: "modify", paths: ["/var/vaults/md-handbook/new.md"] },
      ],
      roots,
    );
    expect(events).toEqual([
      { path: "4 blog/link-50.md", type: "rename" },
      { path: "4 blog/taken/link-50.md", type: "rename" },
      { path: "old.md", type: "remove" },
      { path: "new.md", type: "create" },
      { path: "new.md", type: "modify" },
    ]);
  });

  it("surfaces errors and asks for a full reconcile instead of dropping them", () => {
    const { events, errors } = mapNativeWatchBatch([{ kind: "error", paths: [], message: "FSEvents stream dropped" }], roots);
    expect(errors).toEqual(["FSEvents stream dropped"]);
    expect(events).toEqual([{ path: WATCH_RESCAN_MARKER, type: "any" }]);
  });

  it("turns a rescan notice, an unknown kind and a foreign path into the rescan marker", () => {
    const { events } = mapNativeWatchBatch(
      [
        { kind: "rescan", paths: ["/var/vaults/md-handbook/sub"] },
        { kind: "mystery", paths: ["/var/vaults/md-handbook/a.md"] },
        { kind: "create", paths: ["/elsewhere/a.md"] },
      ],
      roots,
    );
    expect(events).toEqual([
      { path: WATCH_RESCAN_MARKER, type: "any" },
      { path: WATCH_RESCAN_MARKER, type: "any" },
      { path: WATCH_RESCAN_MARKER, type: "any" },
    ]);
  });

  it("ignores reads, which the indexer causes itself", () => {
    expect(mapNativeWatchBatch([{ kind: "access", paths: ["/var/vaults/md-handbook/a.md"] }], roots).events).toEqual([]);
  });
});
