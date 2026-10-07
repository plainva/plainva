import { Browser } from "@capacitor/browser";
import type { McpOAuthBrowser, McpOAuthRedirect } from "@plainva/core";
import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { APP_URL } from "../appScheme";

/**
 * The browser of a sign-in to a remote MCP server, and the way back from it
 * (plan KI-Harness P4.5): the system's browser, and the app's own address —
 * the same road every account sign-in of the phone takes (`appUrlRoutes`).
 *
 * What comes back is handed on as it is. Whether it is the answer to what
 * was begun is the native side's decision (`AiMcpAuth`): it kept the state
 * and the verifier, and a code is worth nothing without them.
 */

/** Where the browser comes back to. The plugin names the same address to the authorization server. */
export const MCP_OAUTH_REDIRECT = `${APP_URL}mcp/oauth`;

/** How long after the browser closed a way back may still arrive: the two events race on Android. */
const CLOSED_GRACE_MS = 2000;

interface Waiter {
  resolve(redirect: McpOAuthRedirect): void;
  reject(error: Error): void;
}

let waiting: Waiter | null = null;

export function createMobileMcpBrowser(): McpOAuthBrowser {
  return {
    prepare: () => Promise.resolve({}),
    async open(url) {
      // The plugin built it from an endpoint it checked; a browser is still only ever opened at a web address.
      if (!/^https?:\/\//i.test(url)) throw new Error("oauth-address");
      await Browser.open({ url });
    },
    wait(signal) {
      return new Promise<McpOAuthRedirect>((resolve, reject) => {
        // One sign-in at a time: a new one ends the wait of an older one.
        waiting?.reject(new Error("cancelled"));
        let closed: { remove(): Promise<void> } | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const end = () => {
          if (waiting === own) waiting = null;
          clearTimeout(timer);
          signal?.removeEventListener("abort", stop);
          void closed?.remove().catch(() => undefined);
        };
        const own: Waiter = {
          resolve: (redirect) => {
            end();
            resolve(redirect);
          },
          reject: (error) => {
            end();
            reject(error);
          },
        };
        const stop = () => {
          own.reject(new Error("cancelled"));
          void Browser.close().catch(() => undefined);
        };
        waiting = own;
        if (signal?.aborted) {
          stop();
          return;
        }
        signal?.addEventListener("abort", stop, { once: true });
        // The user closed the browser without finishing. The way back may still be on its way, so it gets a moment.
        void Browser.addListener("browserFinished", () => {
          timer = setTimeout(() => own.reject(new Error("cancelled")), CLOSED_GRACE_MS);
        }).then((handle) => {
          if (waiting === own) closed = handle;
          else void handle.remove().catch(() => undefined);
        });
      });
    },
  };
}

/**
 * A URL on the app's own scheme: is it the way back from a sign-in to a
 * server? If somebody waits for it, they get it. If nobody does — the system
 * ended the app while the browser was open — the sign-in is ended here, with
 * what the native side kept, and a toast says what came of it.
 */
export async function handleMcpOAuthRedirect(url: string): Promise<boolean> {
  if (url.split(/[?#]/)[0] !== MCP_OAUTH_REDIRECT) return false;
  void Browser.close().catch(() => undefined);
  const params = new URLSearchParams(url.split("?")[1]?.split("#")[0] ?? "");
  const value = (name: string) => params.get(name) ?? undefined;
  const code = value("code");
  const iss = value("iss");
  const error = value("error");
  const redirect: McpOAuthRedirect = {
    state: value("state") ?? "",
    ...(code !== undefined ? { code } : {}),
    ...(iss !== undefined ? { iss } : {}),
    ...(error !== undefined ? { error } : {}),
  };
  if (waiting) {
    waiting.resolve(redirect);
    return true;
  }
  const { getMobileAiSession } = await import("./mobileAi");
  const server = await getMobileAiSession().mcp.finishSignIn(redirect);
  if (server !== null) toast.info(i18n.t("ai.ext.signIn.done", { server }));
  else toast.error(i18n.t("ai.ext.signIn.problem.cancelled"));
  return true;
}
