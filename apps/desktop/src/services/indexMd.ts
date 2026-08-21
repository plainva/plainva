// The index.md orchestration moved to @plainva/ui (P6, 2026-08-21) — it was
// already adapter-neutral, and the phone now generates, adopts and refreshes
// through the same rules. Desktop imports stay valid through this re-export,
// and the unchanged tests next to this file are the proof that the move
// changed no behaviour.
export {
  adoptFileAsIndex,
  collectFolderIndexInfos,
  foldersMissingIndex,
  generateIndexForFolder,
  type AdoptionResult,
  type FolderIndexInfo,
  type IndexMdAdapter,
} from "@plainva/ui";
