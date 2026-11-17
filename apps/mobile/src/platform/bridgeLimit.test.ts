import { beforeEach, describe, expect, it } from "vitest";
import { BRIDGE_LIMIT_CHARS, BridgeMessageTooLargeError, bridgeMessageSize, installBridgeLimit, resetBridgeLimitForTests } from "./bridgeLimit";

/**
 * A hard limit at the bridge (F51): a call over 32 MB fails in JavaScript with
 * its method's name, instead of a dead process - the phone's vault archive
 * was one 118 MB message, and Android ran out of memory parsing it.
 */

const forwarded: string[] = [];
beforeEach(() => {
  forwarded.length = 0;
  resetBridgeLimitForTests();
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    toNative: (plugin: string, method: string, _options: unknown, stored: { resolve?: (v: unknown) => void }) => {
      forwarded.push(`${plugin}.${method}`);
      stored.resolve?.({});
    },
  };
  installBridgeLimit();
});

const call = (plugin: string, method: string, options: unknown) =>
  new Promise((resolve, reject) => (globalThis as unknown as { Capacitor: { toNative: (...a: unknown[]) => void } }).Capacitor.toNative(plugin, method, options, { resolve, reject }));

describe("the bridge limit", () => {
  it("lets an ordinary call through, and a large one that goes today (30 MB)", async () => {
    await call("AtomicFile", "append", { id: "w1", data: "x".repeat(350_000) });
    // A picked folder or a mail attachment still sends a whole file: up to the limit it goes as before.
    await call("VaultFolder", "writeFile", { path: "Bilder/shot.png", data: "x".repeat(30 * 1024 * 1024) });
    expect(forwarded).toEqual(["AtomicFile.append", "VaultFolder.writeFile"]);
  });

  it("refuses a call over the limit with the method's name, and nothing reaches the native side", async () => {
    const zip = "x".repeat(118_404_680);
    const error = await call("Filesystem", "writeFile", { path: "Plainva Backups/Vault/a.zip", data: zip }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BridgeMessageTooLargeError);
    expect((error as Error).message).toMatch(/^Filesystem\.writeFile: /);
    expect(forwarded).toEqual([]);
  });

  it("counts a message without making its text, and stops once over", () => {
    expect(bridgeMessageSize({ data: "x".repeat(1000) })).toBeGreaterThanOrEqual(1000);
    expect(bridgeMessageSize({ values: Array.from({ length: 400_000 }, () => ({ c: "y".repeat(100) })) }, BRIDGE_LIMIT_CHARS)).toBeGreaterThan(BRIDGE_LIMIT_CHARS);
  });
});
