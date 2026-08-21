import { describe, expect, it } from "vitest";
import {
  deriveOkfTrustLevel,
  humanActor,
  isHumanActor,
  isOkfStale,
  localDateString,
  parseOkfSources,
  parseOkfStaleAfter,
  parseOkfStatus,
  parseOkfTrustSignals,
  parseOkfVerified,
  producerActor,
} from "../src/okf-trust.ts";

// OKF v0.2 (2026-07-25) trust signals — form-checked, never rejecting.
describe("parseOkfTrustSignals", () => {
  it("claims only spec-shaped keys and leaves the rest as plain properties", () => {
    const signals = parseOkfTrustSignals({
      type: "Note",
      generated: { by: "plainva-import/0.6.7", at: "2026-08-21T10:00:00Z" },
      verified: [{ by: "human:marco", at: "2026-08-21T11:00:00Z" }],
      sources: [{ resource: "https://example.org/x", title: "X", usage_count: 3 }],
      stale_after: "2026-12-31",
      status: "draft",
    });
    expect(signals.generated).toEqual({ by: "plainva-import/0.6.7", at: "2026-08-21T10:00:00Z" });
    expect(signals.verified).toEqual([{ by: "human:marco", at: "2026-08-21T11:00:00Z" }]);
    expect(signals.sources).toEqual([{ resource: "https://example.org/x", title: "X", usage_count: 3 }]);
    expect(signals.staleAfter).toBe("2026-12-31");
    expect(signals.status).toBe("draft");
    expect(signals.statusForeign).toBe(false);
    expect(signals.claimedKeys).toEqual(["generated", "verified", "sources", "status", "stale_after"]);
  });

  it("normalises a bare `verified` mapping into a one-element list (spec)", () => {
    const signals = parseOkfTrustSignals({ verified: { by: "human:kim", at: "2026-08-01T08:00:00Z" } });
    expect(signals.verified).toEqual([{ by: "human:kim", at: "2026-08-01T08:00:00Z" }]);
    expect(signals.claimedKeys).toEqual(["verified"]);
  });

  it("treats a task database's `status: Offen` as a foreign property, not a lifecycle", () => {
    // The form check is the whole point: a task-database note must neither get
    // a lifecycle badge nor lose its status column to the trust section.
    const signals = parseOkfTrustSignals({ status: "Offen" });
    expect(signals.status).toBeNull();
    expect(signals.statusForeign).toBe(true);
    expect(signals.claimedKeys).toEqual([]);
  });

  it("is total: malformed shapes yield nulls/empties instead of throwing", () => {
    const signals = parseOkfTrustSignals({
      generated: "plainva-import/0.6.7", // not a mapping
      verified: [{ by: "human:x", at: "yesterday" }, { by: "", at: "2026-01-01T00:00:00Z" }],
      sources: "https://example.org", // not a list of mappings
      stale_after: "31.12.2026",
      status: 42,
    });
    expect(signals.generated).toBeNull();
    expect(signals.verified).toEqual([]);
    expect(signals.sources).toEqual([]);
    expect(signals.staleAfter).toBeNull();
    expect(signals.status).toBeNull();
    expect(signals.statusForeign).toBe(true);
    expect(signals.claimedKeys).toEqual([]);
    expect(parseOkfTrustSignals(null).claimedKeys).toEqual([]);
    expect(parseOkfTrustSignals(undefined).claimedKeys).toEqual([]);
  });

  it("is all-or-nothing per list: one malformed entry keeps the whole key a plain property", () => {
    expect(parseOkfVerified([{ by: "human:a", at: "2026-01-01T00:00:00Z" }, { at: "2026-01-02T00:00:00Z" }])).toBeNull();
    expect(parseOkfSources([{ resource: "a" }, { title: "no resource" }])).toBeNull();
    expect(parseOkfVerified(undefined)).toBeNull();
    expect(parseOkfSources(null)).toBeNull();
  });

  it("keeps the v0.1 `timestamp` as a read fallback", () => {
    expect(parseOkfTrustSignals({ timestamp: "2026-06-23T10:15:00Z" }).timestamp).toBe("2026-06-23T10:15:00Z");
    expect(parseOkfTrustSignals({ timestamp: "23.06.2026" }).timestamp).toBeNull();
  });
});

describe("status / stale_after form checks", () => {
  it("accepts exactly the spec lifecycle values (trimmed), nothing else", () => {
    expect(parseOkfStatus("draft")).toBe("draft");
    expect(parseOkfStatus(" stable ")).toBe("stable");
    expect(parseOkfStatus("deprecated")).toBe("deprecated");
    expect(parseOkfStatus("Draft")).toBeNull();
    expect(parseOkfStatus("In Arbeit")).toBeNull();
    expect(parseOkfStatus("")).toBeNull();
    expect(parseOkfStatus(null)).toBeNull();
  });

  it("accepts YYYY-MM-DD (also as the leading part of an ISO instant or a Date) and rejects the rest", () => {
    expect(parseOkfStaleAfter("2026-12-31")).toBe("2026-12-31");
    expect(parseOkfStaleAfter("2026-12-31T00:00:00Z")).toBe("2026-12-31");
    expect(parseOkfStaleAfter(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-12-31");
    expect(parseOkfStaleAfter("2026-02-30")).toBeNull(); // no such day
    expect(parseOkfStaleAfter("31.12.2026")).toBeNull();
    expect(parseOkfStaleAfter(20261231)).toBeNull();
  });

  it("is stale only once the local date lies past stale_after", () => {
    expect(isOkfStale("2026-08-20", new Date(2026, 7, 21, 9, 0))).toBe(true);
    expect(isOkfStale("2026-08-21", new Date(2026, 7, 21, 23, 59))).toBe(false); // the day itself is still fresh
    expect(isOkfStale("2026-08-22", new Date(2026, 7, 21))).toBe(false);
    expect(isOkfStale(null, new Date())).toBe(false);
    expect(localDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("actors and trust level", () => {
  it("builds and recognises the spec actor forms", () => {
    expect(humanActor("  Marco  ")).toBe("human:Marco");
    expect(producerActor("plainva-import", "0.6.7")).toBe("plainva-import/0.6.7");
    expect(isHumanActor("human:marco")).toBe(true);
    expect(isHumanActor("human:")).toBe(false);
    expect(isHumanActor("plainva-import/0.6.7")).toBe(false);
  });

  it("derives the advisory trust level per spec", () => {
    expect(deriveOkfTrustLevel({ verified: [] })).toBe("unverified");
    expect(deriveOkfTrustLevel({ verified: [{ by: "plainva-ai/x", at: "2026-01-01T00:00:00Z" }] })).toBe("machine-confirmed");
    expect(
      deriveOkfTrustLevel({
        verified: [
          { by: "plainva-ai/x", at: "2026-01-01T00:00:00Z" },
          { by: "human:marco", at: "2026-01-02T00:00:00Z" },
        ],
      })
    ).toBe("human-reviewed");
  });
});
