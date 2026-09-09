import { oauthScopeFor, oauthScopesCover, normalizeOAuthScopes, type OAuthFamily } from "./oauthScopes";
import { createTokenRefreshCoordinator } from "./tokenRefreshCoordinator";

/** One stored OAuth grant per account, with separate access tokens for its
 * services. Refreshes include confirmed persistence, not just the network call. */

export interface StoredAccountToken {
  clientId: string;
  refreshToken: string;
  /**
   * Google's token endpoint requires the client secret alongside the refresh
   * token; Microsoft's public-client flow has none. Optional for that reason.
   */
  clientSecret?: string;
  /** Scopes the account consented to, so an audience can be checked up front. */
  scopes?: string;
}

/** The installation-local half of an OAuth grant. */
export interface OAuthClientRegistration {
  clientId: string;
  clientSecret?: string;
}

export function sameOAuthClient(
  current: Pick<StoredAccountToken, "clientId" | "clientSecret">,
  next: OAuthClientRegistration,
): boolean {
  return current.clientId === next.clientId && (current.clientSecret ?? "") === (next.clientSecret ?? "");
}

/**
 * Changes the local OAuth client as one credential-slot write.
 *
 * A refresh token is bound to the client that minted it. Keeping it while
 * changing either half of the client registration creates an invalid mixed
 * credential, so the grant and its scopes are deliberately discarded. The
 * caller must complete a fresh local consent before the slot is connected
 * again.
 */
export function replaceOAuthClientRegistration(
  current: StoredAccountToken | null,
  next: OAuthClientRegistration,
): StoredAccountToken {
  if (current && sameOAuthClient(current, next)) return current;
  return {
    clientId: next.clientId,
    ...(next.clientSecret ? { clientSecret: next.clientSecret } : {}),
    refreshToken: "",
  };
}

export interface AccountTokenStore {
  read(): Promise<StoredAccountToken | null>;
  /** Must have completed before the broker hands the access token out. */
  write(next: StoredAccountToken, expected: StoredAccountToken): Promise<void>;
}

export interface RefreshResult {
  /** Actual permissions returned by the provider; absence follows its protocol. */
  scope?: string;
  accessToken: string;
  /** Present when the provider rotated the refresh token. */
  refreshToken?: string;
  /** Seconds until the access token expires. */
  expiresIn?: number;
}

export interface TokenBrokerDeps {
  family?: OAuthFamily;
  /** Detach new callers from older shared work after reconnect or forced refresh. */
  onForget?(): void;
  /** Optional cross-vault coordinator; execute includes reading and persistence. */
  coordinateRefresh?(stored: StoredAccountToken, scope: string, execute: () => Promise<RefreshResult>): Promise<RefreshResult>;
  store: AccountTokenStore;
  /** Provider call; the broker never talks to the network itself. */
  refresh(opts: { clientId: string; clientSecret?: string; refreshToken: string; scope: string }): Promise<RefreshResult>;
  /** Scope string per audience — supplied by the shell that knows the provider. */
  scopeFor(audience: string): string;
  /** Injectable clock so the cache can be tested deterministically. */
  now?: () => number;
}

export interface TokenBroker {
  /** Cached access token for one audience, refreshing (once) when needed. */
  getAccessToken(audience: string): Promise<string>;
  /** Invalidates cached and in-flight answers; stored credentials are untouched. */
  forget(): void;
}

/** Refresh this many milliseconds before the provider's stated expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** Fallback lifetime when the provider does not state one. */
const DEFAULT_LIFETIME_MS = 55 * 60_000;

export function sameStoredAccountToken(a: StoredAccountToken | null, b: StoredAccountToken): boolean {
  return !!a && a.clientId === b.clientId && (a.clientSecret ?? "") === (b.clientSecret ?? "")
    && a.refreshToken === b.refreshToken && a.scopes === b.scopes;
}

export function createTokenBroker(deps: TokenBrokerDeps): TokenBroker {
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, { token: string; expiresAt: number }>();
  const inFlight = new Map<string, Promise<string>>();
  const coordinator = createTokenRefreshCoordinator<RefreshResult>();
  let generation = 0;

  async function refreshFor(audience: string, capturedGeneration: number): Promise<string> {
    const assertCurrent = () => {
      if (generation !== capturedGeneration) throw new Error("account sign-in changed during token renewal");
    };
    const initial = await deps.store.read();
    if (!initial?.refreshToken) throw new Error("account is not connected");
    assertCurrent();
    const scope = deps.scopeFor(audience);
    const execute = async (): Promise<RefreshResult> => {
      assertCurrent();
      // A previous audience may have rotated the grant while this one waited.
      const stored = await deps.store.read();
      if (!stored?.refreshToken) throw new Error("account is not connected");
      assertCurrent();
      if (!sameOAuthClient(stored, initial)) throw new Error("account client changed during token renewal");
      const result = await deps.refresh({
        clientId: stored.clientId,
        ...(stored.clientSecret ? { clientSecret: stored.clientSecret } : {}),
        refreshToken: stored.refreshToken,
        scope,
      });
      assertCurrent();
      if (typeof result.accessToken !== "string" || !result.accessToken.trim()) {
        throw new Error(`the ${audience} token request returned no access token`);
      }
      if ((result.scope !== undefined && typeof result.scope !== "string")
        || (result.refreshToken !== undefined && typeof result.refreshToken !== "string")) {
        throw new Error(`the ${audience} token request returned an invalid grant`);
      }
      // An explicit narrowed answer is authoritative. If omitted, Google uses
      // its original consent; Microsoft's scope-specific refresh uses its request.
      const granted = result.scope ?? (deps.family === "google" ? stored.scopes : scope);
      const covered = oauthScopesCover(granted, scope, deps.family);
      if (!sameStoredAccountToken(await deps.store.read(), stored)) {
        throw new Error("account sign-in changed during token renewal");
      }
      assertCurrent();
      if (result.refreshToken && result.refreshToken !== stored.refreshToken) {
        await deps.store.write({ ...stored, refreshToken: result.refreshToken }, stored);
      }
      assertCurrent();
      // Retain a returned rotation even if this particular access token lacks
      // rights; never use or cache that access token for the requested service.
      if (!covered) throw new Error(`the ${audience} token does not grant its required permissions`);
      return result;
    };
    const result = await (deps.coordinateRefresh
      ? deps.coordinateRefresh(initial, scope, execute)
      : coordinator.run("account", JSON.stringify([normalizeOAuthScopes(scope, deps.family), initial.refreshToken]), execute));
    assertCurrent();
    const lifetime = result.expiresIn ? result.expiresIn * 1000 : DEFAULT_LIFETIME_MS;
    cache.set(audience, { token: result.accessToken, expiresAt: now() + Math.max(lifetime - EXPIRY_MARGIN_MS, 0) });
    return result.accessToken;
  }

  return {
    async getAccessToken(audience: string): Promise<string> {
      const hit = cache.get(audience);
      if (hit && hit.expiresAt > now()) return hit.token;
      const existing = inFlight.get(audience);
      if (existing) return existing;
      const pending = refreshFor(audience, generation).finally(() => {
        if (inFlight.get(audience) === pending) inFlight.delete(audience);
      });
      inFlight.set(audience, pending);
      return pending;
    },
    forget(): void {
      generation += 1;
      cache.clear();
      inFlight.clear();
      coordinator.forget("account");
      deps.onForget?.();
    },
  };
}

/** Only an evidenced service grant may replace that service's own sign-in.
 * Older Microsoft slots without recorded scopes still refresh explicitly for
 * the audience; their actual access-token answer is checked before use. */
export function tokenCoversService(
  token: StoredAccountToken | null | undefined,
  service: string,
  family: OAuthFamily,
): boolean {
  if (!token?.refreshToken) return false;
  const requested = oauthScopeFor(family, service);
  if (!requested) return false;
  if (family === "microsoft" && token.scopes === undefined) return true;
  return oauthScopesCover(token.scopes, requested, family);
}

export function googleScopeFor(service: string): string | null {
  return oauthScopeFor("google", service);
}
