import { describe, it, expect, vi } from "vitest";
import { loadGraphCached } from "./graphCache";
import type { GraphService } from "@plainva/core";

const makeService = () => {
  const loadGraph = vi.fn(async () => ({ nodes: new Map(), edges: [] }));
  return { svc: { loadGraph } as unknown as GraphService, loadGraph };
};

describe("loadGraphCached (P2.6)", () => {
  it("reuses the promise for the same index version (file switches are hits)", async () => {
    const { svc, loadGraph } = makeService();
    const a = loadGraphCached(svc, 7);
    const b = loadGraphCached(svc, 7);
    expect(a).toBe(b);
    await a;
    expect(loadGraph).toHaveBeenCalledTimes(1);
  });

  it("reloads when the index version bumps", async () => {
    const { svc, loadGraph } = makeService();
    await loadGraphCached(svc, 1);
    await loadGraphCached(svc, 2);
    expect(loadGraph).toHaveBeenCalledTimes(2);
  });

  it("caches per option set (attachments on/off do not collide)", async () => {
    const { svc, loadGraph } = makeService();
    await loadGraphCached(svc, 1, { includeAttachments: false });
    await loadGraphCached(svc, 1, { includeAttachments: true });
    await loadGraphCached(svc, 1, { includeAttachments: true });
    expect(loadGraph).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed load as a poisoned entry", async () => {
    const loadGraph = vi
      .fn()
      .mockRejectedValueOnce(new Error("db locked"))
      .mockResolvedValueOnce({ nodes: new Map(), edges: [] });
    const svc = { loadGraph } as unknown as GraphService;

    await expect(loadGraphCached(svc, 3)).rejects.toThrow("db locked");
    // Give the internal catch-cleanup a microtask to run.
    await Promise.resolve();
    await expect(loadGraphCached(svc, 3)).resolves.toBeDefined();
    expect(loadGraph).toHaveBeenCalledTimes(2);
  });
});
