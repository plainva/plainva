import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  noteVaultTeardown,
  awaitVaultTeardown,
  pendingVaultTeardowns,
  resetVaultTeardownsForTests,
} from "./vaultTeardown";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("opening a vault waits for its own teardown", () => {
  beforeEach(() => resetVaultTeardownsForTests());

  it("holds the next open until the drain finishes", async () => {
    const drain = deferred();
    noteVaultTeardown("/vault/a", drain.promise);

    let opened = false;
    const open = awaitVaultTeardown("/vault/a").then(() => { opened = true; });

    await Promise.resolve();
    // Draining is the whole point of parking this promise: a second worker
    // starting here would run over the same queue as the one still finishing.
    expect(opened).toBe(false);

    drain.resolve();
    await open;
    expect(opened).toBe(true);
  });

  it("does not hold up a different vault", async () => {
    const drain = deferred();
    noteVaultTeardown("/vault/a", drain.promise);
    await expect(awaitVaultTeardown("/vault/b")).resolves.toBeUndefined();
    drain.resolve();
    await awaitVaultTeardown("/vault/a");
  });

  it("releases the wait even when the drain fails", async () => {
    const drain = deferred();
    noteVaultTeardown("/vault/a", drain.promise);
    drain.reject(new Error("worker blew up"));
    // A teardown that throws must not lock the vault out of being reopened;
    // the failure was reported where it happened.
    await expect(awaitVaultTeardown("/vault/a")).resolves.toBeUndefined();
  });

  it("forgets the vault once the drain settled", async () => {
    const drain = deferred();
    noteVaultTeardown("/vault/a", drain.promise);
    expect(pendingVaultTeardowns()).toEqual(["/vault/a"]);
    drain.resolve();
    await awaitVaultTeardown("/vault/a");
    expect(pendingVaultTeardowns()).toEqual([]);
  });

  it("keeps the newest teardown when a vault is closed twice in a row", async () => {
    const first = deferred();
    const second = deferred();
    noteVaultTeardown("/vault/a", first.promise);
    noteVaultTeardown("/vault/a", second.promise);

    first.resolve();
    await first.promise;
    await Promise.resolve();

    let opened = false;
    const open = awaitVaultTeardown("/vault/a").then(() => { opened = true; });
    await Promise.resolve();
    // The first drain settling must not release a wait that belongs to the
    // second one - otherwise the older entry deleting itself would hand the
    // vault over mid-drain.
    expect(opened).toBe(false);

    second.resolve();
    await open;
    expect(opened).toBe(true);
    expect(pendingVaultTeardowns()).toEqual([]);
  });
});

/**
 * The wiring, read from the source.
 *
 * What happens when the last window looking at a vault goes away cannot be
 * asserted through the provider: `VaultContext` is a 2000-line component whose
 * teardown runs in a React unmount cleanup. So this reads the three lines the
 * behaviour hangs on. It proves that the calls are THERE, not that they run in
 * the right order at runtime - the ordering argument lives in the comments next
 * to them, and the drain itself is covered by the unit tests above.
 */
describe("the closing window drains its vault", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  it("settles pending writes and the running cycle in the teardown", () => {
    const source = read("contexts/VaultContext.tsx");
    const start = source.indexOf("const teardownVault = async () => {");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n  };", start));

    // `stop()` alone leaves a half-written note and a mid-flight cycle hanging
    // in the air while the app keeps running with another vault open.
    expect(body).toContain("settlePendingWrites(path)");
    expect(body).toContain("stopAndDrain()");
    expect(body).toContain("noteVaultTeardown(path, drain)");
  });

  it("makes the next open of that vault wait for the drain", () => {
    const source = read("contexts/VaultContext.tsx");
    const wait = source.indexOf("await awaitVaultTeardown(path)");
    expect(wait).toBeGreaterThan(-1);
    // Inside loadVault, not somewhere else: draining without this wait would
    // create the race it prevents.
    expect(wait).toBeGreaterThan(source.indexOf("const loadVault = async ("));
    expect(wait).toBeLessThan(source.indexOf("const teardownVault = async () => {"));
  });

  it("keeps the editor's in-flight writes in the shared registry", () => {
    const source = read("components/Editor.tsx");
    // A local map here would be invisible to the teardown: the vault would count
    // as gone while a note was still being written.
    expect(source).toContain('from "../services/pendingWrites"');
    expect(source).not.toContain("new Map<string, Promise<void>>()");
  });
});
