// OKF 0.2 provenance helpers (plan OKF v0.2, P3b): the one place that names
// Plainva's machine actors and appends a person's review. The helpers live in
// @plainva/ui (shared by both shells); their tests sit in the desktop suite
// like the other ui-lib tests.
import { afterEach, describe, expect, it } from "vitest";
import {
  appendVerification,
  generatedStamp,
  plainvaProducer,
  resetAppVersionForStamps,
  setPlatformServices,
  stampTime,
  verifiedStamp,
  type PlatformServices,
} from "@plainva/ui";

const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const services = (partial: Partial<PlatformServices>) => partial as unknown as PlatformServices;

describe("okfProvenance (OKF 0.2 stamps)", () => {
  afterEach(() => resetAppVersionForStamps());

  it("stampTime is a second-precision ISO instant, the form the spec examples use", () => {
    expect(stampTime(new Date("2026-08-21T10:11:12.345Z"))).toBe("2026-08-21T10:11:12Z");
    expect(stampTime()).toMatch(ISO_SECONDS);
  });

  it("verifiedStamp and generatedStamp carry the actor in the spec's forms", () => {
    const at = new Date("2026-08-21T10:00:00Z");
    expect(verifiedStamp("  Marco ", at)).toEqual({ by: "human:Marco", at: "2026-08-21T10:00:00Z" });
    expect(generatedStamp("plainva-import/0.6.7", at)).toEqual({ by: "plainva-import/0.6.7", at: "2026-08-21T10:00:00Z" });
  });

  it("appendVerification keeps the review history: copies a list, wraps a single stamp, starts an absent one", () => {
    const at = new Date("2026-08-21T10:00:00Z");
    expect(appendVerification(undefined, "Marco", at)).toEqual([{ by: "human:Marco", at: "2026-08-21T10:00:00Z" }]);
    expect(appendVerification(null, "Marco", at)).toHaveLength(1);

    const existing = [{ by: "human:anna", at: "2026-08-01T09:00:00Z" }];
    const appended = appendVerification(existing, "Marco", at);
    expect(appended).toEqual([existing[0], { by: "human:Marco", at: "2026-08-21T10:00:00Z" }]);
    // The input list is not mutated — a second reviewer never rewrites the first.
    expect(existing).toHaveLength(1);

    const wrapped = appendVerification({ by: "human:anna", at: "2026-08-01T09:00:00Z" }, "Marco", at);
    expect(wrapped).toEqual([{ by: "human:anna", at: "2026-08-01T09:00:00Z" }, { by: "human:Marco", at: "2026-08-21T10:00:00Z" }]);
  });

  it("plainvaProducer names the shell's version, falls back to 'dev', and caches until reset", async () => {
    setPlatformServices(services({ appVersion: async () => "1.2.3" }));
    expect(await plainvaProducer("import")).toBe("plainva-import/1.2.3");
    expect(await plainvaProducer("task-sync")).toBe("plainva-task-sync/1.2.3");

    // The version is read once per process: a later registration is not
    // consulted until the cache is reset (there is no reason to re-ask mid-run).
    setPlatformServices(services({ appVersion: async () => "9.9.9" }));
    expect(await plainvaProducer("mail-capture")).toBe("plainva-mail-capture/1.2.3");
    resetAppVersionForStamps();
    expect(await plainvaProducer("mail-capture")).toBe("plainva-mail-capture/9.9.9");

    // No appVersion registered, or a failing one: the stamp still names the
    // process — the version is detail, the producer is the point.
    resetAppVersionForStamps();
    setPlatformServices(services({}));
    expect(await plainvaProducer("import")).toBe("plainva-import/dev");
    resetAppVersionForStamps();
    setPlatformServices(services({ appVersion: async () => { throw new Error("no version"); } }));
    expect(await plainvaProducer("import")).toBe("plainva-import/dev");
    resetAppVersionForStamps();
    setPlatformServices(services({ appVersion: async () => "   " }));
    expect(await plainvaProducer("import")).toBe("plainva-import/dev");
  });
});
