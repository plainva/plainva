import {
  WebDavSyncTarget,
  DriveSyncTarget,
  OneDriveSyncTarget,
  DropboxSyncTarget,
  S3SyncTarget,
} from "@plainva/core";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { microsoftAuthFetch } from "./authFetch";

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

/**
 * `accessTokenProvider` (2026-08-19): accounts connected through a union consent
 * keep ONE refresh token in the account slot, and the per-service slot carries an
 * EMPTY one on purpose (cloud accounts stage B). Those targets get their access
 * token from the broker exactly like the sync worker does — without it the picker
 * was the last place still assuming the pre-stage-B world and refused to browse a
 * perfectly connected account.
 */
export function buildDriveTarget(
  creds: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  },
  accessTokenProvider?: (force: boolean) => Promise<string>
): DriveSyncTarget {
  const target = new DriveSyncTarget(
    { clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken },
    httpFetch
  );
  if (accessTokenProvider) target.accessTokenProvider = accessTokenProvider;
  return target;
}

export function buildOneDriveTarget(
  creds: { clientId: string; refreshToken: string },
  onRotate?: (refreshToken: string) => void,
  accessTokenProvider?: (force: boolean) => Promise<string>
): OneDriveSyncTarget {
  const target = new OneDriveSyncTarget(
    { clientId: creds.clientId, refreshToken: creds.refreshToken },
    microsoftAuthFetch
  );
  if (accessTokenProvider) {
    // The broker owns the refresh token AND its rotation for every service of
    // the account; this target must never refresh (or rotate) on its own.
    target.accessTokenProvider = accessTokenProvider;
  } else if (onRotate) {
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
