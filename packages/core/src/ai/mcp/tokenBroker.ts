/**
 * The token broker interface (plan §17.2: "secrets only through a broker with
 * consumer-bound short-lived tokens — never the broad app token").
 *
 * A remote MCP server that needs the user's account gets a token made for
 * THAT server: bound to its address (the audience), limited to the scopes the
 * user granted it, and short-lived. The broker that issues such tokens is the
 * same one the account connections use; this file is the contract both sides
 * are built against, and the checks that do not depend on who implements it.
 *
 * The confused deputy this prevents: a token issued for server A that is
 * accepted by server B. A client that forwards "its" token to whoever asks
 * turns every server it talks to into a holder of the user's account.
 */

/** The longest a token for a foreign server lives. */
export const MCP_TOKEN_MAX_TTL_SECONDS = 600;

export interface McpTokenRequest {
  serverId: string;
  /** The server's canonical address: who the token is for. */
  audience: string;
  scopes: string[];
  ttlSeconds: number;
}

export interface McpToken {
  /** Opaque. Never logged, never shown, never put into a prompt. */
  token: string;
  audience: string;
  scopes: string[];
  /** Unix time, seconds. */
  expiresAt: number;
}

export interface McpTokenBroker {
  /** Issues a token for exactly this audience and these scopes, or rejects. */
  issue(request: McpTokenRequest): Promise<McpToken>;
  /** Forgets everything issued for a server (the user removed or blocked it). */
  revoke(serverId: string): Promise<void>;
}

/**
 * A server's address as an audience (RFC 8707 resource indicator): https,
 * lower-case host, no credentials, no query, no fragment, no trailing slash.
 * Null when the address cannot be an audience.
 */
export function mcpAudience(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  let path = parsed.pathname;
  while (path.endsWith("/")) path = path.slice(0, -1);
  return `https://${parsed.host.toLowerCase()}${path}`;
}

export type McpTokenRequestProblem = "audience" | "scopes" | "ttl";

/**
 * Is this a request the broker may serve? The audience must be the server's
 * own address, every scope one the user granted this server, the lifetime
 * within the limit.
 */
export function mcpTokenRequestProblem(
  request: McpTokenRequest,
  server: { url: string; grantedScopes: readonly string[] },
): McpTokenRequestProblem | null {
  const audience = mcpAudience(server.url);
  if (audience === null || mcpAudience(request.audience) !== audience) return "audience";
  if (request.scopes.some((scope) => !server.grantedScopes.includes(scope))) return "scopes";
  if (!Number.isFinite(request.ttlSeconds) || request.ttlSeconds <= 0 || request.ttlSeconds > MCP_TOKEN_MAX_TTL_SECONDS) return "ttl";
  return null;
}

/**
 * May this token be sent to this address, now? Checked at the moment of use,
 * not only at issue: a redirect or a changed server address must not carry a
 * token along.
 */
export function mcpTokenUsableFor(token: McpToken, url: string, nowSeconds: number): boolean {
  const audience = mcpAudience(url);
  return audience !== null && mcpAudience(token.audience) === audience && token.expiresAt > nowSeconds;
}
