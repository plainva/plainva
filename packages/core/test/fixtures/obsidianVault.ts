/**
 * The Obsidian fixture vault (TestFlight feedback round Build 91, P0).
 *
 * Three tester reports failed on Obsidian CONVENTIONS none of our fixtures
 * carried: an attachments folder with bare-basename embeds (`![[foto.png]]`,
 * `attachmentFolderPath` in `.obsidian/app.json`), a daily-note format with
 * dots (`YY.MM.DD` in a `Tagebuch` folder), and a tag-sourced `.base` without
 * a folder source. This vault holds all three, plus a note whose `.CONFLICT`
 * sibling is already on disk, the Tasks-plugin emoji format and a callout
 * dashboard — the shape of a real Obsidian vault, small enough to copy per
 * test.
 *
 * Tests copy it to a temp directory and never touch the checked-in files.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const OBSIDIAN_VAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "obsidian-vault");

/** Vault-relative paths the fixture guarantees (mirrors the checked-in tree). */
export const OBSIDIAN_FIXTURE = {
  dailyNote: "Tagebuch/26.08.31.md",
  dailyFolder: "Tagebuch",
  dailyFormat: "YY.MM.DD",
  attachment: "Anhänge/foto.png",
  attachmentFolder: "Anhänge",
  tagBase: "Zettel.base",
  tagNotes: ["Zettel/Erste Idee.md", "Zettel/Zweite Idee.md"],
  inboxNote: "Inbox/Notiz 1.md",
  inboxConflict: "Inbox/Notiz 1.CONFLICT-2026-09-04T17-27-28-950Z.md",
  dashboard: "Dashboard.md",
} as const;

/** Copies the fixture vault into a fresh temp directory and returns its path. */
export async function copyObsidianVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-obsidian-"));
  await fs.cp(OBSIDIAN_VAULT_DIR, dir, { recursive: true });
  return dir;
}
