import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADAPTER_WRITE, adapterRead, anyOf, built, countUses, destructuredAs, propertyNamed, valueUses } from "../../../packages/core/test/helpers/valueUses";

/**
 * The storage below a vault's chain stays with the places that have a reason
 * to be there (finding 2026-10-09).
 *
 * A vault on the phone hands out two adapters with the same methods:
 * `vault.files`, the chain every write of the app goes through — a version of
 * the file as it was, the check whether the file on disk is still the one the
 * app knows, the entry in the sync queue — and `vault.adapter`, the storage
 * below it (`vault.backup` is the lowest link of the chain, still below the
 * queue and the check). A shared writer takes either, and nothing at the call
 * says which one it got. Seven writers got the one below: a property set
 * across the selection of a database, the anchor of an entry put in the
 * calendar, a database created from the editor, the two ways to make a
 * template, the task database and a voice memo. The import wizard had done
 * the same before them (S3). What that cost is shown, with the phone's own
 * code and real files, in `services/vaultChainWrites.test.ts`.
 *
 * So every place of the phone that reaches below the chain is listed here,
 * with what it does there and why it may. Reading is free — a read through
 * either adapter is the same read. Everything else is an entry: a method
 * called on the storage, a function it is handed to, a name it is kept under.
 * A new one turns this red until it is entered with its reason — and for a
 * file the user sees there is none: that is written through `vault.files`.
 *
 * The desktop's twin is `rawVaultAdapter.test.ts` there. Its vault context
 * keeps the storage to itself and hands out the chain, so its list is short.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function shipped(): { rel: string; text: string }[] {
  const files: { rel: string; text: string }[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) files.push({ rel: relative(SRC, full).replace(/\\/g, "/"), text: readFileSync(full, "utf8") });
    }
  })(SRC);
  return files.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

const BELOW_THE_CHAIN = anyOf(
  propertyNamed("adapter", "backup"),
  destructuredAs(/\bMobileVault\b/, "adapter", "backup"),
  built("CapacitorVaultAdapter", "ExternalVaultAdapter"),
);

// ── Why a place may reach below the chain ────────────────────────────────────

const READS_ONLY = "reads: what it is handed to can only ask — whether a path is there, a folder's listing, a file's bytes";
const HISTORY =
  "the version history reads its snapshots where the versions layer put them (`.plainva/backups`); what it restores is written through the `writeAdapter` it is handed, and that is `vault.files`";
const VERSIONS_LAYER = "the versions layer's own control — when a version is taken and how long it is kept; no file of the user's is written";
const BOOKMARKS =
  "`.plainva/bookmarks.json` is the app's own file: no version, never queued, and since 2026-10-20 no conflict check either — no link of the chain keeps anything about what the app writes under `.plainva`, so what is kept of it does not depend on the level (`own-files-chain.test.ts` in the core). It is written where the settings profile writes it, which carries the list between devices";
const RECENTS = "`.plainva/recents.json`, the notes opened last on this device: the app's own file, never versioned, never synced";
const COMMENTS =
  "the comment files under `.plainva/sync` go up as a sideband of the sync, and are read and written where its steps read them (see `mobileCommentStore`)";
const SIDEBAND = "the settings profile and the key file are sideband files of the sync (`.plainva/sync`), read and written where the sync's own steps read them";
const SYNC =
  "the sync works below the chain: what it pulls must not be queued to go up again, and it takes its own versions and decides conflicts itself";
const WORKSPACE =
  "an encrypted workspace sweeps and writes the local files as they are; the chain that belongs to it (permissions, its own queue) is built over this storage by the reload that follows";
const NOT_OPEN = "a vault that is not open — created, prepared or filled a moment ago — has no chain yet; its first index run takes every file as new";
const BOOT = "`boot` builds the chain on this storage";
const TRANSFER_SOURCE = "the open vault is the SOURCE of a transfer into another one: read here, written there";
const FIRST_VAULT =
  "the vault this very start created and found empty (`claimTemplateCreation`): nothing to take a version of, nothing the chain knows that could differ, no provider to queue for — and the scaffold refuses a folder that is not empty. The full index run right behind it takes every file as new. Thirty writes through the queue's database on the first start would only add a way for it to fail";

type Site = [use: string, times: number, why: string];

const SITES: Record<string, Site[]> = {
  "App.tsx": [
    ["calls updatePolicy", 1, VERSIONS_LAYER],
    ["handed to scaffoldVaultTemplate as adapter", 1, FIRST_VAULT],
  ],
  "BookmarksScreen.tsx": [["handed to useBookmarkTargets", 1, READS_ONLY]],
  // A conflict copy of a file that is no text takes the file's place byte for
  // byte; what it replaces is kept as a version first, whatever the interval says.
  "components/ConflictCompareSheet.tsx": [["calls forceBackup", 1, VERSIONS_LAYER]],
  "components/DeletedFilesSheet.tsx": [["handed to new VersionHistoryService", 2, HISTORY]],
  "components/TemplateRules.tsx": [["handed to listTemplates", 1, READS_ONLY]],
  "components/TodayJournalSection.tsx": [["handed to loadImageBlob", 1, READS_ONLY]],
  "components/VersionsPanel.tsx": [
    ["handed to new VersionHistoryService", 1, HISTORY],
    ["calls forceBackup", 1, VERSIONS_LAYER],
  ],
  "screens/ImportWizardScreen.tsx": [["put into an object as vaultAdapter", 1, `${NOT_OPEN} (an import into a new vault; the open vault is \`vault.files\` in the same expression, held by importWizard.test.ts)`]],
  "screens/JournalScreen.tsx": [["handed to loadImageBlob", 1, READS_ONLY]],
  "screens/MailComposeScreen.tsx": [["handed to listTemplates", 1, READS_ONLY]],
  "screens/NavigatorScreen.tsx": [["handed to useBookmarkTargets", 1, READS_ONLY]],
  "screens/NoteScreen.tsx": [["handed to renameBookmarksOnDisk", 1, BOOKMARKS]],
  "screens/PimAccountsScreen.tsx": [["handed to listTemplates", 1, READS_ONLY]],
  "screens/SecurityAreaScreen.tsx": [["handed to resumeMobileWorkspaceSetup as vault", 1, WORKSPACE]],
  "screens/SecurityWizardScreen.tsx": [["handed to activatePreparedMobileWorkspace as vault", 1, WORKSPACE]],
  "screens/SettingsAreaScreens.tsx": [["handed to listTemplates", 1, READS_ONLY]],
  "screens/useOpenFileLookup.ts": [["handed to renameBookmarksOnDisk", 1, BOOKMARKS]],
  "services/accountVaultTransfer.ts": [
    ["builds CapacitorVaultAdapter", 1, NOT_OPEN],
    ["handed to planVaultTransfer", 1, TRANSFER_SOURCE],
    ["handed to commitVaultTransfer", 1, TRANSFER_SOURCE],
  ],
  "services/ai/mobileAi.ts": [
    ["handed to adapterInstructionVersions", 1, "reads: a skill's earlier versions, listed and read where the versions layer keeps them (AI harness P6)"],
    ["returned", 1, `${VERSIONS_LAYER} (a version of a skill's file as it is, taken before a proposal of the assistant rewrites it; the write goes through \`vault.files\`)`],
  ],
  "services/commentOperations.ts": [
    ["calls ensureSnapshot", 1, `${VERSIONS_LAYER} (a version of the note as it is, taken before an accepted suggestion writes over it; the write goes through \`vault.files\`)`],
  ],
  "services/importTarget.ts": [["builds CapacitorVaultAdapter", 1, NOT_OPEN]],
  "services/mobileComments.ts": [["handed to new BundleCommentStore as vault", 1, COMMENTS]],
  "services/mobileSettingsSync.ts": [
    ["kept as raw", 3, SIDEBAND],
    // Seen since a name the storage is kept under is followed (2026-10-13): the key file is written through `raw`.
    ["calls writeTextFile", 1, SIDEBAND],
    ["handed to applyBookmarkProfileOnDisk", 1, BOOKMARKS],
    ["kept as rawVault", 1, SIDEBAND],
    ["handed to keyfile.run", 1, SIDEBAND],
  ],
  "services/profileImportJournal.ts": [
    ["calls writeTextFile", 1, `${BOOKMARKS} (the bookmarks an interrupted import had found are put back)`],
    ["calls deleteItem", 1, `${BOOKMARKS} (…or taken away again, where there had been none)`],
  ],
  "services/syncService.ts": [
    ["builds CapacitorVaultAdapter", 1, NOT_OPEN],
    ["handed to initializePersonalWorkspaceMigration as vault", 1, WORKSPACE],
    ["handed to new EncryptedWorkspaceWorker", 1, WORKSPACE],
    ["handed to settingsSync.guardBeforeCycle", 1, SIDEBAND],
    ["handed to settingsSync.run", 1, SIDEBAND],
    ["handed to createContentRefResolver", 1, "reads: names a file for the upload that streams it"],
    ["handed to new DeletionJournal", 1, "the deletion journal is a sideband file of the sync (`.plainva/sync`), not a note"],
    ["handed to new SyncWorker", 1, SYNC],
  ],
  "services/vaultService.ts": [
    ["builds CapacitorVaultAdapter", 2, `${BOOT}; ${NOT_OPEN} (\`createLocalVault\`)`],
    ["builds ExternalVaultAdapter", 1, BOOT],
    ["handed to renameBookmarksOnDisk", 3, BOOKMARKS],
    ["handed to importObsidianBookmarks", 1, BOOKMARKS],
    ["handed to toggleBookmarkOnDisk", 1, BOOKMARKS],
    ["handed to moveBookmarkOnDisk", 1, BOOKMARKS],
    ["handed to removeBookmarksOnDisk", 1, BOOKMARKS],
    ["calls writeTextFile", 1, RECENTS],
  ],
};

describe("the storage below a vault's chain", () => {
  it("is reached only where this list says so, and for the reason it gives", () => {
    const found: string[] = [];
    for (const { rel, text } of shipped()) {
      for (const [use, lines] of countUses(valueUses(rel, text, BELOW_THE_CHAIN), adapterRead)) found.push(`${rel} — ${use} ×${lines.length}`);
    }
    const listed = Object.entries(SITES).flatMap(([file, sites]) => sites.map(([use, times]) => `${file} — ${use} ×${times}`));
    expect(
      found.sort(),
      "A place of the phone reaches below the vault's chain that this guard does not know (or no longer where it says). " +
        "What the user sees — a note, a database, an attachment, a folder — is written through `vault.files`: that is what " +
        "takes a version first, checks the file on disk and puts the change into the sync queue. Reading is free. For " +
        "anything else, enter the place in SITES with why it may be there.",
    ).toEqual(listed.sort());
  });

  it("is written to by no screen and no component", () => {
    // A method that changes a file, called on the storage itself: the app's
    // own files and the sync's, and those are the services' business.
    for (const [file, sites] of Object.entries(SITES)) {
      for (const [use] of sites) if (ADAPTER_WRITE.test(use)) expect(file, `${file} ${use} below the chain`).toMatch(/^services\//);
    }
  });

  it("is not gone around either: no screen writes to the device's file system itself", () => {
    const direct = /\bFilesystem\.(writeFile|appendFile|deleteFile|mkdir|rmdir|rename|copy)\(/;
    const offenders = shipped().filter(({ rel, text }) => !/^(services|adapters|platform)\//.test(rel) && direct.test(text)).map(({ rel }) => rel);
    expect(offenders, "a vault's files are reached through the vault, and written through `vault.files`").toEqual([]);
  });

  it("every entry says why", () => {
    for (const [file, sites] of Object.entries(SITES)) {
      for (const [use, times, why] of sites) {
        expect(times, `${file} — ${use}`).toBeGreaterThan(0);
        expect(why.length, `${file} — ${use} carries no reason`).toBeGreaterThan(20);
      }
    }
  });
});
