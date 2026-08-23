// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWindowParams, buildWindowQuery, isOwnerWindow, resetWindowParamsForTest } from "./windowContext";

/**
 * The full second window (stage C).
 *
 * Three things have to hold for it, and each of them fails SILENTLY when it
 * does not — which is why they are pinned rather than commented:
 *
 * 1. `?win=full` parses as a client. Anything unrecognised falls back to owner,
 *    so a typo here would not error: it would boot a SECOND window that thinks
 *    it owns the background services, on the same vault, with two sync workers.
 * 2. Tauri assigns capabilities by window LABEL. A `full-1` window that matches
 *    no capability entry is not restricted, it is DEAD — every `invoke` is
 *    denied and the window shows an empty frame.
 * 3. The client window must not carry the owner's permissions either: the whole
 *    point is that one window owns the writes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPS = join(HERE, "..", "..", "src-tauri", "capabilities");
const clientCaps = JSON.parse(readFileSync(join(CAPS, "auxiliary-window.json"), "utf8"));
const ownerCaps = JSON.parse(readFileSync(join(CAPS, "default.json"), "utf8"));

describe("full second window", () => {
  it("parses ?win=full as a client window", () => {
    const p = parseWindowParams("?win=full&vault=/v&label=full-1");
    expect(p.role).toBe("full");
    expect(p.vaultPath).toBe("/v");
    expect(p.label).toBe("full-1");
  });

  it("is not the owner window", () => {
    // The guard the whole client path hangs on: everything from the vault
    // provider's mode to the window bus reads this one answer.
    resetWindowParamsForTest();
    const p = parseWindowParams("?win=full&vault=/v&label=full-1");
    expect(p.role === "owner").toBe(false);
    // …and an ordinary launch still is, byte for byte.
    expect(isOwnerWindow()).toBe(true);
    resetWindowParamsForTest();
  });

  it("builds a query the parser reads back", () => {
    const q = buildWindowQuery({ role: "full", vaultPath: "/v", label: "full-2" });
    expect(parseWindowParams(q)).toMatchObject({ role: "full", vaultPath: "/v", label: "full-2" });
  });

  it("is covered by the client capability, by label", () => {
    // `full-*` and nothing else: the label prefix IS the permission boundary.
    expect(clientCaps.windows).toContain("full-*");
  });

  it("is not covered by the owner capability", () => {
    for (const pattern of ownerCaps.windows as string[]) {
      // The owner set matches "main" exactly; a wildcard here would hand a
      // second window the updater, the watcher and every write permission.
      expect(pattern).toBe("main");
    }
  });
});
