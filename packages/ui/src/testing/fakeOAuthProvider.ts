/**
 * A stand-in for Google's and Microsoft's sign-in, for tests of both shells
 * (account sign-in plan E6). Every round of account fixes since June ended
 * with "not run against a real provider"; the maintainer was the only real
 * test. This provider behaves the way the providers document and the way they
 * were observed to behave, so a whole sign-in - consent, code exchange,
 * identity, renewal - runs in a unit test and in an end-to-end test:
 *
 * - granular consent: the person may untick single permissions (Google), the
 *   answer names what was granted;
 * - Google ignores the scope of a renewal and answers with the grant's own;
 *   Microsoft rotates the refresh token on every renewal;
 * - the identity comes from userinfo / Graph `/me` per access token;
 * - a project in "Testing" lets refresh tokens lapse after seven days;
 * - revocation and a second account in the same browser.
 *
 * Nothing here is shipped; it is imported from `@plainva/ui/testing`.
 */

export type FakeFamily = "google" | "microsoft";

export interface FakeAccount {
  /** The provider's stable subject (Google `sub`, Microsoft `id`). */
  subject: string;
  email: string;
}

export interface FakeConsentChoice {
  /** The account picked in the browser (email). Defaults to the login hint, then the first account. */
  account?: string;
  /** Scopes the person unticks on the consent screen (Google's granular consent). */
  untick?: string[];
  /** The person closes the browser instead. */
  cancel?: boolean;
}

interface Grant {
  family: FakeFamily;
  clientId: string;
  clientSecret?: string;
  account: FakeAccount;
  scopes: string[];
  refreshToken: string;
  issuedAt: number;
  revoked: boolean;
}

interface PendingCode {
  grant: Omit<Grant, "refreshToken" | "issuedAt" | "revoked">;
  codeChallenge?: string;
  redirectUri?: string;
}

const DAY = 24 * 60 * 60 * 1000;
const IDENTITY = new Set(["openid", "email", "profile", "offline_access", "User.Read"]);

export interface FakeProviderOptions {
  family: FakeFamily;
  accounts: FakeAccount[];
  /** Registered clients. A client not listed is refused like an unknown client id. */
  clients: { clientId: string; clientSecret?: string }[];
  /** Google projects in "Testing" let refresh tokens lapse after seven days. */
  testing?: boolean;
  now?: () => number;
}

export class FakeOAuthProvider {
  readonly family: FakeFamily;
  private readonly accounts: FakeAccount[];
  private readonly clients: { clientId: string; clientSecret?: string }[];
  private readonly testing: boolean;
  private readonly now: () => number;
  private codes = new Map<string, PendingCode>();
  private grants: Grant[] = [];
  private access = new Map<string, { grant: Grant; scopes: string[] }>();
  private counter = 0;
  /** Every request a test may want to assert on. */
  readonly log: { kind: "consent" | "token" | "refresh" | "identity"; detail: Record<string, unknown> }[] = [];

  constructor(options: FakeProviderOptions) {
    this.family = options.family;
    this.accounts = options.accounts;
    this.clients = options.clients;
    this.testing = options.testing ?? false;
    this.now = options.now ?? (() => Date.now());
  }

  private next(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.family}-${this.counter}`;
  }

  private client(clientId: string): { clientId: string; clientSecret?: string } {
    const client = this.clients.find((entry) => entry.clientId === clientId);
    if (!client) throw new FakeOAuthError("invalid_client", "The OAuth client was not found.");
    return client;
  }

  private mintAccess(grant: Grant, scopes: string[]): string {
    const token = this.next("access");
    this.access.set(token, { grant, scopes });
    return token;
  }

  /**
   * The browser step: the person sees the consent screen for `scope` and
   * answers. Returns the authorization code the redirect would carry.
   */
  consent(request: { clientId: string; scope: string; loginHint?: string; codeChallenge?: string; redirectUri?: string }, choice: FakeConsentChoice = {}): string {
    this.client(request.clientId);
    this.log.push({ kind: "consent", detail: { scope: request.scope, loginHint: request.loginHint, choice } });
    if (choice.cancel) throw new FakeOAuthError("access_denied", "The person closed the sign-in.");
    const email = choice.account ?? request.loginHint ?? this.accounts[0]?.email;
    const account = this.accounts.find((entry) => entry.email === email);
    if (!account) throw new FakeOAuthError("access_denied", "No such account in the browser.");
    const asked = [...new Set(request.scope.split(/\s+/).filter(Boolean))];
    // Only Google lets single permissions be unticked; identity always stays.
    const untick = this.family === "google" ? new Set(choice.untick ?? []) : new Set<string>();
    const scopes = asked.filter((scope) => IDENTITY.has(scope) || !untick.has(scope));
    const code = this.next("code");
    this.codes.set(code, {
      grant: { family: this.family, clientId: request.clientId, account, scopes },
      codeChallenge: request.codeChallenge,
      redirectUri: request.redirectUri,
    });
    return code;
  }

  /** The token endpoint, `grant_type=authorization_code`. */
  exchange(input: { code: string; clientId: string; clientSecret?: string }): { refresh_token: string; access_token: string; scope: string; expires_in: number } {
    const pending = this.codes.get(input.code);
    this.codes.delete(input.code);
    if (!pending || pending.grant.clientId !== input.clientId) throw new FakeOAuthError("invalid_grant", "Bad Request");
    const client = this.client(input.clientId);
    if (this.family === "google" && client.clientSecret !== undefined && client.clientSecret !== input.clientSecret) {
      throw new FakeOAuthError("invalid_client", "Unauthorized");
    }
    const grant: Grant = { ...pending.grant, ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}), refreshToken: this.next("refresh"), issuedAt: this.now(), revoked: false };
    this.grants.push(grant);
    this.log.push({ kind: "token", detail: { account: grant.account.email, scopes: grant.scopes.join(" ") } });
    return { refresh_token: grant.refreshToken, access_token: this.mintAccess(grant, grant.scopes), scope: grant.scopes.join(" "), expires_in: 3599 };
  }

  /** The token endpoint, `grant_type=refresh_token`. */
  refresh(input: { refreshToken: string; clientId: string; clientSecret?: string; scope?: string }): { access_token: string; refresh_token?: string; scope: string; expires_in: number } {
    const grant = this.grants.find((entry) => entry.refreshToken === input.refreshToken && entry.clientId === input.clientId);
    this.log.push({ kind: "refresh", detail: { scope: input.scope, found: !!grant } });
    if (!grant || grant.revoked) throw new FakeOAuthError("invalid_grant", "Token has been expired or revoked.");
    if (this.testing && this.now() - grant.issuedAt > 7 * DAY) throw new FakeOAuthError("invalid_grant", "Token has been expired or revoked.");
    if (this.family === "google") {
      // Google answers with the grant's scopes whatever the request asked for.
      return { access_token: this.mintAccess(grant, grant.scopes), scope: grant.scopes.join(" "), expires_in: 3599 };
    }
    // Microsoft narrows to the requested resource and rotates the refresh token.
    const wanted = input.scope ? input.scope.split(/\s+/).filter((scope) => grant.scopes.includes(scope)) : grant.scopes;
    grant.refreshToken = this.next("refresh");
    return { access_token: this.mintAccess(grant, wanted), refresh_token: grant.refreshToken, scope: wanted.join(" "), expires_in: 3599 };
  }

  /** userinfo (Google) or Graph `/me` (Microsoft) for an access token. */
  identity(accessToken: string): Record<string, unknown> | null {
    const entry = this.access.get(accessToken);
    this.log.push({ kind: "identity", detail: { found: !!entry } });
    if (!entry || entry.grant.revoked) return null;
    const { account } = entry.grant;
    return this.family === "google"
      ? { sub: account.subject, email: account.email, email_verified: true }
      : { id: account.subject, mail: account.email, userPrincipalName: account.email };
  }

  /** The scopes an access token carries (for API probes in tests). */
  scopesOf(accessToken: string): string[] | null {
    const entry = this.access.get(accessToken);
    return entry && !entry.grant.revoked ? entry.scopes : null;
  }

  /** The person revokes Plainva's access in their provider account. */
  revoke(email: string): void {
    for (const grant of this.grants) if (grant.account.email === email) grant.revoked = true;
  }

  /** Grants currently held, for assertions. */
  heldGrants(): { account: string; clientId: string; scopes: string[]; revoked: boolean }[] {
    return this.grants.map((grant) => ({ account: grant.account.email, clientId: grant.clientId, scopes: [...grant.scopes], revoked: grant.revoked }));
  }

  /**
   * A `fetch` that answers the provider's endpoints: token, userinfo / `/me`.
   * Anything else is a 404, so a test notices a request it did not expect.
   */
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    try {
      if (url.startsWith("https://oauth2.googleapis.com/token") || /login\.microsoftonline\.com\/.*\/oauth2\/v2\.0\/token/.test(url)) {
        const form = new URLSearchParams(typeof init?.body === "string" ? init.body : String(init?.body ?? ""));
        if (form.get("grant_type") === "authorization_code") {
          return json(200, this.exchange({ code: form.get("code") ?? "", clientId: form.get("client_id") ?? "", clientSecret: form.get("client_secret") ?? undefined }));
        }
        return json(200, this.refresh({ refreshToken: form.get("refresh_token") ?? "", clientId: form.get("client_id") ?? "", clientSecret: form.get("client_secret") ?? undefined, scope: form.get("scope") ?? undefined }));
      }
      if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo") || url.startsWith("https://graph.microsoft.com/v1.0/me")) {
        const auth = new Headers(init?.headers).get("Authorization") ?? "";
        const body = this.identity(auth.replace(/^Bearer\s+/i, ""));
        return body ? json(200, body) : json(401, { error: "invalid_token" });
      }
    } catch (error) {
      if (error instanceof FakeOAuthError) return json(error.code === "invalid_client" ? 401 : 400, { error: error.code, error_description: error.message });
      throw error;
    }
    return json(404, { error: "not_found", url });
  };
}

export class FakeOAuthError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "FakeOAuthError";
  }
}
