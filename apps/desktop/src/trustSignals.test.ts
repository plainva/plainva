import { describe, expect, it } from "vitest";
import {
  describeActor,
  formatActor,
  formatStampDate,
  generatedAtOf,
  staleSinceOf,
  trustBadgeOf,
  trustLevelOf,
  trustSignalsFromBlock,
} from "@plainva/ui";

// OKF v0.2 plan, P3a — the shared trust-signal derivations both shells render
// from. The parse itself is core's (okf-trust.test.ts); this pins the view
// layer: which note shows which badge, when the stale banner appears, how an
// actor reads on screen.

const FULL = [
  "type: Note",
  "generated:",
  "  by: plainva-mail-capture/0.6.7",
  "  at: 2026-08-12T09:30:00Z",
  "verified:",
  "  - by: human:marco",
  "    at: 2026-08-13T10:00:00Z",
  "sources:",
  "  - resource: mid:abc@example.org",
  "    title: Angebot",
  "status: draft",
  "stale_after: 2026-06-30",
].join("\n");

describe("trustSignalsFromBlock", () => {
  it("reads the five families and the claimed keys from a frontmatter block", () => {
    const s = trustSignalsFromBlock(FULL);
    expect(s.generated).toEqual({ by: "plainva-mail-capture/0.6.7", at: "2026-08-12T09:30:00Z" });
    expect(s.verified).toEqual([{ by: "human:marco", at: "2026-08-13T10:00:00Z" }]);
    expect(s.sources.map((x) => x.resource)).toEqual(["mid:abc@example.org"]);
    expect(s.status).toBe("draft");
    expect(s.staleAfter).toBe("2026-06-30");
    expect(s.claimedKeys).toEqual(["generated", "verified", "sources", "status", "stale_after"]);
    expect(trustLevelOf(s)).toBe("human-reviewed");
  });

  it("yields empty signals for no block, an empty block and unparseable YAML", () => {
    for (const block of [null, undefined, "", "   ", "type: [unterminated", "- just\n- a list"]) {
      const s = trustSignalsFromBlock(block);
      expect(s.generated).toBeNull();
      expect(s.verified).toEqual([]);
      expect(s.claimedKeys).toEqual([]);
      expect(trustBadgeOf(s)).toBeNull();
      expect(trustLevelOf(s)).toBe("unverified");
    }
  });
});

describe("trustBadgeOf", () => {
  it("shows draft and deprecated, keeps stable and absent silent", () => {
    expect(trustBadgeOf(trustSignalsFromBlock("status: draft"))).toBe("draft");
    expect(trustBadgeOf(trustSignalsFromBlock("status: deprecated"))).toBe("deprecated");
    expect(trustBadgeOf(trustSignalsFromBlock("status: stable"))).toBeNull();
    expect(trustBadgeOf(trustSignalsFromBlock("type: Note"))).toBeNull();
  });

  it("never turns a task database's status column into a lifecycle badge (plan § 6)", () => {
    const s = trustSignalsFromBlock("status: Offen\ndue: 2026-09-01");
    expect(s.statusForeign).toBe(true);
    expect(trustBadgeOf(s)).toBeNull();
  });
});

describe("staleSinceOf", () => {
  const today = new Date(2026, 7, 21, 12, 0, 0); // 2026-08-21 local

  it("names the stale_after date once today lies past it", () => {
    expect(staleSinceOf(trustSignalsFromBlock("stale_after: 2026-06-30"), today)).toBe("2026-06-30");
  });

  it("stays quiet on the day itself, in the future and without a date", () => {
    expect(staleSinceOf(trustSignalsFromBlock("stale_after: 2026-08-21"), today)).toBeNull();
    expect(staleSinceOf(trustSignalsFromBlock("stale_after: 2027-01-01"), today)).toBeNull();
    expect(staleSinceOf(trustSignalsFromBlock("type: Note"), today)).toBeNull();
  });
});

describe("generatedAtOf", () => {
  it("prefers generated.at and falls back to the v0.1 timestamp", () => {
    expect(generatedAtOf(trustSignalsFromBlock(FULL))).toBe("2026-08-12T09:30:00Z");
    expect(generatedAtOf(trustSignalsFromBlock("timestamp: 2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05Z");
    expect(generatedAtOf(trustSignalsFromBlock("type: Note"))).toBeNull();
  });
});

describe("describeActor / formatActor", () => {
  const words = { person: "Person", process: "Prozess" };

  it("splits the three conventions and leaves the rest verbatim", () => {
    expect(describeActor("human:marco")).toEqual({ kind: "human", name: "marco" });
    expect(describeActor("plainva-import/0.6.7")).toEqual({ kind: "producer", name: "plainva-import", version: "0.6.7" });
    expect(describeActor("process:nightly-sync")).toEqual({ kind: "process", name: "nightly-sync" });
    expect(describeActor("someone")).toEqual({ kind: "raw", name: "someone" });
    expect(describeActor("")).toEqual({ kind: "raw", name: "" });
  });

  it("formats for the screen with the caller's words", () => {
    expect(formatActor("human:marco", words)).toBe("marco (Person)");
    expect(formatActor("plainva-import/0.6.7", words)).toBe("plainva-import 0.6.7");
    expect(formatActor("process:nightly-sync", words)).toBe("Prozess nightly-sync");
    expect(formatActor("someone", words)).toBe("someone");
  });
});

describe("formatStampDate", () => {
  it("keeps a plain date on its calendar day instead of sliding through UTC midnight", () => {
    // 2026-06-30 as UTC midnight is still June 29 west of Greenwich — the
    // spec date is a plain date and must read as the 30th everywhere.
    expect(formatStampDate("2026-06-30", "en-US")).toBe("Jun 30, 2026");
    expect(formatStampDate("2026-06-30", "de-DE")).toBe("30.06.2026");
  });

  it("shows the short time for an instant and the raw text when unparseable", () => {
    const shown = formatStampDate("2026-08-12T09:30:00Z", "en-US");
    expect(shown).toMatch(/2026/);
    expect(shown).toMatch(/\d{1,2}:\d{2}/);
    expect(formatStampDate("yesterday-ish", "en-US")).toBe("yesterday-ish");
  });
});
