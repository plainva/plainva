import type { WorkspaceProviderName } from "@plainva/core/workspace";

/** The workspace's name of a sync provider; without the workspace's lifecycle, which loads when it is used (performance plan L5). */
export function workspaceProviderName(provider: "webdav" | "drive" | "onedrive" | "dropbox" | "s3"): WorkspaceProviderName {
  return provider === "drive" ? "google-drive" : provider;
}
