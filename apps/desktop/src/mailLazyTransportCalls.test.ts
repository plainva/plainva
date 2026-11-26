import { describe, expect, it, vi } from "vitest";

/**
 * The lazily loaded socket transport hands every call to the socket transport — the same arguments in, the same
 * answer or failure out, one load for all calls (review of L5, 2026-11-25: the first test compared the names only).
 */
const made = vi.hoisted(() => ({ count: 0, calls: [] as Array<[string, unknown[]]> }));

vi.mock("../../../packages/ui/src/mail/net/socketTransport", async () => {
  const { SOCKET_TRANSPORT_METHODS } = await import("../../../packages/ui/src/mail/net/lazySocketTransport");
  return {
    createSocketMailTransport: () => {
      made.count += 1;
      return Object.fromEntries(
        SOCKET_TRANSPORT_METHODS.map((method) => [
          method,
          async (...args: unknown[]) => {
            made.calls.push([method, args]);
            if (args[1] === "fail") throw new Error(`${method} failed`);
            return { method, args };
          },
        ]),
      );
    },
  };
});

describe("the lazily loaded socket transport, called", () => {
  it("passes each call through with its arguments, its answer and its failure, after one load", async () => {
    expect.hasAssertions();
    const { createLazySocketMailTransport, SOCKET_TRANSPORT_METHODS } = await import("../../../packages/ui/src/mail/net/lazySocketTransport");
    const transport = createLazySocketMailTransport() as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const creds = { host: "imap.example.test" };
    for (const method of SOCKET_TRANSPORT_METHODS) {
      const args = [creds, { probe: method }];
      await expect(transport[method]!(...args)).resolves.toEqual({ method, args });
      await expect(transport[method]!(creds, "fail")).rejects.toThrow(`${method} failed`);
    }
    expect(made.count).toBe(1);
    expect(made.calls.filter(([, args]) => args[1] !== "fail").map(([method]) => method)).toEqual([...SOCKET_TRANSPORT_METHODS]);
    expect(made.calls.every(([, args]) => args[0] === creds)).toBe(true);
  });
});
