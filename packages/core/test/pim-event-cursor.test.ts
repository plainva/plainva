import { describe, it, expect } from "vitest";
import {
  encodeEventCursor,
  decodeEventCursor,
  needsFullRefresh,
  FULL_REFRESH_MAX_AGE_MS,
} from "../src/pim/eventCursor.js";

describe("event cursor (S18)", () => {
  it("round-trips a provider token and the time of the last full refresh", () => {
    const raw = encodeEventCursor({ token: "syncToken=abc", fullAt: 1_700_000_000_000 });
    expect(decodeEventCursor(raw)).toEqual({ token: "syncToken=abc", fullAt: 1_700_000_000_000 });
  });

  it("reads anything unparseable as no cursor, which means a full refresh", () => {
    // Every one of these is a real shape: a truncated write, a cursor from
    // before this format existed, an empty column, a token that came back
    // blank. None of them may be treated as usable — the safe direction is
    // always "refresh fully", never "continue from something we do not have".
    for (const raw of [null, undefined, "", "{", "syncToken=abc", '{"t":""}', '{"t":7}', "[]"]) {
      expect(decodeEventCursor(raw), `for ${JSON.stringify(raw)}`).toBeNull();
      expect(needsFullRefresh(decodeEventCursor(raw), Date.now(), true)).toBe(true);
    }
  });

  it("survives a cursor whose age is missing or nonsense by refreshing", () => {
    // A missing/garbled `fullAt` becomes 0, so the age check fires at once
    // rather than granting an unbounded delta run.
    for (const raw of ['{"t":"tok"}', '{"t":"tok","f":"soon"}', '{"t":"tok","f":null}']) {
      const c = decodeEventCursor(raw);
      expect(c?.token).toBe("tok");
      expect(needsFullRefresh(c, Date.now(), true)).toBe(true);
    }
  });

  it("refuses a delta step for a provider without a change feed, cursor or not", () => {
    const fresh = { token: "tok", fullAt: 1000 };
    expect(needsFullRefresh(fresh, 1001, false)).toBe(true);
    expect(needsFullRefresh(null, 1001, false)).toBe(true);
  });

  it("runs deltas until the last full refresh ages out, then re-anchors", () => {
    const c = { token: "tok", fullAt: 1_000_000 };
    expect(needsFullRefresh(c, 1_000_000 + FULL_REFRESH_MAX_AGE_MS - 1, true)).toBe(false);
    expect(needsFullRefresh(c, 1_000_000 + FULL_REFRESH_MAX_AGE_MS, true)).toBe(true);
  });

  it("re-anchors when a clock jump puts the last refresh in the future", () => {
    // A backwards clock (timezone repair, NTP correction) makes `now - fullAt`
    // negative, which a plain age check would read as "very fresh" and grant an
    // unbounded delta run until the clock caught up.
    const c = { token: "tok", fullAt: 5_000_000 };
    expect(needsFullRefresh(c, 1_000, true)).toBe(true);
  });
});
