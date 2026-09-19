// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { pimTraceEnabled, tracePimTasks } from "@plainva/core";
import { clearDiagnosticsForTests, formatDiagnosticsExport, formatPimTraceExport, initPimTrace, isPimTraceEnabled, recordPimTrace, setPimTraceEnabled } from "@plainva/ui";

/**
 * The task trace's shell side (finding 2026-09-19): a device switch, a buffer
 * that survives a restart, and a section in the diagnostics export that is
 * there only while it has something to say.
 */
const row = (id: string, status: string) => ({ id, status, title: "Daily", titleHash: "abcd1234" });
const info = { appVersion: "9.9.9", tauriVersion: "-", os: "test", language: "en" };

afterEach(() => {
  setPimTraceEnabled(false);
  clearDiagnosticsForTests();
});

describe("the switch", () => {
  it("is off by default, installs the listener when on, and forgets everything when off", () => {
    expect(isPimTraceEnabled()).toBe(false);
    expect(pimTraceEnabled()).toBe(false);
    expect(formatPimTraceExport()).toEqual([]);

    setPimTraceEnabled(true);
    expect(pimTraceEnabled()).toBe(true);
    tracePimTasks("google", "list-1", [row("t1", "needsAction")], 1_000);
    expect(formatPimTraceExport().join("\n")).toContain("| t1 | needsAction |");

    setPimTraceEnabled(false);
    expect(pimTraceEnabled()).toBe(false);
    expect(formatPimTraceExport()).toEqual([]);
  });

  it("comes back after a restart when it was left on", () => {
    setPimTraceEnabled(true);
    // A restart: the flag is still in the store, the listener is gone.
    initPimTrace();
    expect(pimTraceEnabled()).toBe(true);
  });
});

describe("the buffer", () => {
  it("joins the pages of ONE pull and keeps two pulls apart - the comparison needs both", () => {
    setPimTraceEnabled(true);
    recordPimTrace({ provider: "google", listId: "l1", at: 1_000, rows: [row("t1", "needsAction")] });
    recordPimTrace({ provider: "google", listId: "l1", at: 3_000, rows: [row("t2", "needsAction")] });
    recordPimTrace({ provider: "google", listId: "l1", at: 900_000, rows: [row("t1", "completed")] });
    const text = formatPimTraceExport().join("\n");
    expect(text.match(/^### google/gm)).toHaveLength(2);
    expect(text).toContain("2 Zeilen");
    expect(text).toContain("| t1 | completed |");
  });

  it("keeps a bounded number of pulls, oldest first out", () => {
    setPimTraceEnabled(true);
    for (let i = 0; i < 30; i++) recordPimTrace({ provider: "google", listId: `l${i}`, at: i * 60_000, rows: [row("t", "needsAction")] });
    const text = formatPimTraceExport().join("\n");
    expect(text.match(/^### google/gm)).toHaveLength(24);
    expect(text).not.toContain("Liste l0 ");
    expect(text).toContain("Liste l29 ");
  });

  it("escapes what would break the table", () => {
    setPimTraceEnabled(true);
    recordPimTrace({ provider: "google", listId: "l1", at: 1, rows: [{ id: "t1", title: "a|b", titleHash: "h" }] });
    expect(formatPimTraceExport().join("\n")).toContain("a\\|b");
  });
});

describe("the diagnostics export", () => {
  it("carries the section only while the trace has something to say", () => {
    expect(formatDiagnosticsExport(info)).not.toContain("Aufgaben-Rohdaten");
    setPimTraceEnabled(true);
    expect(formatDiagnosticsExport(info)).toContain("noch kein Abruf aufgezeichnet");
    tracePimTasks("google", "l1", [row("t1", "needsAction")], 5);
    expect(formatDiagnosticsExport(info)).toContain("| t1 | needsAction |");
  });
});
