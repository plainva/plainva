import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { VaultFileNotFoundError, VaultFileExistsError, VaultPermissionDeniedError, WatchEvent } from "../src/vault/IVaultAdapter.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("LocalVaultAdapter", () => {
  let tmpDir: string;
  let adapter: LocalVaultAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-test-"));
    adapter = new LocalVaultAdapter(tmpDir);
    await adapter.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("requires an absolute path", () => {
    expect(() => new LocalVaultAdapter("./relative")).toThrow();
  });

  it("can read and write text files", async () => {
    await adapter.writeTextFile("folder/test.md", "Hello World");
    const content = await adapter.readTextFile("folder/test.md");
    expect(content).toBe("Hello World");
  });

  it("can read and write binary files", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await adapter.writeBinaryFile("data.bin", data);
    const readData = await adapter.readBinaryFile("data.bin");
    expect(readData).toEqual(data);
  });

  it("throws VaultFileNotFoundError when reading non-existent file", async () => {
    await expect(adapter.readTextFile("missing.md")).rejects.toThrow(VaultFileNotFoundError);
  });

  it("can create directories", async () => {
    await adapter.createDir("some/deep/folder");
    const exists = await adapter.exists("some/deep/folder");
    expect(exists).toBe(true);
  });

  it("can check existence of files", async () => {
    expect(await adapter.exists("file.txt")).toBe(false);
    await adapter.writeTextFile("file.txt", "data");
    expect(await adapter.exists("file.txt")).toBe(true);
  });

  it("can delete files", async () => {
    await adapter.writeTextFile("file.txt", "data");
    await adapter.deleteItem("file.txt");
    expect(await adapter.exists("file.txt")).toBe(false);
  });

  it("can delete directories recursively", async () => {
    await adapter.writeTextFile("folder/file.txt", "data");
    await adapter.deleteItem("folder", true);
    expect(await adapter.exists("folder")).toBe(false);
  });

  it("can rename files", async () => {
    await adapter.writeTextFile("old.txt", "data");
    await adapter.renameItem("old.txt", "new.txt");
    expect(await adapter.exists("old.txt")).toBe(false);
    expect(await adapter.readTextFile("new.txt")).toBe("data");
  });

  it("prevents renaming over existing file", async () => {
    await adapter.writeTextFile("a.txt", "data");
    await adapter.writeTextFile("b.txt", "data2");
    await expect(adapter.renameItem("a.txt", "b.txt")).rejects.toThrow(VaultFileExistsError);
  });

  it("can get file info", async () => {
    await adapter.writeTextFile("test.txt", "12345");
    const info = await adapter.getFileInfo("test.txt");
    expect(info.name).toBe("test.txt");
    expect(info.path).toBe("test.txt");
    expect(info.isDirectory).toBe(false);
    expect(info.size).toBe(5);
    expect(info.mtime).toBeGreaterThan(0);
  });

  it("can list directory contents", async () => {
    await adapter.writeTextFile("a.txt", "A");
    await adapter.writeTextFile("folder/b.txt", "B");
    
    // Non-recursive
    const rootList = await adapter.listDir("");
    expect(rootList.length).toBe(2);
    const names = rootList.map(i => i.name).sort();
    expect(names).toEqual(["a.txt", "folder"]);

    // Recursive
    const recList = await adapter.listDir("", true);
    expect(recList.length).toBe(3);
    const recPaths = recList.map(i => i.path).sort();
    expect(recPaths).toEqual(["a.txt", "folder", "folder/b.txt"]);
  });

  it("prevents path traversal escaping the vault", async () => {
    await expect(adapter.readTextFile("../../../../etc/passwd")).rejects.toThrow(VaultPermissionDeniedError);
    await expect(adapter.writeTextFile("../outside.txt", "data")).rejects.toThrow(VaultPermissionDeniedError);
  });

  // Node's recursive fs.watch is backed by macOS FSEvents, whose stream arms
  // asynchronously *after* watch() resolves and whose delivery coalesces under
  // load. A single write fired right after arming can therefore land before the
  // stream is live and be lost forever, and even a delivered event can lag past
  // a tight cap on a busy CI runner — which is why the old single-write / 2s
  // version flaked the macOS release job. The fix is pure test harness: keep
  // re-writing until the event is observed (defeating the arming race) under a
  // generous ceiling. `retry` is a last-resort net so a pathological one-off
  // stall can never fail a release; the per-test timeout sits above
  // WATCH_TIMEOUT_MS so our descriptive error wins over Vitest's default.
  it("can watch for file changes", { retry: 2, timeout: 15000 }, async () => {
    const WATCH_TIMEOUT_MS = 10000;
    const WRITE_INTERVAL_MS = 100;

    let unwatch: (() => void) | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const eventReceived = new Promise<void>((resolve) => {
        const checkEvent = (events: WatchEvent[]) => {
          if (events.some((e) => e.path.includes("watch-test.txt"))) {
            resolve();
          }
        };
        adapter.watch(checkEvent).then((u) => {
          unwatch = u;
          // Re-issue the write until the watcher reports it, so the test never
          // depends on winning the FSEvents startup race. Swallow write errors:
          // during teardown the temp dir may already be gone.
          let n = 0;
          const trigger = () => {
            void adapter.writeTextFile("watch-test.txt", `changed ${n++}`).catch(() => {});
          };
          trigger();
          pollTimer = setInterval(trigger, WRITE_INTERVAL_MS);
        });
      });

      const timeout = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => reject(new Error("Watch event timeout")), WATCH_TIMEOUT_MS);
      });

      await Promise.race([eventReceived, timeout]);
    } finally {
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (unwatch) unwatch();
    }
  });
});
