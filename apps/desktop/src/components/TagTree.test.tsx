// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";

/**
 * What the vault-wide tag rename REPORTS (S6, 2026-08-12).
 *
 * `renameTagAcrossVault` counts per-note write failures for a reason; the
 * desktop took only `notes` and threw `failed` away. A rename in which every
 * write failed reported "renamed in 0 notes" as a success — the notes still
 * carried the old tag, and nothing said so. The phone was fixed in `1797007e`;
 * this pins the desktop half.
 *
 * The shell is mocked (context, dialogs); the shared rename helper and the
 * component's own branching run for real, so this cannot pass against its own
 * mocks.
 */

const prompt = vi.fn();
const message = vi.fn();
vi.mock("../services/appDialogs", () => ({
  appPrompt: (...args: unknown[]) => prompt(...args),
  appMessage: (...args: unknown[]) => message(...args),
}));

const vaultState = {
  notes: new Map<string, string>(),
  unwritable: new Set<string>(),
};

// One stable object for the whole file: a fresh one per render would change
// the effect deps on every pass and spin the component forever.
const vaultContext = {
  fileTreeVersion: 0,
  triggerFileTreeUpdate: () => {},
  queryService: {
    getAllTags: async () => [{ tag: "work", count: vaultState.notes.size }],
    findNotesWithTag: async () => [...vaultState.notes.keys()],
    getFilesByTag: async () => [...vaultState.notes.keys()].map((p) => ({ path: p, title: p })),
  },
  vaultAdapter: {
    readTextFile: async (p: string) => vaultState.notes.get(p) ?? "",
    writeTextFile: async (p: string, c: string) => {
      // A read-only note: the write is where it fails, exactly as on disk.
      if (vaultState.unwritable.has(p)) throw new Error("EACCES: read-only");
      vaultState.notes.set(p, c);
    },
  },
};

vi.mock("../contexts/VaultContext", () => ({ useVault: () => vaultContext }));

import { TagTree } from "./TagTree";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  prompt.mockReset();
  message.mockReset();
  vaultState.notes = new Map();
  vaultState.unwritable = new Set();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renameWorkTag(): Promise<void> {
  await act(async () => {
    root.render(<TagTree onSelectPath={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  const row = Array.from(container.querySelectorAll<HTMLElement>(".pv-rowhover")).find((el) =>
    el.textContent?.includes("work"),
  );
  if (!row) throw new Error("tag row not rendered");
  await act(async () => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
}

function reportedMessage(): string {
  expect(message).toHaveBeenCalledTimes(1);
  return String((message.mock.calls[0][0] as { message: string }).message);
}

describe("TagTree — vault-wide rename reporting", () => {
  it("names how many notes could NOT be written", async () => {
    vaultState.notes.set("a.md", "#work\n");
    vaultState.notes.set("b.md", "#work\n");
    vaultState.unwritable.add("a.md");
    prompt.mockResolvedValue("job");

    await renameWorkTag();

    const text = reportedMessage();
    // Two notes carried the tag, one write failed: the report must say so.
    expect(text).toContain("1");
    expect(text).toMatch(/could not be written/i);
    // And it must not be the plain success sentence.
    expect(text).not.toBe(
      i18n.t("tags.renameDone", { old: "work", new: "job", notes: 1 }),
    );
    // The unwritable note still carries the old tag — that is the fact the
    // old report hid.
    expect(vaultState.notes.get("a.md")).toContain("#work");
    expect(vaultState.notes.get("b.md")).toContain("#job");
  });

  it("reports a clean rename as a plain success (no failure wording)", async () => {
    vaultState.notes.set("a.md", "#work\n");
    prompt.mockResolvedValue("job");

    await renameWorkTag();

    const text = reportedMessage();
    expect(text).not.toMatch(/could not be written/i);
    expect(text).toContain("1");
    expect(vaultState.notes.get("a.md")).toContain("#job");
  });

  it("a rename in which EVERY write fails is not reported as done", async () => {
    vaultState.notes.set("a.md", "#work\n");
    vaultState.unwritable.add("a.md");
    prompt.mockResolvedValue("job");

    await renameWorkTag();

    // The old code said "renamed in 0 notes" here — technically true, read as
    // a completed rename.
    expect(reportedMessage()).toMatch(/could not be written/i);
  });
});
