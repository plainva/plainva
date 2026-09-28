// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PimEventRow } from "@plainva/core";
import { EventPeekSheet } from "./EventPeekSheet";

/** Resolving through the real English catalogue: every key the sheet asks for must exist. */
vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string | undefined => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : undefined;
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({
      i18n: { language: "en" },
      t: (key: string, vars?: Record<string, unknown>) => {
        const count = vars?.count;
        const value = (typeof count === "number" ? lookup(`${key}_${count === 1 ? "one" : "other"}`) : undefined) ?? lookup(key) ?? key;
        return vars
          ? Object.entries(vars).reduce((out, [name, v]) => (name === "defaultValue" ? out : out.split(`{{${name}}}`).join(String(v))), value)
          : value;
      },
    }),
  };
});

function render(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => act(() => { root.unmount(); host.remove(); }) };
}

const MEET = "https://meet.google.com/abc-defg-hij";
const SAFE =
  "https://nam12.safelinks.protection.outlook.com/?url=" +
  encodeURIComponent("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0") +
  "&data=05%7C02%7C%7Cc0ffee&reserved=0";

function event(partial: Partial<PimEventRow> = {}): PimEventRow {
  return {
    accountId: "acc-1",
    calendarId: "cal-1",
    uid: "ev-1",
    title: "Abstimmung Q4-Planung",
    start: { ts: new Date(2026, 8, 24, 14, 0).getTime() },
    end: { ts: new Date(2026, 8, 24, 15, 0).getTime() },
    allDay: false,
    description: `Microsoft Teams Besprechung ${SAFE}`,
    meetingUrl: MEET,
    ...partial,
  } as PimEventRow;
}

function sheet(e: PimEventRow, onOpenUrl = vi.fn()) {
  return render(
    <EventPeekSheet
      event={e}
      rows={[e]}
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onMeetingNote={() => {}}
      onOpenUrl={onOpenUrl}
    />
  );
}

/**
 * The phone's event preview (plan Befunde 24.09., E25; TestFlight 22.09.): the
 * description was raw Markdown in a paragraph — a Safe Link as a page of
 * characters, nothing to tap. It is the shared EventDescription now, with the
 * same Join button as the desktop.
 */
describe("EventPeekSheet (phone)", () => {
  it("makes a Safe Link tappable, names its target and opens the Safe Link itself", () => {
    const onOpenUrl = vi.fn();
    const { host, unmount } = sheet(event(), onOpenUrl);
    try {
      const body = host.querySelector('[data-testid="event-peek-body"]')!;
      const link = body.querySelector("a.pv-evtdesc__link") as HTMLAnchorElement;
      expect(link.textContent).toBe("teams.microsoft.com");
      expect(link.getAttribute("href")).toBe(SAFE);
      expect(body.querySelector(".pv-evtdesc__via")?.textContent).toBe("via Microsoft Safe Links");
      expect(body.textContent).toBe("Microsoft Teams Besprechung teams.microsoft.comvia Microsoft Safe Links");
      act(() => { link.click(); });
      expect(onOpenUrl).toHaveBeenCalledWith(SAFE);
    } finally { unmount(); }
  });

  it("offers Join for the meeting link and nothing without one", () => {
    const onOpenUrl = vi.fn();
    const first = sheet(event(), onOpenUrl);
    try {
      const join = first.host.querySelector('[data-testid="event-join"]') as HTMLButtonElement;
      expect(join.textContent).toBe("Join · Meet");
      act(() => { join.click(); });
      expect(onOpenUrl).toHaveBeenCalledWith(MEET);
    } finally { first.unmount(); }
    const second = sheet(event({ meetingUrl: undefined }));
    try {
      expect(second.host.querySelector('[data-testid="event-join"]')).toBeNull();
    } finally { second.unmount(); }
  });
});
