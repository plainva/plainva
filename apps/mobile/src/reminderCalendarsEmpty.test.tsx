// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { PimAccountsScreen } from "./screens/PimAccountsScreen";

/**
 * "Nur diese Kalender" answers even when there is nothing to choose from
 * (finding D9, 2026-08-24).
 *
 * The row looked exactly as operable as any other — value, chevron, tap target
 * — and returned without a word whenever the calendar list was empty
 * (`if (calendars.length === 0) return;`). The guard is old; what changed is
 * that the list now IS empty more often, because the cycle that fills it does
 * not run in the background. So this is two defects in one place: a symptom of
 * the PIM root, and a control whose reservation you cannot see — the same
 * class as the mail empty state and "focus on selection".
 *
 * Asserted as behaviour, not source text: the sheet-opening code was in the
 * file the whole time, one branch away from ever running.
 */

const calendars: unknown[] = [];
const accounts: unknown[] = [];

const { pimSyncNow } = vi.hoisted(() => ({ pimSyncNow: vi.fn() }));
const { mConfirm, mMultiSelect } = vi.hoisted(() => ({
  mConfirm: vi.fn(async () => false),
  mMultiSelect: vi.fn(async () => null),
}));

vi.mock("./services/pim/pimService", () => ({
  listPimAccounts: vi.fn(async () => accounts),
  listPimCalendars: vi.fn(async () => calendars),
  listPimTaskLists: vi.fn(async () => []),
  pimForegroundSync: vi.fn(),
  pimSyncNow,
  setPimCalendarSelected: vi.fn(async () => {}),
  setPimTaskListSelected: vi.fn(async () => {}),
  addPimAccount: vi.fn(async () => {}),
  reauthorizePimAccount: vi.fn(async () => {}),
  removePimAccount: vi.fn(async () => {}),
  getPimCache: () => null,
}));
vi.mock("./services/mobileDialogs", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mConfirm,
  mMultiSelect,
  mSelect: vi.fn(async () => null),
  mDayTime: vi.fn(async () => null),
}));
vi.mock("./services/deviceSignIn", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceSignInStates: vi.fn(async () => new Map()),
}));
vi.mock("./services/vaultRegistry", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveVaultEntry: vi.fn(async () => ({ id: "/vault", name: "Vault" })),
}));
vi.mock("./services/mobileSettings", () => ({
  getMobileSettings: () => ({ remindEvents: true, reminderCalendars: [] }),
  updateMobileSettings: vi.fn(async () => {}),
}));
vi.mock("./services/reminderScheduler", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  rescheduleReminders: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calendars.length = 0;
  accounts.length = 0;
  vi.clearAllMocks();
  mConfirm.mockResolvedValue(false);
  setPlatformServices({
    loadSettings: async () => ({
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      keys: async () => [],
      save: async () => {},
    }),
    credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const vault = { vaultId: "/vault" } as never;

async function render() {
  await act(async () => {
    root.render(<PimAccountsScreen bump={0} vault={vault} />);
  });
  await act(async () => {});
}

/**
 * The reminder row that opens the calendar picker. Looked up through the
 * catalogue rather than a German literal, so the test says the same thing
 * whichever language the suite happens to boot in.
 */
const T = (k: string) => i18n.t(k);

function calendarsRow(): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>(".pv-grouprow")].find((r) =>
    r.textContent?.includes(T("reminders.calendars"))
  );
}

describe("the calendar picker with nothing to pick", () => {
  it("says so on the row before it is tapped", async () => {
    accounts.push({ id: "a1", label: "ada@example.com", enabled: true, kind: "google" });
    await render();
    // "Alle" would be a lie here: it reads the same as "every calendar
    // reminds", and those two states could not be more different to a reader.
    expect(calendarsRow()?.textContent).toContain(T("reminders.calendarsNone"));
  });

  it("names the missing account instead", async () => {
    await render();
    expect(calendarsRow()?.textContent).toContain(T("reminders.calendarsNoAccount"));
  });

  it("offers a refresh rather than doing nothing", async () => {
    accounts.push({ id: "a1", label: "ada@example.com", enabled: true, kind: "google" });
    await render();
    await act(async () => calendarsRow()?.click());
    expect(mConfirm).toHaveBeenCalledTimes(1);
    // Not the multi-select: there is nothing in it.
    expect(mMultiSelect).not.toHaveBeenCalled();
  });

  it("an accepted refresh asks for a cycle right away", async () => {
    accounts.push({ id: "a1", label: "ada@example.com", enabled: true, kind: "google" });
    mConfirm.mockResolvedValue(true);
    await render();
    await act(async () => calendarsRow()?.click());
    // Deliberately the un-throttled trigger: the person just said "now", and a
    // silent no-op is what got us here.
    expect(pimSyncNow).toHaveBeenCalledTimes(1);
  });

  it("explains rather than offering a pointless refresh with no account", async () => {
    await render();
    await act(async () => calendarsRow()?.click());
    expect(mConfirm).toHaveBeenCalledTimes(1);
    expect(pimSyncNow).not.toHaveBeenCalled();
  });

  it("still opens the picker once there are calendars", async () => {
    accounts.push({ id: "a1", label: "ada@example.com", enabled: true, kind: "google" });
    calendars.push({ accountId: "a1", id: "c1", name: "Privat", selected: true });
    await render();
    expect(calendarsRow()?.textContent).toContain(T("reminders.calendarsAll"));
    await act(async () => calendarsRow()?.click());
    expect(mMultiSelect).toHaveBeenCalledTimes(1);
    expect(mConfirm).not.toHaveBeenCalled();
  });
});
