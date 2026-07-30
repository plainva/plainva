import { describe, expect, it } from "vitest";
import {
  clampMailColumns,
  mailColumnsKey,
  mailGridTemplate,
  parseMailColumns,
  MAIL_DEFAULT_COLUMNS,
  MAIL_MIN_FOLDERS,
  MAIL_MIN_LIST,
  MAIL_MIN_READER,
} from "./mailColumns";

/**
 * P8.1: the three mail columns are draggable now. The arithmetic is the whole
 * risk — a drag that pushes the reader off screen would hide the panel the other
 * two columns exist for, and a stored width from a wider window must not do that
 * either.
 */
describe("clampMailColumns", () => {
  it("keeps a comfortable pair untouched", () => {
    expect(clampMailColumns({ folders: 240, list: 360 }, 1400)).toEqual({ folders: 240, list: 360 });
  });

  it("holds each column's minimum", () => {
    const cols = clampMailColumns({ folders: 10, list: 10 }, 1400);
    expect(cols.folders).toBe(MAIL_MIN_FOLDERS);
    expect(cols.list).toBe(MAIL_MIN_LIST);
  });

  it("never lets the reader fall below its minimum", () => {
    // A drag far to the right: the list gives back first — it can still show a
    // sender and a subject, while a 100px reader shows nothing.
    const available = 900;
    const cols = clampMailColumns({ folders: 210, list: 800 }, available);
    expect(available - cols.folders - cols.list).toBeGreaterThanOrEqual(MAIL_MIN_READER);
    expect(cols.folders).toBe(210);
    expect(cols.list).toBe(available - 210 - MAIL_MIN_READER);
  });

  it("takes from the folder rail only after the list is at its minimum", () => {
    const available = MAIL_MIN_LIST + MAIL_MIN_READER + 100; // 100px left for the rail
    const cols = clampMailColumns({ folders: 400, list: 400 }, available);
    expect(cols.list).toBe(MAIL_MIN_LIST);
    expect(cols.folders).toBe(MAIL_MIN_FOLDERS); // clamped, not squeezed below
  });

  it("passes a pair through before layout is known", () => {
    // First render: the container has no width yet. Clamping against 0 would
    // collapse everything to the minimums and then persist that.
    expect(clampMailColumns({ folders: 300, list: 420 }, 0)).toEqual({ folders: 300, list: 420 });
  });

  it("rounds to whole pixels", () => {
    expect(clampMailColumns({ folders: 240.4, list: 360.6 }, 1400)).toEqual({ folders: 240, list: 361 });
  });
});

describe("stored widths", () => {
  it("falls back to the defaults for anything unusable", () => {
    for (const raw of [null, "", "not json", "{}", '{"folders":"wide"}', "[]"]) {
      expect(parseMailColumns(raw), `for ${JSON.stringify(raw)}`).toEqual(MAIL_DEFAULT_COLUMNS);
    }
  });

  it("round-trips a pair and applies the minimums", () => {
    expect(parseMailColumns(JSON.stringify({ folders: 260, list: 340 }))).toEqual({ folders: 260, list: 340 });
    expect(parseMailColumns(JSON.stringify({ folders: 10, list: 10 }))).toEqual({
      folders: MAIL_MIN_FOLDERS,
      list: MAIL_MIN_LIST,
    });
  });

  it("is remembered per vault", () => {
    expect(mailColumnsKey("C:/notes")).not.toBe(mailColumnsKey("C:/other"));
    expect(mailColumnsKey("C:/notes")).toContain("C:/notes");
  });
});

describe("mailGridTemplate", () => {
  it("puts a handle track between the columns and gives the rest to the reader", () => {
    expect(mailGridTemplate({ folders: 210, list: 320 })).toBe("210px 5px 320px 5px minmax(0, 1fr)");
  });
});
