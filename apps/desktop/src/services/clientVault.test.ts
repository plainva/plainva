import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What an auxiliary window is allowed to start (multi-window P0).
 *
 * The whole architecture rests on one sentence: the central window owns the
 * background services, an auxiliary window owns none of them. That sentence is
 * only true as long as nobody adds a service to the client path — and the
 * owner's service list grew by four entries in a single month (encrypted
 * workspace worker, settings/secrets sideband, reminder scheduler, OKF
 * conversion recovery). A comment would not have survived that.
 *
 * So this reads `clientVault.ts` and pins two things: exactly which classes it
 * constructs, and that none of the owner-only names appear in it at all. Adding
 * a service to an aux window is then a deliberate act — you have to change this
 * list, in the same commit, with a reason.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(HERE, "clientVault.ts"), "utf8");

/**
 * Scanned on the transpiled output, not the raw text: comments and type-only
 * imports drop out, so the file can still EXPLAIN why a service is absent
 * ("no initializeSchema() here on purpose") without tripping its own guard.
 * What remains is the runtime code, which is what the rules are about.
 */
const SOURCE = ts.transpileModule(RAW, {
  compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext },
}).outputText;

/** Everything a client window may construct. Grows only with a reason. */
const ALLOWED_CONSTRUCTIONS = [
  // Reads the vault from disk — safe from any window.
  "TauriVaultAdapter",
  // The read connection to the index DB (opened without writing to it).
  "TauriDatabaseAdapter",
  // Renders from the index.
  "VaultQueryService",
  "GraphService",
  // Hands every mutation to the owner instead of writing itself.
  "RemoteVaultAdapter",
] as const;

/**
 * Owner-exclusive machinery. Each of these either writes, schedules, holds a
 * network session or owns an undo queue — two instances of any of them in one
 * process is a bug with real consequences (duplicate reminders, a second sync
 * cycle, a token refresh race that invalidates a whole cloud account).
 */
const OWNER_ONLY = [
  "VaultIndexer",
  "initializeSchema",
  "BackupVaultAdapter",
  "ConflictAwareVaultAdapter",
  "QueueingVaultAdapter",
  "WorkspaceQueueingVaultAdapter",
  "SyncQueue",
  "SyncEngine",
  "SyncWorker",
  "EncryptedWorkspaceWorker",
  "SqlWorkspaceStateStore",
  "buildSettingsSyncStep",
  "startBackupScheduler",
  "createIncrementalIndexQueue",
  "startPim",
  "PimWorker",
  "scheduleReminders",
  "startReminderScheduler",
  "recoverOkfConversion",
  "createTokenBroker",
  // Stage C: the owner side of the window bus. A client INSTALLING it would
  // answer requests meant for the window that owns the services — including
  // its own — and announce a vault it does not decide.
  "installOwnerBus",
  "installSyncStatusMirror",
  "announceVaultChanged",
  "noteVaultChanged",
] as const;

describe("client-mode vault (auxiliary windows)", () => {
  it("constructs only the read/render services and the remote write adapter", () => {
    const constructed = new Set(Array.from(SOURCE.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g), (m) => m[1]));
    expect([...constructed].sort()).toEqual([...ALLOWED_CONSTRUCTIONS].sort());
  });

  it("does not mention any owner-only service", () => {
    const found = OWNER_ONLY.filter((name) => new RegExp(`\\b${name}\\b`).test(SOURCE));
    expect(
      found,
      `clientVault.ts must not reach owner-only machinery, found: ${found.join(", ")}. ` +
        "If an auxiliary window genuinely needs one of these, it is a design change: " +
        "either the service moves behind a window-bus RPC to the owner, or this list changes " +
        "in the same commit with a reason.",
    ).toEqual([]);
  });

  it("attaches to the index database instead of opening a second connection", () => {
    // `initialize()` runs a ROLLBACK and three PRAGMAs; a second window must do
    // neither. And `load()` would be worse than useless here: the sql plugin
    // keys ONE app-wide pool map by the connection string, so a second `load`
    // replaces the owner's pool with its own. `attachReadOnly()` uses
    // `Database.get()`, which reuses whatever the owner registered.
    expect(SOURCE).toContain("attachReadOnly()");
    expect(SOURCE).not.toMatch(/dbAdapter\.initialize\w*\(\)/);
  });

  it("never closes the shared pool", () => {
    // The pool belongs to the whole app. `close()` from an auxiliary window
    // would tear down the CENTRAL window's index connection, and the failure
    // would show up minutes later as broken search in a window nobody touched.
    expect(SOURCE).not.toMatch(/dbAdapter\.close\(/);
    expect(SOURCE).toContain("dbAdapter.detach()");
  });

  it("never migrates the index database", () => {
    // The one-time in-vault -> app-data move belongs to the owner. Two windows
    // copying the same database around is the race this design exists to avoid.
    expect(SOURCE).not.toMatch(/\bwriteFile\b/);
    expect(SOURCE).not.toMatch(/\bmkdir\b/);
  });
});
