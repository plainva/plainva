// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { WorkspaceQuarantineRecord } from "@plainva/core";
import { QuarantineCard } from "./QuarantineCard";

/** Resolving through the real English catalogue: every key the card asks for must exist. */
vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string | undefined => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : undefined;
  };
  return {
    useTranslation: () => ({
      i18n: { language: "en" },
      t: (key: string, vars?: Record<string, string | number>) => {
        const count = vars?.count;
        const value = (typeof count === "number" ? lookup(`${key}_${count === 1 ? "one" : "other"}`) : undefined) ?? lookup(key) ?? key;
        return vars ? Object.entries(vars).reduce((out, [name, v]) => out.split(`{{${name}}}`).join(String(v)), value) : value;
      },
    }),
  };
});

function render(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => act(() => { root.unmount(); }) };
}

function record(over: Partial<WorkspaceQuarantineRecord> & { quarantineId: string }): WorkspaceQuarantineRecord {
  return {
    artifactKind: "operation", remoteKey: `.pvws/operations/${over.quarantineId}.pvop`, artifactBase64: "AA==", artifactSha256: "00",
    errorCode: "integrity", reasonCode: "operation.chainGap", reason: "device operation chain has a gap or predecessor mismatch", details: null,
    firstSeenAt: "2026-09-03T10:00:00.000Z", lastTriedAt: "2026-09-03T10:00:00.000Z", status: "pending", resolvedAt: null, ...over,
  };
}

const gapGroup = [
  record({ quarantineId: "g", details: { deviceId: "d1", deviceName: "ASUS-Windows", expectedSequence: 14, foundSequence: 16 } }),
  record({ quarantineId: "b1", reasonCode: "operation.chainBlocked", reason: "blocked", details: { deviceId: "d1", deviceName: "ASUS-Windows", sequence: 17, blockedBy: "g" } }),
  record({ quarantineId: "b2", reasonCode: "operation.chainBlocked", reason: "blocked", details: { deviceId: "d1", deviceName: "ASUS-Windows", sequence: 18, blockedBy: "g" } }),
];

function props(over: Partial<React.ComponentProps<typeof QuarantineCard>> = {}): React.ComponentProps<typeof QuarantineCard> {
  return {
    quarantine: gapGroup, localForks: [], busy: false,
    onRetry: vi.fn(async () => ({ open: 3, total: 3, checked: true })),
    onIgnore: vi.fn(async () => {}), onRepaired: vi.fn(async () => {}),
    onExportDiagnostics: vi.fn(async () => {}), onExportCiphertext: vi.fn(async () => {}),
    ...over,
  };
}

/**
 * The integrity card as a person reads it (finding 2026-09-03): a cascade is
 * one group with the numbers of the gap, settled groups hide behind "All",
 * and the actions reach the service with the group's ids.
 */
describe("QuarantineCard", () => {
  it("shows a broken chain as ONE group that names the device and the sequence numbers", () => {
    const { host, unmount } = render(<QuarantineCard {...props()} />);
    try {
      const groups = host.querySelectorAll("[data-testid=quarantine-group]");
      expect(groups).toHaveLength(1);
      const text = groups[0].textContent ?? "";
      expect(text).toContain("the chain is broken");
      expect(text).toContain("3 entries");
      expect(text).toContain("ASUS-Windows");
      expect(text).toContain("no. 14");
      expect(text).toContain("no. 16");
      expect(text).toContain("What you can do:");
      // Nothing raw leaks into the reading: the sentence sits behind the entries toggle.
      expect(text).not.toContain("predecessor mismatch");
      act(() => { (host.querySelector("[data-testid=quarantine-toggle-entries]") as HTMLElement).click(); });
      expect(host.querySelectorAll(".pv-quarantine-entry")).toHaveLength(3);
      expect(host.textContent).toContain("predecessor mismatch");
    } finally { unmount(); }
  });

  it("hides a settled group under Open and brings it back under All, marked as resolved by itself", () => {
    const settled = record({ quarantineId: "s", artifactKind: "catalog", reasonCode: "catalog.signature", status: "resolved", resolvedAt: "2026-09-03T11:00:00.000Z" });
    const { host, unmount } = render(<QuarantineCard {...props({ quarantine: [...gapGroup, settled] })} />);
    try {
      expect(host.querySelectorAll("[data-testid=quarantine-group]")).toHaveLength(1);
      act(() => { (host.querySelector("[data-testid=quarantine-filter-all]") as HTMLElement).click(); });
      const groups = host.querySelectorAll("[data-testid=quarantine-group]");
      expect(groups).toHaveLength(2);
      expect(groups[1].className).toContain("is-settled");
      expect(groups[1].textContent).toContain("Resolved itself");
      expect(groups[1].querySelector("[data-testid=quarantine-recheck]")).toBeNull();
    } finally { unmount(); }
  });

  it("hands the open ids of the group to check again and to ignore", async () => {
    const p = props();
    const { host, unmount } = render(<QuarantineCard {...p} />);
    try {
      await act(async () => { (host.querySelector("[data-testid=quarantine-recheck]") as HTMLElement).click(); });
      // The entries of a group are ordered by time, then key - the ids follow.
      expect(p.onRetry).toHaveBeenCalledWith(["b1", "b2", "g"]);
      // The retry left everything open: the group says so.
      expect(host.textContent).toContain("same cause");
      act(() => { (host.querySelector("[data-testid=quarantine-more]") as HTMLElement).click(); });
      const ignore = document.querySelector("[data-testid=quarantine-ignore-group]") as HTMLElement | null;
      expect(ignore).not.toBeNull();
      expect(ignore!.textContent).toContain("(3)");
      await act(async () => { ignore!.click(); });
      expect(p.onIgnore).toHaveBeenCalledWith(["b1", "b2", "g"]);
    } finally { unmount(); }
  });

  it("falls back to the raw sentence for a legacy entry without a cause, and lists forks with their reason", () => {
    const legacy = record({ quarantineId: "old", reasonCode: "unknown", reason: "some old sentence", artifactKind: "head" });
    const { host, unmount } = render(<QuarantineCard {...props({ quarantine: [legacy], localForks: [{ forkId: "f1", originalPath: "Projects/Site.md", forkPath: "Projects/Site (fork).md", reason: "parallel-write", createdAt: "2026-09-03T10:00:00.000Z" }], onOpenPath: vi.fn() })} />);
    try {
      const group = host.querySelector("[data-testid=quarantine-group]")!;
      expect(group.textContent).toContain("A check failed");
      expect(group.textContent).toContain("Device pointer: some old sentence");
      const fork = host.querySelector("[data-testid=quarantine-fork]")!;
      expect(fork.textContent).toContain("Projects/Site (fork).md");
      expect(fork.textContent).toContain("Written at the same time");
    } finally { unmount(); }
  });
});
