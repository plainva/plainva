import type { WorkspaceSyncFailureKind } from "@plainva/core/workspace";
import i18n from "../i18n";
import { connectionErrorText } from "./connectionErrorText";

/** The diagnosis keeps its technical cause; the status explains the action. */
export function workspaceSyncFailureText(message: string | undefined, kind: WorkspaceSyncFailureKind | undefined): string | null {
  if (!message) return null;
  return connectionErrorText(message) ?? (kind ? i18n.t(`workspaceSync.${kind}`) : message);
}
