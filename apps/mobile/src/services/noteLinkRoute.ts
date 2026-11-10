import { contentPathRefusal, wikiTargetForPath, type LinkVault } from "@plainva/core";
import { copyLineLink, copyNoteLink, openNoteLink, requestAnchorJump, setNoteLinkHandler, type LineLinkMode } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { vaultOps, switchVault, type MobileVault } from "./vaultService";
import { getActiveVaultEntry, listVaults, type VaultEntry } from "./vaultRegistry";
import { leaveThen } from "./leaveQuestion";

/**
 * Note links on the phone (F2, ADR 0037).
 *
 * In: the system hands `plainva://open?…` to Capacitor's `appUrlOpen` (the
 * Android intent filter and the iOS URL type in the native projects), and
 * `routeAppUrl` hands it to the shared inbox (`deliverNoteLink`). A link
 * clicked inside the app reaches the same inbox through the guard of the
 * platform's `openExternal`.
 *
 * Out: `receiveNoteLinks` (from `PendingIntentRunner`, which runs only once
 * a vault is open) registers how this vault opens a note; links that arrived
 * on a cold start wait until then.
 */

/** The name a vault goes by in a link: its own, or the built-in vault's label. */
export function phoneVaultName(entry: Pick<VaultEntry, "name"> | null | undefined): string {
  return entry?.name?.trim() || i18n.t("mobile.vaultLocal");
}

/** The name of the vault that is open, for "Copy link". */
export async function activeVaultLinkName(): Promise<string> {
  return phoneVaultName(await getActiveVaultEntry().catch(() => null));
}

async function confirmSwitch(name: string): Promise<boolean> {
  const { Dialog } = await import("@capacitor/dialog");
  const answer = await Dialog.confirm({
    title: i18n.t("noteLink.switchTitle"),
    message: i18n.t("noteLink.switchMessage", { name }),
    okButtonTitle: i18n.t("noteLink.switchConfirm"),
    cancelButtonTitle: i18n.t("common.cancel"),
  });
  return answer.value;
}

async function confirmOpenHere(vault: string, note: string, ambiguous: boolean): Promise<boolean> {
  const { Dialog } = await import("@capacitor/dialog");
  const answer = await Dialog.confirm({
    title: i18n.t("noteLink.openHereTitle"),
    message: i18n.t(ambiguous ? "noteLink.openHereAmbiguousMessage" : "noteLink.openHereMessage", { vault, note }),
    okButtonTitle: i18n.t("noteLink.openHereConfirm"),
    cancelButtonTitle: i18n.t("common.cancel"),
  });
  return answer.value;
}

/** How this vault opens a note link — the shell side of `openNoteLink`. */
export function phoneNoteLinkHandler(
  vault: MobileVault,
  shown: LinkVault<string>,
  onOpenNote: (path: string) => void,
  ask: (name: string) => Promise<boolean> = confirmSwitch,
  askOpenHere: (vault: string, note: string, ambiguous: boolean) => Promise<boolean> = confirmOpenHere,
): (url: string, switched: boolean) => void {
  return (url, switched) => {
    void openNoteLink<string>(
      url,
      {
        shownVault: shown,
        knownVaults: async () => (await listVaults()).map((entry) => ({ key: entry.id, name: phoneVaultName(entry) })),
        confirmSwitch: ask,
        confirmOpenHere: askOpenHere,
        // The person said yes to this vault; what is unsaved on screen gets its own question first.
        switchVault: (id) =>
          new Promise<boolean>((resolve) => leaveThen(() => void switchVault(id).then(() => resolve(true), () => resolve(false)), () => resolve(false))),
        // The index first: it holds real, visible spellings only. A note it has
        // not taken in yet is asked of the disk — never for an internal folder
        // or a name of an unusual shape (F2 review).
        exists: async (path) => {
          if (vault.queryService && (await vault.queryService.fileRecords([path])).has(path)) return true;
          return contentPathRefusal(path) === null && (await vault.files.exists(path).catch(() => false));
        },
        resolveName: (name) => vaultOps.resolveWikiTarget(vault, name, "", "wiki"),
        openNote: (path, anchor) => {
          // Parked under the path: the note screen that mounts for it takes it.
          if (anchor) requestAnchorJump(path, anchor);
          onOpenNote(path);
        },
      },
      switched,
    );
  };
}

/**
 * Registers the open vault's handler while it is open: links that waited
 * (a cold start, a vault switch the person agreed to) are opened now.
 */
export function receiveNoteLinks(vault: MobileVault | null, onOpenNote: (path: string) => void): () => void {
  if (!vault) return () => {};
  let off: (() => void) | null = null;
  let gone = false;
  void getActiveVaultEntry()
    .then((entry) => {
      if (gone) return;
      off = setNoteLinkHandler(phoneNoteLinkHandler(vault, { key: entry.id, name: phoneVaultName(entry) }, onOpenNote));
    })
    .catch(() => {});
  return () => {
    gone = true;
    off?.();
  };
}

/** "Copy link" of a note or a database on the phone: its address in the open vault. */
export async function copyPhoneNoteLink(path: string): Promise<void> {
  await copyNoteLink(await activeVaultLinkName(), path);
}

/** "Copy link" / "Copy block link" at a line of the open editor (the block sheet). */
export async function copyPhoneLineLink(view: Parameters<typeof copyLineLink>[0], pos: number, mode: LineLinkMode, vault: MobileVault, path: string): Promise<void> {
  const [vaultName, notes] = await Promise.all([
    activeVaultLinkName(),
    vault.queryService ? vault.queryService.listNotes().then((list) => list.map((n) => n.path)).catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ]);
  await copyLineLink(view, pos, mode, { notePath: path, vaultName, wikiName: wikiTargetForPath(path, [...notes, path]) });
}
