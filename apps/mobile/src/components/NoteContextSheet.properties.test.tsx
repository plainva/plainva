// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { MobileVault } from "../services/vaultService";
import en from "../../../../packages/ui/src/locales/en.json";

/**
 * The properties of a note in the phone's context sheet, as the index's reader
 * reads them (ADR 0009, addendum 2026-10-22).
 *
 * The sheet reads the note's file with the shared reader. Until 2026-10-22 that
 * reader refused the whole block over one value — an empty `tags:`, a
 * `timestamp` that is a date —, and the sheet then showed not one property of
 * the note and no word why. Now such a note shows its properties; and a block
 * the reader really cannot read is said, as the desktop's panel says it.
 *
 * The note's file and the services around the sheet are faked; the sheet, the
 * shared reader and the shared panel model run for real.
 */

const notes = new Map<string, string>();

vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => lookup(key) }),
  };
});
vi.mock("../services/vaultService", () => ({ vaultOps: { read: async (_vault: unknown, path: string) => notes.get(path) ?? "" } }));
vi.mock("../services/baseOps", () => ({ commitCellValue: async () => {}, resolveGoverningBaseOf: async () => null }));
vi.mock("../services/mobileSettings", () => ({ getMobileSettings: () => ({ verifierName: "" }), updateMobileSettings: () => {} }));
vi.mock("../services/mobileDialogs", () => ({ mPrompt: async () => ({ cancelled: true, value: "" }), mSelect: async () => null }));
vi.mock("./ContextGraph", () => ({ ContextGraph: () => null }));
vi.mock("./VersionsPanel", () => ({ VersionsPanel: () => null }));
vi.mock("./NoteDatabasesSection", () => ({ NoteDatabasesSection: () => null }));
vi.mock("../screens/base/CellEditSheet", () => ({ CellEditSheet: () => null }));
vi.mock("./AddPropertySheet", () => ({ AddPropertySheet: () => null }));

const { NoteContextSheet } = await import("./NoteContextSheet");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault = { vaultId: "v", queryService: null } as unknown as MobileVault;
const UNREADABLE_SENTENCE = (en as { properties: { unreadableBlock: string } }).properties.unreadableBlock;

async function open(text: string) {
  notes.set("Note.md", text);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <NoteContextSheet vault={vault} path="Note.md" onClose={() => {}} onOpenNote={() => {}} onJumpToLine={() => {}} onRestored={() => {}} onMutated={() => {}} />,
    );
  });
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  const keys = [...host.querySelectorAll(".m-prop-key")].map((el) => el.textContent ?? "");
  const hint = host.querySelector('[data-testid="props-unreadable"]')?.textContent ?? null;
  await act(async () => { root.unmount(); });
  host.remove();
  return { keys, hint };
}

describe("the phone's sheet shows a note's properties as the reader reads them", () => {
  it("shows the properties of a note whose block the reader used to refuse over one value", async () => {
    const { keys, hint } = await open("---\ntags:\nowner: Anna\ntimestamp: 2026-06-22\n---\nText\n");
    expect(keys).toEqual(expect.arrayContaining(["tags", "owner", "timestamp"]));
    expect(hint).toBeNull();
  });

  it.each([
    ["a YAML list", "---\n- a\n- list\n---\nText\n"],
    ["YAML that cannot be parsed", "---\ntitle: [unclosed\nowner: Anna\n---\nText\n"],
    // The reader reads these two as a block without properties; the writers refuse them.
    ["a line of prose between the two rules", "---\nA line between two rules\n---\nText\n"],
    ["a number between the two rules", "---\n42\n---\nText\n"],
  ])("says a block it cannot read, instead of showing nothing: %s", async (_label, note) => {
    const { keys, hint } = await open(note);
    expect(hint).toBe(UNREADABLE_SENTENCE);
    expect(keys).not.toContain("owner");
  });

  it("says nothing of the kind for a note it can read, or one without a block", async () => {
    expect((await open("---\nowner: Anna\n---\nText\n")).hint).toBeNull();
    expect((await open("Text\n")).hint).toBeNull();
  });
});
