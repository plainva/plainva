import { IndexBuildNotice as SharedIndexBuildNotice } from "@plainva/ui";

/**
 * The strip on top of the app while the first index of the open vault is
 * built behind it (issue 143). The strip is shared with the desktop
 * (performance plan L3); the phone gives it its place under the status bar.
 */
export function IndexBuildNotice({ vaultId }: { vaultId: string }) {
  return <SharedIndexBuildNotice vaultId={vaultId} className="m-index-notice" />;
}
