import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import i18n from "@plainva/ui/i18n";
import { syncStateLabel } from "./components/syncSubtitle";

const SRC = fileURLToPath(new URL(".", import.meta.url));

/**
 * A temporary sync failure is not a defect (round 3, R4).
 *
 * The maintainer reported "I keep getting a sync error with Google Drive, but
 * syncing again just works — that message is very irritating". It was not
 * Drive: the worker turned EVERY throw into the state `error` with the raw
 * provider string, and the backoff retried within five minutes, so the red
 * message was usually gone by the time anyone looked at it.
 *
 * These pin the two halves the shell owns — the wording and the colour.
 */
describe("the temporary sync state says when, not what broke", () => {
  it("names the time of the next attempt", () => {
    const at = new Date("2026-08-02T14:05:00").getTime();
    const label = syncStateLabel({ status: "retrying", retryAt: at }, i18n.t.bind(i18n) as never);

    // The reader is on a train. "Google Drive request failed: 503 Service
    // Unavailable" tells them nothing they can act on; the next attempt does.
    expect(label).not.toMatch(/503|Service Unavailable|Google Drive request/);
    expect(label, "the label does not say when").toMatch(/\d{1,2}[:.]\d{2}/);
  });

  it("still answers without a time", () => {
    const label = syncStateLabel({ status: "retrying" }, i18n.t.bind(i18n) as never);
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe("mobile.syncRetrying"); // key, not text
  });

  it("keeps the other states as they were", () => {
    const t = i18n.t.bind(i18n) as never;
    expect(syncStateLabel({ status: "idle" }, t)).not.toBe(syncStateLabel({ status: "error" }, t));
    expect(syncStateLabel({ status: "syncing" }, t)).not.toBe(syncStateLabel({ status: "retrying" }, t));
  });
});

describe("the temporary sync state is neutral, never red", () => {
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  it("keeps the cloud glyph and the muted colour on both surfaces", () => {
    // Red is reserved for what needs a person. A state the worker expects to
    // leave on its own must not look like a broken connection.
    for (const file of ["components/SyncIndicator.tsx", "VaultDetailScreen.tsx"]) {
      const src = read(file);
      const at = src.indexOf('"retrying"');
      expect(at, `${file} does not know the temporary state`).toBeGreaterThan(-1);
      // The warning-triangle branch must be gated on `error` alone. Note the
      // angle bracket: without it this finds the IMPORT and inspects the wrong
      // 200 characters — which is exactly what let a sabotaged copy pass once.
      const alert = src.indexOf("<AlertTriangle");
      expect(alert, `${file} has no error branch`).toBeGreaterThan(-1);
      const errorBranch = src.slice(Math.max(0, alert - 220), alert);
      expect(errorBranch, `${file} paints the temporary state red`).not.toContain('"retrying"');
    }
  });

  it("reports the raw provider text into the error history", () => {
    // The surface stops shouting it, so this is the only place it survives.
    const service = read("services/syncService.ts");
    const at = service.indexOf("errorHistory =");
    expect(service.slice(at, at + 260)).toContain('"retrying"');
  });
});
