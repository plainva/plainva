/**
 * Deletes a view's selection and keeps the view honest about it (finding of
 * the review of release 0.9.0): `refresh` runs after every attempt that may
 * have deleted something — also after an error, where some files may already
 * be gone and nobody knows which. Before, a failed run answered `[]`, the view
 * kept its rows and the selection, and showed files that were no longer there.
 * The selection follows the rows (`pruneSelection`); what went is handed to
 * `onDeleted`, the error to `onError`.
 */
export async function deleteSelectedFiles(
  paths: readonly string[],
  run: { confirm: () => Promise<string[]>; refresh: () => void; onDeleted: (deleted: string[]) => void; onError: (error: unknown) => void },
): Promise<void> {
  if (paths.length === 0) return;
  let deleted: string[];
  try {
    deleted = await run.confirm();
  } catch (error) {
    run.onError(error);
    run.refresh();
    return;
  }
  if (deleted.length === 0) return;
  run.onDeleted(deleted);
  run.refresh();
}
