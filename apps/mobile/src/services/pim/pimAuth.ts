import {
  refreshDriveAccessToken,
  refreshOneDriveAccessToken,
  GRAPH_CALENDAR_SCOPES,
  type PimAuthProvider,
} from "@plainva/core";
import { webdavFetch } from "../../adapters/webdavHttp";
import { savePimCredentials, type PimStoredCredentials } from "./pimCredentials";

/**
 * Mobile OAuth token provider for the Google/Microsoft PIM accounts. Refreshes
 * through the shared core PKCE helpers on the native fetch bridge and — crucial
 * for Microsoft's refresh-token ROTATION — persists a rotated token immediately
 * (the file-sync lesson: a dropped rotation kills the account). Single-flight
 * so parallel calendar pulls never race N refreshes.
 */
export function buildPimAuthProvider(
  vaultId: string,
  accountId: string,
  creds: Extract<PimStoredCredentials, { kind: "google" | "microsoft" }>,
): PimAuthProvider {
  let accessToken: string | null = null;
  let expiresAt = 0;
  let currentRefreshToken = creds.refreshToken;
  let inFlight: Promise<string> | null = null;

  const refresh = async (): Promise<string> => {
    if (creds.kind === "google") {
      const res = await refreshDriveAccessToken(
        { clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: currentRefreshToken },
        webdavFetch,
      );
      accessToken = res.accessToken;
      expiresAt = Date.now() + Math.max(60, (res.expiresIn ?? 3600) - 60) * 1000;
      return accessToken;
    }
    const res = await refreshOneDriveAccessToken(
      { clientId: creds.clientId, refreshToken: currentRefreshToken, scope: GRAPH_CALENDAR_SCOPES },
      webdavFetch,
    );
    accessToken = res.accessToken;
    expiresAt = Date.now() + Math.max(60, (res.expiresIn ?? 3600) - 60) * 1000;
    if (res.refreshToken && res.refreshToken !== currentRefreshToken) {
      currentRefreshToken = res.refreshToken;
      await savePimCredentials(vaultId, accountId, { ...creds, refreshToken: res.refreshToken });
    }
    return accessToken;
  };

  return {
    async getAccessToken(force?: boolean): Promise<string> {
      if (!force && accessToken && Date.now() < expiresAt) return accessToken;
      if (!inFlight) {
        inFlight = refresh().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}
