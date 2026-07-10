import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry, parseRetryAfterMs, retryDelayMs } from "../../src/sync/httpRetry.js";

const res = (status: number, headers: Record<string, string> = {}) =>
  ({ status, headers: { get: (k: string) => headers[k] ?? null } }) as unknown as Response;

const instant = { sleep: async () => {}, random: () => 0.5 };

describe("httpRetry", () => {
  it("parses Retry-After as delta-seconds and as an HTTP date", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
    const now = Date.now();
    expect(parseRetryAfterMs(new Date(now + 5000).toUTCString(), now)).toBeGreaterThanOrEqual(4000);
    expect(parseRetryAfterMs("garbage")).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  it("prefers Retry-After over the jittered backoff and caps it", () => {
    expect(retryDelayMs(1, "2", { random: () => 0.5 })).toBe(2000);
    expect(retryDelayMs(1, "9999", { maxDelayMs: 3000 })).toBe(3000);
    // full jitter: random * min(max, base * 2^(n-1))
    expect(retryDelayMs(3, null, { baseDelayMs: 1000, random: () => 0.5 })).toBe(2000);
  });

  it("retries 429 for READS and WRITES until success", async () => {
    for (const kind of ["read", "write"] as const) {
      const doFetch = vi
        .fn()
        .mockResolvedValueOnce(res(429, { "Retry-After": "0" }))
        .mockResolvedValueOnce(res(200));
      const out = await fetchWithRetry(doFetch, kind, instant);
      expect(out.status).toBe(200);
      expect(doFetch).toHaveBeenCalledTimes(2);
    }
  });

  it("retries 503 and network errors ONLY for reads", async () => {
    const read = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200));
    expect((await fetchWithRetry(read, "read", instant)).status).toBe(200);

    const write = vi.fn().mockResolvedValue(res(503));
    expect((await fetchWithRetry(write, "write", instant)).status).toBe(503);
    expect(write).toHaveBeenCalledTimes(1);

    const netRead = vi.fn().mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(res(200));
    expect((await fetchWithRetry(netRead, "read", instant)).status).toBe(200);

    const netWrite = vi.fn().mockRejectedValue(new Error("reset"));
    await expect(fetchWithRetry(netWrite, "write", instant)).rejects.toThrow("reset");
    expect(netWrite).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts and returns the last response", async () => {
    const doFetch = vi.fn().mockResolvedValue(res(429));
    const out = await fetchWithRetry(doFetch, "read", { ...instant, maxAttempts: 3 });
    expect(out.status).toBe(429);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });
});
