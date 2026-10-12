import type { IVaultAdapter } from "./IVaultAdapter.js";
import type { SyncState } from "./SyncStateRepository.js";
import { conflictHash, conflictSessionKey, decodeConflictSession, type ConflictDiagnostic, type ConflictEditSession, type ConflictSessionStore } from "./conflictSession.js";

/** Device-local journal independent of the derived search index. All writes
 * use the host adapter's atomic replacement, never the sync queue. */
export class ConflictFileStore implements ConflictSessionStore {
  private readonly directory: Promise<string>;
  constructor(private readonly files: IVaultAdapter, deviceId: string) {
    if (!deviceId) throw new Error("A stable device identity is required for conflict storage");
    // External folder providers can copy this directory to another device.
    // That device must never resume our journal as its own editing session.
    this.directory = conflictHash(deviceId).then(hash => `.plainva/conflicts/${hash}`);
  }
  private async key(kind: string, path: string): Promise<string> {
    return `${await this.directory}/${kind}/${await conflictHash(conflictSessionKey(path))}.json`;
  }
  private async read(path: string): Promise<string | null> {
    return await this.files.exists(path) ? this.files.readTextFile(path) : null;
  }
  private async write(path: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value);
    await this.files.writeTextFile(path, text);
    if (await this.files.readTextFile(path) !== text) throw new Error("Conflict state could not be confirmed");
  }
  private async paths(kind: string): Promise<string[]> {
    const directory = `${await this.directory}/${kind}`;
    if (!await this.files.exists(directory)) return [];
    return (await this.files.listDir(directory, false)).filter(file => !file.isDirectory && file.name.endsWith(".json")).map(file => file.path).sort();
  }
  async getConflictSession(path: string): Promise<ConflictEditSession | null> {
    const raw = await this.read(await this.key("sessions", path));
    const session = raw === null ? null : decodeConflictSession(raw);
    if (session && conflictSessionKey(session.originalPath) !== conflictSessionKey(path)) throw new Error("Conflict session path does not match its key");
    return session;
  }
  async listConflictSessions(): Promise<ConflictEditSession[]> {
    return Promise.all((await this.paths("sessions")).map(async path => {
      const session = decodeConflictSession(await this.files.readTextFile(path));
      if (await this.key("sessions", session.originalPath) !== path) throw new Error("Conflict session path does not match its key");
      return session;
    }));
  }
  async saveConflictSession(session: ConflictEditSession): Promise<void> {
    await this.write(await this.key("sessions", session.originalPath), session);
  }
  async removeConflictSession(path: string): Promise<void> {
    await this.files.deleteItem(await this.key("sessions", path), false, { confirmed: true });
  }
  async recordConflictDiagnostic(diagnostic: ConflictDiagnostic): Promise<void> {
    await this.write(`${await this.directory}/diagnostics/${diagnostic.at}-${crypto.randomUUID()}.json`, diagnostic);
    for (const path of (await this.paths("diagnostics")).slice(0, -100)) {
      try { await this.files.deleteItem(path, false, { confirmed: true }); }
      catch (error) { if (await this.files.exists(path)) throw error; }
    }
  }
  async listConflictDiagnostics(): Promise<ConflictDiagnostic[]> {
    return Promise.all((await this.paths("diagnostics")).slice(-100).reverse().map(async path => JSON.parse(await this.files.readTextFile(path)) as ConflictDiagnostic));
  }

  /** Only used when the index is unavailable. There is no synced ancestor;
   * editor requests still carry their exact loaded base through every save. */
  async getSyncState(path: string): Promise<SyncState | null> {
    const raw = await this.read(await this.key("markers", path));
    if (raw === null) return null;
    const marker = JSON.parse(raw) as { path: string; hash: string };
    if (marker.path !== conflictSessionKey(path) || !/^[a-f0-9]{64}$/.test(marker.hash)) throw new Error("Invalid local conflict marker");
    return { path, local_sha256: marker.hash, base_text: null, base_sha256: null, remote_etag: null,
      base_etag: null, remote_id: null, last_sync_ts: null, pending_push_sha: null };
  }
  async getBaseText(_path: string): Promise<string | null> { return null; }
  async updateLocalHash(path: string, hash: string): Promise<void> {
    await this.write(await this.key("markers", path), { path: conflictSessionKey(path), hash });
  }
  async updateLocalHashAndUnsyncedBaseText(path: string, hash: string, _text: string): Promise<void> {
    await this.updateLocalHash(path, hash);
  }
}
