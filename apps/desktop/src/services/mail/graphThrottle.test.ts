import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import { graphListFolders, mailSecretKey, setMailPlatform, type MailAccountConfig } from "@plainva/ui/mail";

/**
 * Graph answers 429 "ApplicationThrottled — over its MailboxConcurrency limit"
 * when too many requests for one mailbox are in the air, and the mail screen
 * opens folders and messages together. Reported from a device on 2026-07-26,
 * with the mailbox list failing outright.
 *
 * Two guarantees are pinned here: a throttled request is retried rather than
 * surfaced as an error, and requests never exceed the small in-flight gate.
 */

const account: MailAccountConfig = {
  id: "acc",
  label: "Microsoft",
  host: "",
  port: 0,
  user: "me@outlook.com",
  kind: "microsoft",
  clientId: "cid",
};

const secrets = new Map<string, unknown>();

function installPlatform(api: typeof fetch): void {
  setPlatformServices({
    loadSettings: async () => ({
      get: async () => undefined,
      set: async () => {},
      delete: async () => true,
      keys: async () => [],
      save: async () => {},
    }),
    credentials: {
      readSecret: async <T,>(k: string) => (secrets.get(k) ?? null) as T | null,
      writeSecret: async (k: string, v: unknown) => void secrets.set(k, v),
      removeSecret: async (k: string) => void secrets.delete(k),
    },
    openExternal: async () => {},
  });
  const token: typeof fetch = async () =>
    new Response(JSON.stringify({ access_token: "t", refresh_token: "r", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  setMailPlatform({
    transport: new Proxy({} as never, { get: () => () => Promise.reject(new Error("no IMAP here")) }),
    http: { api, token },
  });
}

const folders = JSON.stringify({ value: [{ id: "1", displayName: "Inbox", childFolderCount: 0 }] });

describe("Graph throttling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    secrets.clear();
    secrets.set(mailSecretKey("v1", "acc"), { refreshToken: "r" });
  });

  it("waits and retries when Graph reports the mailbox concurrency limit", async () => {
    // Opening the mail screen asks for the folder list AND every well-known
    // folder — seven requests for one mailbox, which is what tripped the limit
    // on the device. The first answer here is the throttle Graph sent back.
    let calls = 0;
    let throttled = false;
    installPlatform(async () => {
      calls++;
      if (!throttled) {
        throttled = true;
        return new Response(JSON.stringify({ error: { code: "ApplicationThrottled" } }), {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      }
      return new Response(folders, { status: 200, headers: { "content-type": "application/json" } });
    });

    const pending = graphListFolders("v1", account);
    await vi.advanceTimersByTimeAsync(2100); // the Retry-After Graph asked for
    const boxes = await pending;

    // The throttled call was repeated instead of surfacing as an error.
    expect(throttled).toBe(true);
    expect(calls).toBeGreaterThan(1);
    expect(boxes.map((b) => b.name)).toContain("Inbox");
  });

  it("never has more than three requests for one mailbox in the air", async () => {
    let inFlight = 0;
    let peak = 0;
    installPlatform(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return new Response(folders, { status: 200, headers: { "content-type": "application/json" } });
    });

    const all = Promise.all(Array.from({ length: 8 }, () => graphListFolders("v1", account)));
    await vi.advanceTimersByTimeAsync(500);
    await all;

    expect(peak).toBeLessThanOrEqual(3);
  });
});
