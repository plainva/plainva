import {
  WebDavSyncTarget,
  DriveSyncTarget,
  OneDriveSyncTarget,
  DropboxSyncTarget,
  S3SyncTarget,
} from "@plainva/core";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { oneDriveFetch } from "./authFetch";

/**
 * Builds throwaway sync targets from in-memory credentials. Shared by the
 * settings folder picker (from stored keychain creds) and the splash onboarding
 * (from freshly authorized, not-yet-persisted creds), so both build the exact
 * same target. OneDrive/Dropbox may ROTATE the refresh token while browsing;
 * the caller passes `onRotate` to persist it (settings) or update the in-memory
 * copy (splash) — a dropped rotation kills the token.
 */

export function buildWebDavTarget(creds: { url: string; user: string; pass: string }): WebDavSyncTarget {
  return new WebDavSyncTarget({ ...creds }, httpFetch);
}

export function buildDriveTarget(creds: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): DriveSyncTarget {
  return new DriveSyncTarget(
    { clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken },
    httpFetch
  );
}

export function buildOneDriveTarget(
  creds: { clientId: string; refreshToken: string },
  onRotate?: (refreshToken: string) => void
): OneDriveSyncTarget {
  const target = new OneDriveSyncTarget(
    { clientId: creds.clientId, refreshToken: creds.refreshToken },
    oneDriveFetch
  );
  if (onRotate) {
    target.onTokensRefreshed = (_accessToken, refreshToken) => {
      if (refreshToken && refreshToken !== creds.refreshToken) onRotate(refreshToken);
    };
  }
  return target;
}

export function buildDropboxTarget(
  creds: { appKey: string; refreshToken: string },
  onRotate?: (refreshToken: string) => void
): DropboxSyncTarget {
  const target = new DropboxSyncTarget(
    { appKey: creds.appKey, refreshToken: creds.refreshToken },
    httpFetch
  );
  if (onRotate) {
    target.onTokensRefreshed = (_accessToken, refreshToken) => {
      if (refreshToken && refreshToken !== creds.refreshToken) onRotate(refreshToken);
    };
  }
  return target;
}

export interface S3TargetCreds {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function buildS3Target(creds: S3TargetCreds): S3SyncTarget {
  return new S3SyncTarget({ ...creds }, httpFetch);
}
