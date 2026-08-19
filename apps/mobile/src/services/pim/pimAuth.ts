import {
  refreshDriveAccessToken,
  refreshOneDriveAccessToken,
  GRAPH_CALENDAR_SCOPES,
  type PimAuthProvider,
} from "@plainva/core";
import { webdavFetch } from "../../adapters/webdavHttp";
import { brokerTokenProvider } from "../accountBroker";
import { savePimCredentials, type PimStoredCredentials } from "./pimCredentials";
import { NO_STORED_SIGN_IN } from "@plainva/ui";

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
    /**
     * The desktop's stage-B migration blanks the per-service refresh token once
     * the account-wide one is stored, and that blanked credential travels here
     * through the settings sync — where there is no broker to fall back to. So
     * the phone must not send the refresh either: it would ask the provider to
     * renew nothing and report AADSTS900144 forever (finding 2026-07-30).
     */
    if (!currentRefreshToken) {
      throw new Error(`${NO_STORED_SIGN_IN}: this account has no stored sign-in — connect it again.`);
    }
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

  /** Probed once: broker-backed accounts read through the broker. */
  let brokerProbe: Promise<((force: boolean) => Promise<string>) | undefined> | null = null;

  return {
    async getAccessToken(force?: boolean): Promise<string> {
      // A Google calendar with a sign-in OF ITS OWN uses it, and asks nobody
      // else. Google tokens do not rotate, so this slot is a complete and valid
      // sign-in — and it is the one just granted for THIS service, while the
      // shared account token may legitimately be narrower (Drive only) and can
      // never be widened, because Google ignores the scope of a refresh.
      // Preferring the shared one turned a freshly connected calendar into a
      // permanent 401 that no re-authorisation could clear — the desktop fixed
      // that on 2026-07-30, the phone kept reading the shared token and made
      // every "sign in again" a no-op (finding 2026-08-19). Microsoft keeps the
      // broker first: its refresh token ROTATES, and a second copy renewing it
      // is what stage B removed.
      const ownGoogleSignIn = creds.kind === "google" && !!currentRefreshToken;
      if ((creds.kind === "microsoft" || creds.kind === "google") && !ownGoogleSignIn) {
        if (!brokerProbe) brokerProbe = brokerTokenProvider(vaultId, "calendar", accountId).catch(() => undefined);
        // A NEGATIVE probe is not trusted while there is no per-service token to
        // fall back on: repairing the account writes a slot while this provider
        // is alive, and a cached "no broker" kept the account broken until the
        // app restarted — which is what "I signed in again and nothing changed"
        // looked like.
        if (!currentRefreshToken && !(await brokerProbe)) {
          brokerProbe = brokerTokenProvider(vaultId, "calendar", accountId).catch(() => undefined);
        }
        const viaBroker = await brokerProbe;
        if (viaBroker) return viaBroker(force ?? false);
      }
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
