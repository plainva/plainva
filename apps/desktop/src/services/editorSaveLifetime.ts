import type { IVaultAdapter } from "@plainva/core";
import type { TextFileShape } from "@plainva/ui";

/** Mutable persistence state belongs to one editor lifetime, outside React. */
export class EditorSaveLifetime {
  readonly id = crypto.randomUUID();
  dirty = false;
  persisted: string | null = null;
  revision = 0;
  shape: TextFileShape | null = null;
  recoveredDraft: { revision: number; sessionId?: string } | null = null;
  baseInput: string | null = null;
  savedRevision = -1;
  discardedRevision = -1;
  activeWrites = 0;
  private active = false;

  constructor(readonly vaultPath: string | null, readonly path: string | null, readonly adapter: IVaultAdapter | null) {}
  activate(): void { this.active = true; }
  deactivate(): void { this.active = false; }
  isActive(): boolean { return this.active; }
  recover(draft: { revision: number; sessionId?: string }): void { this.recoveredDraft = draft; }
  update(patch: Partial<Pick<EditorSaveLifetime, "dirty" | "persisted" | "revision" | "shape" | "baseInput" | "savedRevision" | "discardedRevision" | "activeWrites" | "recoveredDraft">>): void {
    Object.assign(this, patch);
  }
  nextRevision(): number { return ++this.revision; }
}
