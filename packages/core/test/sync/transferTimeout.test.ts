import { describe, expect, it, vi } from "vitest";
import { timeoutForBody, bodyByteLength, MIN_TRANSFER_BYTES_PER_SECOND } from "../../src/sync/transferTimeout.ts";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.ts";

describe("transfer timeout", () => {
  it("leaves a bodyless request on the base budget", () => {
    expect(timeoutForBody(30000, undefined)).toBe(30000);
    expect(timeoutForBody(30000, null)).toBe(30000);
  });

  it("adds what the payload alone needs at the floor throughput", () => {
    const tenMb = new Uint8Array(10 * 1024 * 1024);
    const expected = 30000 + Math.ceil((tenMb.byteLength / MIN_TRANSFER_BYTES_PER_SECOND) * 1000);
    expect(timeoutForBody(30000, tenMb)).toBe(expected);
    // Sanity on the scale rather than the arithmetic: 10 MB must buy minutes,
    // not milliseconds, or the budget would still be a speed requirement.
    expect(timeoutForBody(30000, tenMb)).toBeGreaterThan(3 * 60_000);
  });

  it("measures the body shapes the targets actually send", () => {
    expect(bodyByteLength(new Uint8Array(7))).toBe(7);
    expect(bodyByteLength(new ArrayBuffer(9))).toBe(9);
    expect(bodyByteLength("abcd")).toBe(4);
    expect(bodyByteLength({ not: "a body" })).toBeUndefined();
  });
});

describe("WebDavSyncTarget upload budget", () => {
  it("does not abort a large upload on the base timeout", async () => {
    vi.useFakeTimers();
    try {
      // 90 MB — the size from issue #48. At the old flat 30 s this aborted
      // unless the line sustained 3 MB/s, and an aborted write is a network
      // error, which the write path deliberately never retries.
      const content = new Uint8Array(90 * 1024 * 1024);
      let sawAbort = false;

      const fetchFn = vi.fn(async (_url: any, init: any) => {
        init?.signal?.addEventListener("abort", () => {
          sawAbort = true;
        });
        // A slow but perfectly healthy upload: three minutes of wall clock.
        await vi.advanceTimersByTimeAsync(180_000);
        return new Response(null, { status: 201 });
      });

      const target = new WebDavSyncTarget(
        { url: "https://dav.example.com/", user: "u", pass: "p" },
        fetchFn as any,
      );
      await target.push({ id: 1, file_path: "big.bin", operation: "write", content } as any);

      expect(sawAbort, "a three-minute upload of 90 MB must not be aborted").toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
