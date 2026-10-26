// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { VaultIndexer } from "@plainva/core";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { ExternalVaultAdapter } from "./ExternalVaultAdapter";
import { fakeVaultFolder } from "./fakeVaultFolder";
import { FolderNoAnswerError, isFolderNoAnswer, withFolderDeadlines } from "./folderAnswerDeadline";
import type { VaultFolderNative } from "../platform/vaultFolder";

/**
 * A folder that stops answering (issue 143). A provider behind Android's
 * Storage Access Framework that hangs left a call open for good, and the first
 * scan of a new folder vault waited on it before the app drew anything: a
 * blank screen that never ended. Small deadlines here; the real ones are in
 * `DEFAULT_FOLDER_DEADLINES`.
 */

const never = <T,>() => new Promise<T>(() => {});
const SHORT = { lookMs: 25, readMs: 25 };

/** The fake folder, with the calls named in `hang` never answering. */
function hangingFolder(files: Map<string, string>, hang: { read?: string[]; list?: string[] }) {
  const { plugin, dirs } = fakeVaultFolder(files);
  const hanging: VaultFolderNative = {
    ...plugin,
    read: (opts) => (hang.read?.includes(opts.path) ? never() : plugin.read(opts)),
    list: (opts) => (hang.list?.includes(opts.path) ? never() : plugin.list(opts)),
  };
  return { plugin: hanging, dirs };
}

describe("a call into a picked folder that does not answer", () => {
  it("fails after its deadline, naming the call and the path", async () => {
    const onStalled = vi.fn();
    const { plugin } = hangingFolder(new Map([["Stuck.md", "x"]]), { read: ["Stuck.md"] });
    const folder = withFolderDeadlines(plugin, { deadlines: SHORT, onStalled });
    const error = await folder.read({ handle: "h", path: "Stuck.md" }).catch((e: unknown) => e);
    expect(isFolderNoAnswer(error)).toBe(true);
    expect((error as FolderNoAnswerError).path).toBe("Stuck.md");
    expect((error as Error).message).toContain("Stuck.md");
    expect(onStalled).toHaveBeenCalledWith("read", "Stuck.md", SHORT.readMs);
  });

  it("refuses every call at once while the folder is stalled and one probe is out, and talks again on any answer", async () => {
    let release: (() => void) | null = null;
    const answers: VaultFolderNative = {
      ...fakeVaultFolder(new Map([["A.md", "a"], ["B.md", "b"]])).plugin,
    };
    const base = answers.read;
    let calls = 0;
    answers.read = (opts) => {
      calls++;
      // The first call hangs, the second (the probe) waits until released.
      if (calls === 1) return never();
      if (calls === 2) return new Promise((resolve) => { release = () => void base(opts).then(resolve); });
      return base(opts);
    };
    const onRecovered = vi.fn();
    const folder = withFolderDeadlines(answers, { deadlines: { lookMs: 1000, readMs: 25 }, onRecovered });
    await expect(folder.read({ handle: "h", path: "A.md" })).rejects.toBeInstanceOf(FolderNoAnswerError);
    // Stalled: the next call goes out as a probe ...
    const probe = folder.read({ handle: "h", path: "A.md" });
    // ... and every call while it is out is refused without being sent.
    const refused = await folder.read({ handle: "h", path: "B.md" }).catch((e: unknown) => e);
    expect((refused as FolderNoAnswerError).refused).toBe(true);
    expect(calls).toBe(2);
    release!();
    await expect(probe).resolves.toEqual({ dataBase64: btoa("a") });
    expect(onRecovered).toHaveBeenCalledWith(1);
    // Answering again: calls go out as before.
    await expect(folder.read({ handle: "h", path: "B.md" })).resolves.toEqual({ dataBase64: btoa("b") });
    expect(calls).toBe(3);
  });

  it("fails every open look at once when the vault closes", async () => {
    const { plugin } = hangingFolder(new Map([["Stuck.md", "x"]]), { read: ["Stuck.md"] });
    const closing = new AbortController();
    const folder = withFolderDeadlines(plugin, { deadlines: { lookMs: 60_000, readMs: 60_000 }, signal: closing.signal });
    const open = folder.read({ handle: "h", path: "Stuck.md" });
    closing.abort();
    await expect(open).rejects.toBeInstanceOf(FolderNoAnswerError);
    await expect(folder.stat({ handle: "h", path: "Stuck.md" })).rejects.toBeInstanceOf(FolderNoAnswerError);
  });

  it("never puts a deadline on a call that changes the folder", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const { plugin } = fakeVaultFolder(new Map());
      const slow: VaultFolderNative = { ...plugin, write: (opts) => new Promise((resolve) => setTimeout(() => { done = true; void plugin.write(opts).then(resolve); }, 10 * 60_000)) };
      const folder = withFolderDeadlines(slow, { deadlines: SHORT });
      const write = folder.write({ handle: "h", path: "A.md", dataBase64: btoa("a") });
      let failed = false;
      write.catch(() => { failed = true; });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(failed).toBe(false);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await write;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the first scan of a folder vault finish, naming what did not answer", async () => {
    // A note whose read never answers and a folder whose listing never answers:
    // the scan used to wait for them for good.
    const files = new Map([["Home.md", "# Home"], ["Stuck.md", "# Stuck"], ["Deep/Gone.md", "# Gone"], ["Other/Fine.md", "# Fine"]]);
    const { plugin } = hangingFolder(files, { read: ["Stuck.md"], list: ["Deep"] });
    const adapter = new ExternalVaultAdapter(plugin, "h", { deadlines: SHORT });
    const db = await realSqlite();
    try {
      const report = await new VaultIndexer(adapter, db).indexVaultFull("test");
      const indexed = (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);
      expect(indexed).toContain("Home.md");
      expect(indexed).toContain("Other/Fine.md");
      expect(indexed).not.toContain("Stuck.md");
      expect(report.skipped.map((s) => s.path).sort()).toEqual(["Deep", "Stuck.md"]);
    } finally {
      await db.close();
    }
  });
});
