import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "All events" of a series in a calendar "On this device" (open-items plan
 * 3.130 no. 3). The shared write path hands the device target the series id
 * alone (`seriesDeleteSubject`), and both native stores have to read that as
 * "the whole series": Android deletes the event row, which takes every
 * occurrence with it; the iPhone removed the first occurrence alone
 * (`span: .thisEvent`), so the delete either failed or left the series
 * standing.
 *
 * Neither plugin runs in a test; this reads their source. The behaviour was
 * never seen on a device.
 */

const swift = readFileSync(resolve("ios/App/App/DevicePimPlugin.swift"), "utf8");
const java = readFileSync(resolve("android/app/src/main/java/com/plainva/app/DevicePimPlugin.java"), "utf8");
const body = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  return source.slice(from, source.indexOf(end, from + start.length));
};

describe("deleting a whole series in the device's own calendar (3.130 no. 3)", () => {
  it("the iPhone removes this and all following from the first occurrence when no occurrence is named", () => {
    const remove = body(swift, "@objc func deleteEvent(", "// MARK: - Reminders");
    expect(remove).toContain("span: ts == nil ? .futureEvents : .thisEvent");
    expect(remove).not.toMatch(/span: \.thisEvent,/);
  });

  it("Android deletes the event row, every occurrence with it, when no occurrence is named", () => {
    const remove = body(java, "public void deleteEvent(", "// ----");
    expect(remove).toMatch(/if \(ts != null\) \{[\s\S]*STATUS_CANCELED[\s\S]*\} else \{\s*cr\.delete\(ContentUris\.withAppendedId\(Events\.CONTENT_URI/);
  });
});
