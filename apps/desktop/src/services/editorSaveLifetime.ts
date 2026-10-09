import type { IVaultAdapter } from "@plainva/core";
import type { TextFileShape } from "@plainva/ui";

/** Mutable persistence state belongs to one editor lifetime, outside React. */
export class EditorSaveLifetime {
  readonly id = crypto.randomUUID();
  dirty = false;
  persisted: string | null = null;
  revision = 0;
  /**
   * The shape this editor's save puts back around its text (C15, S13), taken
   * where the file is loaded (`openEditorText`): the file's own line ends and
   * mark — a note from a vault that came from Windows, a `.ini`, a `.csv`
   * carrying the BOM Excel wants are not ours to reformat. Null until a file
   * is loaded.
   */
  shape: TextFileShape | null = null;
  recoveredDraft: { revision: number; sessionId?: string } | null = null;
  baseInput: string | null = null;
  savedRevision = -1;
  discardedRevision = -1;
  activeWrites = 0;
  transferFrozen = false;
  private active = false;

  constructor(readonly vaultPath: string | null, readonly path: string | null, readonly adapter: IVaultAdapter | null) {}
  activate(): void { this.active = true; }
  deactivate(): void { this.active = false; }
  isActive(): boolean { return this.active; }
  setTransferFrozen(frozen: boolean): void { this.transferFrozen = frozen; }
  recover(draft: { revision: number; sessionId?: string }): void { this.recoveredDraft = draft; }
  update(patch: Partial<Pick<EditorSaveLifetime, "dirty" | "persisted" | "revision" | "shape" | "baseInput" | "savedRevision" | "discardedRevision" | "activeWrites" | "recoveredDraft">>): void {
    Object.assign(this, patch);
  }
  nextRevision(): number { return ++this.revision; }
}
