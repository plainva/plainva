// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { MobileVault } from "../../services/vaultService";

/**
 * An empty date-and-time cell on the phone (Sammelplan § 3.132 Nr. 5).
 *
 * The picker shows today as the picked day and a time beside it, and "OK" wrote
 * nothing: the cell stayed empty, though the sheet showed a moment. The
 * desktop's picker writes what it shows (today, now). One rule now: "OK" takes
 * the day and the time on screen.
 */
vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => lookup(key) }),
  };
});
vi.mock("../../services/baseOps", () => ({ relationCandidates: async () => [] }));

const { CellEditSheet } = await import("./CellEditSheet");
const { calendarDay } = await import("@plainva/ui");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault = { vaultId: "v", queryService: null, files: null } as unknown as MobileVault;
let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

async function openDateTime(value: unknown) {
  const committed: unknown[] = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <CellEditSheet
        vault={vault}
        target={{ notePath: "Note.md", col: "when", input: "datetime", value, options: [] }}
        rows={[]}
        onCommit={(v) => committed.push(v)}
        onClose={() => {}}
      />,
    );
  });
  const time = host.querySelector<HTMLInputElement>('[data-testid="cell-date-time"]')!;
  const ok = time.parentElement!.querySelector<HTMLButtonElement>("button")!;
  return { committed, time, ok };
}

describe("the date-and-time cell on the phone", () => {
  it("writes the day and the time it shows when it was empty", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 14, 7));
    const { committed, time, ok } = await openDateTime(null);
    // The sheet shows today, now - as the desktop's picker does.
    expect(time.value).toBe("14:07");
    expect(host!.querySelector(`[data-day="${calendarDay()}"]`)?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { ok.click(); });
    expect(committed).toEqual([`${calendarDay()}T14:07`]);
  });

  it("keeps a value that is no date as it is", async () => {
    const { committed, ok } = await openDateTime("someday");
    await act(async () => { ok.click(); });
    expect(committed).toEqual(["someday"]);
  });

  it("writes a picked moment as before", async () => {
    const { committed, ok } = await openDateTime("2026-10-21 09:30");
    await act(async () => { ok.click(); });
    expect(committed).toEqual(["2026-10-21T09:30"]);
  });
});
