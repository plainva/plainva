import { describe, expect, it } from "vitest";
import { shippedSources } from "./test-sourceTree";
import { ADAPTER_WRITE, adapterRead, anyOf, built, countUses, destructuredAs, propertyNamed, valueUses, variableNamed } from "../../../packages/core/test/helpers/valueUses";

/**
 * The storage below a vault's chain stays with the places that have a reason
 * to be there — the desktop's half (finding 2026-10-09; the phone's, with what
 * the finding was, is `rawVaultAdapter.test.ts` there).
 *
 * The vault context builds the chain — files, above them versions, the sync
 * queue and the conflict check — and hands the app `vaultAdapter`, its top.
 * The files themselves (`TauriVaultAdapter`) never leave it; that is why no
 * writer of the desktop could be handed the wrong one, where seven of the
 * phone's were. Two ways below the chain exist all the same: `backupAdapter`,
 * the chain's lowest link, which the context hands out as well, and building
 * an adapter of one's own. Every place that takes one of them is listed here,
 * with what it does there and why it may; a new one turns this red until it
 * is entered. What the user sees is written through `vaultAdapter`.
 *
 * NOT covered: calls of the file system plugin itself (`@tauri-apps/plugin-fs`)
 * and of the native write command outside the adapter. Exports, key and
 * recovery files and the journals use them, for places the user picks or the
 * app's own data folder; those callers have not been read for this.
 */

const ROOT = "apps/desktop/src/";
/** The context is where the chain is built: it holds every link of it by design. */
const OWNER = "contexts/VaultContext.tsx";

const BELOW_THE_CHAIN = anyOf(
  variableNamed("backupAdapter"),
  propertyNamed("backupAdapter"),
  destructuredAs(/\bVault(State|ContextType|ContextValue)\b|ReturnType<typeof useVault>/, "backupAdapter"),
  built("TauriVaultAdapter"),
);

const VERSIONS_LAYER = "the versions layer's own control: a version of the file as it is, taken before a restore — or a conflict copy adopted byte for byte — writes over it; the write itself goes through `vaultAdapter`";
const KEY_FILE = "the key file of the sync's encryption (`.plainva/sync`) is a sideband file of the sync, read and written where the sync's own steps read it";
const NOT_OPEN = "a vault that is not open — its folder was picked or created a moment ago — has no chain yet; opening it takes every file as new";
const SKILL_VERSION = "the versions layer's own control: a version of a skill's file as it is, taken before a proposal of the assistant rewrites it (AI harness P6); the write itself goes through `vaultAdapter`";

type Site = [use: string, times: number, why: string];

const SITES: Record<string, Site[]> = {
  "components/CompareModal.tsx": [
    ["taken from useVault()", 1, VERSIONS_LAYER],
    ["calls forceBackup", 3, VERSIONS_LAYER],
  ],
  "components/OnlineVaultSetup.tsx": [["builds TauriVaultAdapter", 1, NOT_OPEN]],
  "components/SplashScreen.tsx": [["builds TauriVaultAdapter", 1, NOT_OPEN]],
  "components/ai/useDesktopAi.ts": [
    ["taken from useVault()", 1, SKILL_VERSION],
    ["handed to useRef", 1, SKILL_VERSION],
    ["kept as backup.current", 1, SKILL_VERSION],
  ],
  "components/import/ImportWizardModal.tsx": [["builds TauriVaultAdapter", 1, `${NOT_OPEN} (an import into a new vault; into the open one it writes through \`vaultAdapter\`)`]],
  "components/settings/EncryptionUnlockHost.tsx": [
    ["taken from useVault()", 1, KEY_FILE],
    ["handed to hasLocalKeyfile", 1, KEY_FILE],
    ["handed to <EncryptionSetupModal> as raw", 1, KEY_FILE],
  ],
  "components/settings/SyncPage.tsx": [
    ["taken from useVault()", 1, KEY_FILE],
    ["handed to hasLocalKeyfile", 1, KEY_FILE],
    ["handed to <EncryptionSetupModal> as raw", 1, KEY_FILE],
  ],
  "services/clientVault.ts": [
    ["builds TauriVaultAdapter", 1, "a window beside the main one reads the vault through it; every write goes to the window that owns the chain (`RemoteVaultAdapter`), and clientVault.test.ts holds what else may appear there"],
  ],
};

describe("the storage below a vault's chain", () => {
  it("is reached only where this list says so, and for the reason it gives", () => {
    const found: string[] = [];
    for (const { rel, text } of shippedSources([ROOT.slice(0, -1)])) {
      const file = rel.slice(ROOT.length);
      if (file === OWNER) continue;
      for (const [use, lines] of countUses(valueUses(file, text, BELOW_THE_CHAIN), adapterRead)) found.push(`${file} — ${use} ×${lines.length}`);
    }
    const listed = Object.entries(SITES).flatMap(([file, sites]) => sites.map(([use, times]) => `${file} — ${use} ×${times}`));
    expect(
      found.sort(),
      "A place of the desktop reaches below the vault's chain that this guard does not know (or no longer where it says). " +
        "What the user sees — a note, a database, an attachment, a folder — is written through `vaultAdapter`: that is what " +
        "takes a version first, checks the file on disk and puts the change into the sync queue. Reading is free. For " +
        "anything else, enter the place in SITES with why it may be there.",
    ).toEqual(listed.sort());
  });

  it("the context that builds the chain is the only place that holds its files", () => {
    const owner = shippedSources([ROOT.slice(0, -1)]).find(({ rel }) => rel === ROOT + OWNER);
    expect(owner, "the vault context moved — re-point this guard").toBeDefined();
    const uses = valueUses(OWNER, owner!.text, built("TauriVaultAdapter"));
    expect(uses.map(({ use }) => use)).toEqual(["builds TauriVaultAdapter"]);
    // …and what it hands the app as `vaultAdapter` is the top of the chain.
    expect(owner!.text).toMatch(/const vaultAdapter = new ConflictAwareVaultAdapter\(\s*queueingVaultAdapter,/);
  });

  it("is written to by none of them directly", () => {
    for (const [file, sites] of Object.entries(SITES)) {
      for (const [use] of sites) expect(use, `${file} ${use} below the chain`).not.toMatch(ADAPTER_WRITE);
    }
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
