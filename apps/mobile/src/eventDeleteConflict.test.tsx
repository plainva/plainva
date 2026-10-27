// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PimConflictError, type PimEventRow } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { useEventEditor } from "./components/useEventEditor";

/**
 * Deleting an event that "changed elsewhere", on the phone (issue 119, plan
 * Rückmeldungen 2026-10-26, R2).
 *
 * Before: a conflict ended in the generic "The event was not deleted" with a
 * "Try again" that sent the same stale etag - and no pull had run, because the
 * phone threw before it. Now the phone asks what the desktop asks, and "delete
 * anyway" is sent with the etag the provider named.
 */

const { deletePimEvent, mConfirm, toastError } = vi.hoisted(() => ({
  deletePimEvent: vi.fn(),
  mConfirm: vi.fn(async () => true),
  toastError: vi.fn(),
}));

vi.mock("./services/pim/pimService", () => ({
  createPimEvent: vi.fn(),
  deletePimEvent,
  detachPimBlocker: vi.fn(),
  listPimCalendars: vi.fn(async () => []),
  openMeetingNoteFor: vi.fn(),
  pimBlockersOf: vi.fn(async () => []),
  pimSeriesDeleteSubject: vi.fn(async () => null),
  pimSeriesMaster: vi.fn(async () => null),
  pimSourceOfBlocker: vi.fn(async () => null),
  recordPimBlockers: vi.fn(),
  pimSyncNow: vi.fn(),
  pimTargetForAccount: vi.fn(async () => null),
  respondToPimEvent: vi.fn(),
  updatePimEvent: vi.fn(),
  writablePimCalendarOptions: vi.fn(async () => []),
}));
vi.mock("./services/mobileDialogs", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mConfirm,
  mActions: vi.fn(async () => null),
}));
vi.mock("@plainva/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: { ...(actual.toast as object), error: toastError, info: vi.fn(), success: vi.fn(), warning: vi.fn() } };
});

const event: PimEventRow = {
  accountId: "a1",
  calendarId: "c1",
  uid: "ev-1",
  title: "Planning",
  start: { ts: Date.parse("2026-10-26T10:00:00Z") },
  end: { ts: Date.parse("2026-10-26T11:00:00Z") },
  allDay: false,
  etag: '"v1"',
  href: "https://dav/cal/ev-1.ics",
};

function Host({ e }: { e: PimEventRow }) {
  const editor = useEventEditor();
  useEffect(() => editor.openEvent(e), []); // eslint-disable-line react-hooks/exhaustive-deps
  return editor.element;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function openAndDelete() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Host e={event} />));
  const del = document.querySelector<HTMLButtonElement>('[data-testid="event-peek-delete"]');
  expect(del).not.toBeNull();
  await act(async () => del!.click());
  // The confirmation, the provider's answer and the question that follows.
  for (let i = 0; i < 10; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
  // Answers queued for one test never reach the next.
  deletePimEvent.mockReset();
  mConfirm.mockReset();
  mConfirm.mockImplementation(async () => true);
});

describe("deleting an event that changed elsewhere (phone)", () => {
  it("asks as the desktop asks, and 'delete anyway' is sent with the etag the provider named", async () => {
    deletePimEvent.mockRejectedValueOnce(new PimConflictError("changed", '"v2"')).mockResolvedValueOnce({ followed: [], failed: [] });
    await openAndDelete();
    expect(mConfirm).toHaveBeenCalledTimes(2);
    const asked = (mConfirm.mock.calls[1] as unknown as [{ message: string; danger?: boolean }])[0];
    expect(asked.message).toBe(i18n.t("pim.eventChangedDeleteAnyway", { title: "Planning" }));
    expect(asked.danger).toBe(true);
    expect(deletePimEvent).toHaveBeenCalledTimes(2);
    expect(deletePimEvent.mock.calls[1][0]).toMatchObject({ uid: "ev-1", etag: '"v2"' });
    expect(deletePimEvent.mock.calls[1][2]).toEqual({ anyway: true });
    // Not the generic refusal with a retry of the same stale etag.
    expect(toastError).not.toHaveBeenCalled();
  });

  it("'keep it' deletes nothing more", async () => {
    deletePimEvent.mockRejectedValueOnce(new PimConflictError("changed", '"v2"'));
    mConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await openAndDelete();
    expect(deletePimEvent).toHaveBeenCalledTimes(1);
  });

  it("any other refusal is still said once, with the way to try again", async () => {
    deletePimEvent.mockRejectedValueOnce(new Error("503"));
    await openAndDelete();
    expect(mConfirm).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
