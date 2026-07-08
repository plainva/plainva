import { describe, it, expect, beforeEach } from "vitest";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.js";
import { IVaultAdapter } from "../src/vault/IVaultAdapter.js";

class DirectMockVault implements IVaultAdapter {
  files: Record<string, string> = {};

  async initialize(): Promise<void> {}
  async dispose(): Promise<void> {}
  async readTextFile(path: string): Promise<string> { return this.files[path] || ""; }
  async writeTextFile(path: string, content: string): Promise<void> { this.files[path] = content; }
  async renameItem(_oldPath: string, _newPath: string): Promise<void> {}
  async deleteItem(path: string, _recursive?: boolean): Promise<void> { delete this.files[path]; }
  async listDir(_path?: string, _recursive?: boolean): Promise<any[]> {
    return Object.keys(this.files).map(k => ({
      name: k.split("/").pop()!,
      path: k,
      isDirectory: false,
      mtime: Date.now(),
      size: this.files[k].length
    }));
  }
  async exists(path: string): Promise<boolean> { return this.files[path] !== undefined; }
  async getFileInfo(_path: string): Promise<any> { return {}; }
  async createDir(_path: string): Promise<void> {}
  async readBinaryFile(_path: string): Promise<Uint8Array> { throw new Error("Unimplemented"); }
  async writeBinaryFile(_path: string, _data: Uint8Array): Promise<void> {}
}

describe("Recovery Drill", () => {
  let db: MockDatabaseAdapter;
  let vault: DirectMockVault;
  let indexer: VaultIndexer;

  beforeEach(async () => {
    db = new MockDatabaseAdapter();
    vault = new DirectMockVault();
    indexer = new VaultIndexer(vault, db);
  });

  it("should detect orphaned DB entries and delete them during indexVaultFull", async () => {
    vault.files["note1.md"] = "# Note 1";
    
    // Simulate what the DB returns when VaultIndexer queries for existing files
    db.mockedResults.push([{ path: "note1.md", mtime_local: 0 }, { path: "orphan-123.md", mtime_local: 0 }]);
    
    await indexer.indexVaultFull();
    
    // The indexer should notice that "orphan-123.md" is not in vault.listDir() 
    // and issue a DELETE for it.
    const deleteQueries = db.queries.filter(q => q.query.includes("DELETE FROM files WHERE id = ?"));
    expect(deleteQueries.length).toBeGreaterThan(0);
    
    // It should also have pushed note1.md as an INSERT OR REPLACE
    // It should also have pushed note1.md as an INSERT OR REPLACE
    const insertQueries = db.queries.filter(q => q.query.includes("INSERT"));
    console.log("INSERT QUERIES:", insertQueries);
    expect(insertQueries.length).toBeGreaterThan(0);
  });
});
