import type { IVaultAdapter } from "@plainva/core";
import { buildNewNoteContent, wikiTargetToPath } from "@plainva/ui";
import { notifyFileOps } from "./indexMdAutoUpdate";

/**
 * Creating the note behind an unresolved wiki link (maintainer 2026-07-18,
 * Obsidian parity) — the one path for both shells (finding 2026-09-07).
 *
 * This used to live inside `AppShell`'s event handler, which meant an
 * auxiliary window — same editor, same link, same click — created nothing and
 * said nothing. The rules are the same everywhere: an existing target is just
 * opened; the "ask first" setting confirms; the folder is created if missing;
 * the note starts with the vault's configured note type. Only what the shells
 * do AFTER differs (the central window indexes itself, a client's bus write is
 * indexed by the owner), so the indexing step is a callback.
 */
export interface CreateNoteFromLinkDeps {
  vaultAdapter: IVaultAdapter;
  /** Which note type new notes start with — read once per creation, never cached. */
  noteType: () => Promise<string>;
  /** The per-user "ask before creating" setting. */
  askFirst: () => Promise<boolean>;
  /** The confirmation dialog; only called when `askFirst` says so. */
  confirm: (title: string) => Promise<boolean>;
  /** Index the new file; the owner has an indexer, a client leaves it to the owner. */
  index?: (path: string) => Promise<void>;
}

export type CreateNoteFromLinkResult =
  | { outcome: "exists" | "created"; path: string }
  | { outcome: "declined" | "no-title" };

/**
 * Resolves the link target to a path and creates the note when it is missing.
 * Throws on a write failure — the caller shows the error, this only decides.
 */
export async function createNoteFromLink(
  target: string,
  hostPath: string | undefined,
  deps: CreateNoteFromLinkDeps,
): Promise<CreateNoteFromLinkResult> {
  const { path, title } = wikiTargetToPath(target, hostPath);
  if (!title) return { outcome: "no-title" };
  if (await deps.vaultAdapter.exists(path)) return { outcome: "exists", path };
  if (await deps.askFirst()) {
    const ok = await deps.confirm(title);
    if (!ok) return { outcome: "declined" };
  }
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (folder && !(await deps.vaultAdapter.exists(folder))) await deps.vaultAdapter.createDir(folder);
  await deps.vaultAdapter.writeTextFile(path, buildNewNoteContent(await deps.noteType(), title));
  if (deps.index) await deps.index(path);
  notifyFileOps([{ type: "create", path }]);
  return { outcome: "created", path };
}
