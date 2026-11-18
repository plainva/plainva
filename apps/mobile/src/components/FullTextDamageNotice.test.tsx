// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { noteFullTextDamage, type IDatabaseAdapter } from "@plainva/core";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * What the phone's search says when it failed on a damaged full-text index:
 * the same three sentences as the desktop's, and "Rebuild index" — asked
 * first, the strip's question — only where the open could not make the
 * full-text index anew in an ordinary vault.
 */

const calls = vi.hoisted(() => ({ asked: [] as string[], rebuilt: 0 }));
vi.mock("../services/vaultService", () => ({
  rebuildActiveIndexDatabase: async () => { calls.rebuilt += 1; return true; },
}));
vi.mock("../services/mobileDialogs", () => ({
  mConfirm: async (input: { message: string }) => { calls.asked.push(input.message); return true; },
}));

import { FullTextDamageNotice, useSearchDamageNotice } from "./FullTextDamageNotice";

/** The search: the notice where the note (or the failure's words) says so, else the ordinary retry. */
function Probe({ vault, damaged }: { vault: never; damaged: boolean }) {
  const notice = useSearchDamageNotice(vault, { failed: true, damaged });
  return notice ? <FullTextDamageNotice notice={notice} /> : <span data-testid="ordinary-failure">retry</span>;
}

let root: Root | undefined;
let host: HTMLElement;
let db: IDatabaseAdapter;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  calls.asked = [];
  calls.rebuilt = 0;
  db = await realSqlite();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const failedAttempt = () =>
  db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('full_text_damaged', ?)`, [JSON.stringify({ at: "2026-11-18T10:00:00.000Z", failed: { at: "2026-11-18T10:05:00.000Z", count: 1, reason: "(code: 11) database disk image is malformed" } })]);
const vault = (isEncryptedWorkspace: boolean) => ({ db, isEncryptedWorkspace }) as never;
const button = () => host.querySelector<HTMLButtonElement>('[data-testid="search-rebuild-index"]');

describe("the phone's search on a damaged full-text index", () => {
  it("noted: the next open makes it anew, no button", async () => {
    await noteFullTextDamage(db);
    await act(async () => root!.render(<Probe vault={vault(false)} damaged />));
    await settle();
    expect(host.textContent).toContain(i18n.t("errors.fullTextDamaged"));
    expect(button()).toBeNull();
  });

  it("the open's attempt failed in an ordinary vault: sentence B with the button, asked first", async () => {
    await failedAttempt();
    await act(async () => root!.render(<Probe vault={vault(false)} damaged />));
    await settle();
    expect(host.textContent).toContain(i18n.t("errors.fullTextRebuildFailed", { action: i18n.t("settings.rebuildIndexAction") }));
    await act(async () => button()!.click());
    await settle();
    expect(calls.asked).toEqual([i18n.t("indexDatabase.rebuildConfirm")]);
    expect(calls.rebuilt).toBe(1);
  });

  it("the search failed in SQLite's generic words (iOS): the note decides — sentence B with the button", async () => {
    await failedAttempt();
    await act(async () => root!.render(<Probe vault={vault(false)} damaged={false} />));
    await settle();
    expect(host.textContent).toContain(i18n.t("errors.fullTextRebuildFailed", { action: i18n.t("settings.rebuildIndexAction") }));
    expect(button()).not.toBeNull();
  });

  it("the open's attempt failed in an encrypted workspace: sentence C, no button", async () => {
    await failedAttempt();
    await act(async () => root!.render(<Probe vault={vault(true)} damaged />));
    await settle();
    expect(host.textContent).toContain(i18n.t("errors.fullTextRebuildFailedWorkspace"));
    expect(button()).toBeNull();
  });
});
