// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { PimEventRow } from "@plainva/core";
import { EventPeek } from "./EventPeek";

/** Resolving through the real English catalogue: every key the preview asks for must exist. */
vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
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

const TEAMS = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0";
const SAFE =
  "https://nam12.safelinks.protection.outlook.com/?url=" +
  encodeURIComponent("https://contoso.sharepoint.com/sites/Planung/Q4.docx") +
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
    description: `Microsoft Teams meeting\nDocuments: ${SAFE}`,
    meetingUrl: TEAMS,
    ...partial,
  } as PimEventRow;
}

function peek(e: PimEventRow, onOpenUrl = vi.fn()) {
  return render(
    <EventPeek
      event={e}
      rows={[e]}
      calendarName="Work"
      onClose={() => {}}
      onEdit={() => {}}
      onMeetingNote={() => {}}
      onEmailInvite={() => {}}
      onDelete={() => {}}
      onOpenUrl={onOpenUrl}
    />
  );
}

/**
 * The desktop event preview (plan Befunde 24.09., E25): the description is the
 * shared EventDescription — links that reach the app's opener and show where
 * they lead — and the meeting's own join link is a button.
 */
describe("EventPeek (desktop)", () => {
  it("shows a Safe Link by its target's host and opens the Safe Link itself", () => {
    const onOpenUrl = vi.fn();
    const { host, unmount } = peek(event(), onOpenUrl);
    try {
      const body = host.ownerDocument.querySelector('[data-testid="event-peek-body"]')!;
      const link = body.querySelector("a.pv-evtdesc__link") as HTMLAnchorElement;
      expect(link.textContent).toBe("contoso.sharepoint.com");
      expect(link.getAttribute("href")).toBe(SAFE);
      expect(body.querySelector(".pv-evtdesc__via")?.textContent).toBe("via Microsoft Safe Links");
      // Nothing of the encoded address is on screen.
      expect(body.textContent).not.toContain("safelinks");
      act(() => { link.click(); });
      expect(onOpenUrl).toHaveBeenCalledWith(SAFE);
    } finally { unmount(); }
  });

  it("offers Join, named after the service, and opens the meeting's own link", () => {
    const onOpenUrl = vi.fn();
    const { host, unmount } = peek(event(), onOpenUrl);
    try {
      const join = host.ownerDocument.querySelector('[data-testid="event-join"]') as HTMLButtonElement;
      expect(join.textContent).toBe("Join · Teams");
      act(() => { join.click(); });
      expect(onOpenUrl).toHaveBeenCalledWith(TEAMS);
    } finally { unmount(); }
  });

  it("has no Join button for an event without an online meeting", () => {
    const { host, unmount } = peek(event({ meetingUrl: undefined }));
    try {
      expect(host.ownerDocument.querySelector('[data-testid="event-join"]')).toBeNull();
    } finally { unmount(); }
  });

  it("never renders the description as HTML", () => {
    const { host, unmount } = peek(event({ description: '<img src=x onerror="alert(1)"> **bold** [x](javascript:alert%281%29)' }));
    try {
      const body = host.ownerDocument.querySelector('[data-testid="event-peek-body"]')!;
      expect(body.querySelector("img")).toBeNull();
      expect(body.querySelector("a")).toBeNull();
      expect(body.querySelector("strong")?.textContent).toBe("bold");
      expect(body.textContent).toContain('<img src=x onerror="alert(1)">');
    } finally { unmount(); }
  });
});
