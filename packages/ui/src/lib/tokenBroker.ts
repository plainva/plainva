/**
 * One refresh token per cloud ACCOUNT, shared by every service that account
 * carries (cloud accounts stage B / B0).
 *
 * Microsoft is the reason this exists: its refresh tokens ROTATE, so the
 * previous shape — one token copy per subsystem (file sync, calendar, mail),
 * each refreshing on its own — meant three consumers invalidating each other's
 * copy. The broker keeps exactly one copy, serialises the refresh, and
 * persists a rotated token BEFORE any caller proceeds.
 *
 * It is audience-scoped on purpose: callers ask for an access token for one
 * purpose ("files" / "calendar" / "mail") and receive a token limited to that
 * purpose's scopes. The refresh token itself never leaves the broker, which is
 * also what lets a later MCP token exchange reuse this instead of a second
 * broker (see the AI harness plan).
 */

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
  write(next: StoredAccountToken): Promise<void>;
}

export interface RefreshResult {
  accessToken: string;
  /** Present when the provider rotated the refresh token. */
  refreshToken?: string;
  /** Seconds until the access token expires. */
  expiresIn?: number;
}

export interface TokenBrokerDeps {
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
  /** Drops cached access tokens; the refresh token in the store is untouched. */
  forget(): void;
}

/** Refresh this many milliseconds before the provider's stated expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** Fallback lifetime when the provider does not state one. */
const DEFAULT_LIFETIME_MS = 55 * 60_000;

export function createTokenBroker(deps: TokenBrokerDeps): TokenBroker {
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, { token: string; expiresAt: number }>();
  /**
   * Single-flight per audience. Keyed by audience rather than globally so two
   * different services do not serialise behind each other, while two calls for
   * the SAME audience share one round trip — and because every refresh writes
   * the rotated token through the same store, a concurrent pair cannot end up
   * with divergent refresh tokens.
   */
  const inFlight = new Map<string, Promise<string>>();

  async function refreshFor(audience: string): Promise<string> {
    const stored = await deps.store.read();
    if (!stored?.refreshToken) throw new Error("account is not connected");

    const result = await deps.refresh({
      clientId: stored.clientId,
      ...(stored.clientSecret ? { clientSecret: stored.clientSecret } : {}),
      refreshToken: stored.refreshToken,
      scope: deps.scopeFor(audience),
    });

    // Persist a rotated refresh token BEFORE the access token is used: a lost
    // rotation locks the whole account out of every service at once.
    if (result.refreshToken && result.refreshToken !== stored.refreshToken) {
      await deps.store.write({ ...stored, refreshToken: result.refreshToken });
    }

    // Never hand out — or cache — something that is not a token. An empty one
    // travels to the API as "Bearer undefined" and comes back as a 401 that
    // blames the sign-in, and the cache would repeat that for the token's whole
    // supposed lifetime while re-authorising changes nothing (finding
    // 2026-07-30). The refresh helpers guard this too; the broker is the last
    // gate before three subsystems trust the value.
    if (!result.accessToken) throw new Error(`the ${audience} token request returned no access token`);

    const lifetime = result.expiresIn ? result.expiresIn * 1000 : DEFAULT_LIFETIME_MS;
    cache.set(audience, { token: result.accessToken, expiresAt: now() + Math.max(lifetime - EXPIRY_MARGIN_MS, 0) });
    return result.accessToken;
  }

  return {
    async getAccessToken(audience: string): Promise<string> {
      const hit = cache.get(audience);
      if (hit && hit.expiresAt > now()) return hit.token;

      const running = inFlight.get(audience);
      if (running) return running;

      const p = refreshFor(audience).finally(() => inFlight.delete(audience));
      inFlight.set(audience, p);
      return p;
    },
    forget(): void {
      cache.clear();
    },
  };
}
