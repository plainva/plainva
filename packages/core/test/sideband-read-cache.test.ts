import { describe, expect, it, vi } from "vitest";
import { SidebandReadCache } from "../src/sync/sidebandReadCache.js";
import type { ISyncTarget } from "../src/sync/ISyncTarget.js";

describe("sideband conditional reads", () => {
  it.each([undefined, 'W/"v1"', 'not-an-etag', '"bad\r\nheader"'])("does not cache an unreliable validator %s", async etag => {
    const downloadConditional = vi.fn(async () => ({ notModified: false as const, bytes: new Uint8Array([1]), etag }));
    const target = { downloadConditional } as unknown as ISyncTarget, cache = new SidebandReadCache();
    for (let i = 0; i < 2; i++) { const cycle = cache.begin(target); await cycle.read("roster"); cycle.commit(); }
    expect(downloadConditional.mock.calls[1]).toEqual(["roster", undefined]);
  });
  it("saves payload bytes with one request per cycle, and only commits successful processing", async () => {
    let version = '"v1"';
    const body = new TextEncoder().encode("A comment file".repeat(1000));
    const downloadConditional = vi.fn(async (_path: string, etag?: string) => etag === version
      ? { notModified: true as const, etag } : { notModified: false as const, bytes: body, etag: version });
    const target = { downloadConditional } as unknown as ISyncTarget;
    const cache = new SidebandReadCache();
    const failed = cache.begin(target); await failed.read("comments.json");
    const initial = cache.begin(target); await initial.read("comments.json"); initial.commit();
    expect(downloadConditional.mock.calls[1][1]).toBeUndefined();
    const same = cache.begin(target); expect(await same.read("comments.json")).toEqual(body); same.commit();
    expect(cache.transfers).toEqual({ requests: 3, bytes: 2 * body.length, notModified: 1 });
    version = '"v2"';
    const changed = cache.begin(target); await changed.read("comments.json"); changed.commit();
    expect(cache.transfers.bytes).toBe(3 * body.length);
    const next = cache.begin(target); await next.read("comments.json"); next.commit();
    expect(downloadConditional.mock.calls[4][1]).toBe('"v2"');
  });
  it("downloads correctly without validators and does not add metadata requests", async () => {
    const download = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const stat = vi.fn();
    const cache = new SidebandReadCache(), target = { download, stat } as unknown as ISyncTarget;
    for (let i = 0; i < 3; i++) { const cycle = cache.begin(target); await cycle.read("roster"); cycle.commit(); }
    expect(download).toHaveBeenCalledTimes(3); expect(stat).not.toHaveBeenCalled();
    expect(cache.transfers).toEqual({ requests: 3, bytes: 9, notModified: 0 });
  });
  it("rejects unbound 304 replies and never shares data across targets", async () => {
    const cache = new SidebandReadCache();
    const first = { downloadConditional: async () => ({ notModified: false, bytes: new Uint8Array([1]), etag: '"v1"' }) } as unknown as ISyncTarget;
    const initial = cache.begin(first); await initial.read("roster"); initial.commit();
    const second = { downloadConditional: async () => ({ notModified: true, etag: '"v1"' }) } as unknown as ISyncTarget;
    await expect(cache.begin(second).read("roster")).rejects.toThrow("unbound validator");
  });

});

describe("validators a server may legitimately rewrite (#113)", () => {
  const body = new Uint8Array([7, 7, 7]);
  const primed = async (answer: (etag?: string) => { notModified: true; etag: string } | { notModified: false; bytes: Uint8Array | null; etag?: string }) => {
    let first = true;
    const downloadConditional = vi.fn(async (_path: string, etag?: string) => {
      if (first) { first = false; return { notModified: false as const, bytes: body, etag: '"v1"' }; }
      return answer(etag);
    });
    const target = { downloadConditional } as unknown as ISyncTarget;
    const cache = new SidebandReadCache();
    const initial = cache.begin(target); await initial.read("comments.json"); initial.commit();
    return { cache, target, downloadConditional };
  };

  // The reporter of issue 113 syncs over WebDAV to Nextcloud behind a Traefik v3
  // reverse proxy. Traefik's compress middleware answers compressed responses
  // with a weak (W/) or otherwise rewritten ETag, while uncompressed responses
  // and 304s may pass Nextcloud's own tag - so the validator cached from one
  // response form and the 304 answered in another need not be byte-equal.
  it("treats a weak form of the sent validator as a hit (RFC 9110 8.8.3.2)", async () => {
    const { cache, target, downloadConditional } = await primed(etag => etag ? { notModified: true, etag: `W/${etag}` } : { notModified: false, bytes: body, etag: '"v1"' });
    const lines: string[] = [];
    const cycle = cache.begin(target, { onDiagnostic: line => lines.push(line) });
    expect(await cycle.read("comments.json")).toEqual(body);
    expect(downloadConditional).toHaveBeenCalledTimes(2);
    expect(cache.transfers.notModified).toBe(1);
    expect(lines).toEqual([]);
  });

  it("counts a missing ETag header as a hit on the validator that was sent", async () => {
    // The adapters fill in the sent value when the 304 has no header.
    const { cache, target } = await primed(etag => etag ? { notModified: true, etag } : { notModified: false, bytes: body, etag: '"v1"' });
    const cycle = cache.begin(target);
    expect(await cycle.read("comments.json")).toEqual(body);
    expect(cache.transfers.notModified).toBe(1);
  });

  it("reads a mismatching 304 in full in the same call, logs once, and stops asking conditionally", async () => {
    const fresh = new Uint8Array([9, 9]);
    const { cache, target, downloadConditional } = await primed(etag => etag
      ? { notModified: true, etag: '"v1-gzip"' }
      : { notModified: false, bytes: fresh, etag: '"v1"' });
    const lines: string[] = [];
    const cycle = cache.begin(target, { onDiagnostic: line => lines.push(line) });
    expect(await cycle.read("comments.json")).toEqual(fresh);
    cycle.commit();
    expect(downloadConditional.mock.calls.slice(1)).toEqual([["comments.json", '"v1"'], ["comments.json", undefined]]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("304 validator mismatch");
    expect(lines[0]).not.toContain("comments.json");
    for (let i = 0; i < 2; i++) {
      const next = cache.begin(target, { onDiagnostic: line => lines.push(line) });
      expect(await next.read("comments.json")).toEqual(fresh);
      next.commit();
    }
    expect(downloadConditional.mock.calls.slice(3)).toEqual([["comments.json", undefined], ["comments.json", undefined]]);
    expect(lines).toHaveLength(1);
  });

  it("survives a Nextcloud behind Traefik: strong tag from a plain 200, a 304 in another form", async () => {
    // Cached `"x"` from the uncompressed 200; the proxy's 304 carries the tag of
    // its compressed representation. Not weakly equal, so: one full re-read in
    // the same call, then no more conditional requests to this target.
    let reads = 0;
    const downloadConditional = vi.fn(async (_path: string, etag?: string) => {
      reads++;
      if (reads === 1) return { notModified: false as const, bytes: new Uint8Array([1]), etag: '"5f2a"' };
      if (etag) return { notModified: true as const, etag: 'W/"5f2a-gzip"' };
      return { notModified: false as const, bytes: new Uint8Array([2]), etag: '"5f2b"' };
    });
    const target = { downloadConditional } as unknown as ISyncTarget, cache = new SidebandReadCache();
    const first = cache.begin(target); await first.read("comments.nc.json"); first.commit();
    const lines: string[] = [];
    const second = cache.begin(target, { onDiagnostic: line => lines.push(line) });
    expect(await second.read("comments.nc.json")).toEqual(new Uint8Array([2]));
    second.commit();
    const third = cache.begin(target); await third.read("comments.nc.json"); third.commit();
    expect(downloadConditional.mock.calls.map(call => call[1])).toEqual([undefined, '"5f2a"', undefined, undefined]);
    expect(lines).toHaveLength(1);
  });

  it("still rejects a 304 to a request that sent no validator", async () => {
    const target = { downloadConditional: async () => ({ notModified: true, etag: '"v1"' }) } as unknown as ISyncTarget;
    await expect(new SidebandReadCache().begin(target).read("roster")).rejects.toThrow("unbound validator");
  });
});
