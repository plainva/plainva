// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { noteFullTextDamage, readFullTextDamage, type IDatabaseAdapter } from "@plainva/core";
import type { IndexDatabaseWorkspace } from "@plainva/ui";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * What the desktop's search says when it failed on a damaged full-text index:
 * that the next open makes it anew (noted); where that open's attempt failed,
 * that only "Rebuild index" helps — with the button, asked first, in an
 * ordinary vault (the start's question) — and in an encrypted workspace that
 * Plainva does not build its database anew, without the button.
 */

const vault = vi.hoisted(() => ({
  db: null as IDatabaseAdapter | null,
  workspace: false as IndexDatabaseWorkspace,
  rebuild: null as null | ReturnType<typeof vi.fn>,
}));
vi.mock("../contexts/VaultContext", () => ({
  useVault: () => ({
    dbAdapter: vault.db,
    indexRebuildWorkspace: async () => vault.workspace,
    rebuildDamagedIndexDatabase: vault.rebuild,
  }),
}));
vi.mock("../services/windowContext", () => ({ isOwnerWindow: () => true }));

import { FullTextDamageNotice } from "./FullTextDamageNotice";

let root: Root | undefined;
let host: HTMLElement;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vault.db = await realSqlite();
  vault.workspace = false;
  vault.rebuild = vi.fn(async () => {
    // The start's rebuild: the database is set aside and a new one opened — no note in it.
    vault.db = await realSqlite();
    return true;
  });
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
const failedAttempt = async (db: IDatabaseAdapter) => {
  await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('full_text_damaged', ?)`, [JSON.stringify({ at: "2026-11-18T10:00:00.000Z", failed: { at: "2026-11-18T10:05:00.000Z", count: 1, reason: "(code: 11) database disk image is malformed" } })]);
};
const button = () => host.querySelector<HTMLButtonElement>('[data-testid="search-rebuild-index"]');

describe("the desktop search on a damaged full-text index", () => {
  it("noted: the next open makes it anew, no button", async () => {
    await noteFullTextDamage(vault.db!);
    await act(async () => root!.render(<FullTextDamageNotice damaged />));
    await settle();
    expect(host.textContent).toContain(i18n.t("errors.fullTextDamaged"));
    expect(button()).toBeNull();
  });

  it("the open's attempt failed, an ordinary vault: sentence B with the button; the button asks the start's question and runs the rebuild", async () => {
    await failedAttempt(vault.db!);
    await act(async () => root!.render(<FullTextDamageNotice damaged />));
    await settle();
    expect(host.textContent).toContain(i18n.t("errors.fullTextRebuildFailed", { action: i18n.t("settings.rebuildIndexAction") }));
    expect(button()).not.toBeNull();

    await act(async () => button()!.click());
    expect(document.body.textContent, "asked first").toContain(i18n.t("indexDatabase.rebuildConfirm"));
    expect(vault.rebuild).not.toHaveBeenCalled();
    const confirm = document.querySelector<HTMLButtonElement>('[data-testid="search-rebuild-index-confirm"]')!;
    await act(async () => confirm.click());
    await settle();
    expect(vault.rebuild).toHaveBeenCalledTimes(1);
    expect((await readFullTextDamage(vault.db!)).state, "the new database carries no note").toBe("none");
  });

  it("the open's attempt failed in an encrypted workspace: sentence C, no button", async () => {
    vault.workspace = true;
    await failedAttempt(vault.db!);
    await act(async () => root!.render(<FullTextDamageNotice damaged />));
    await settle();
    expect(host.textContent).toContain(i18n.t("errors.fullTextRebuildFailedWorkspace"));
    expect(button()).toBeNull();
  });

  it("where the workspace state cannot be told: no button either", async () => {
    vault.workspace = "unknown";
    await failedAttempt(vault.db!);
    await act(async () => root!.render(<FullTextDamageNotice damaged />));
    await settle();
    expect(button()).toBeNull();
  });
});
