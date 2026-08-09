import { LineSocket } from "./socket";

/**
 * ManageSieve (RFC 5804) over a raw socket — the phone's path to a server-side
 * filter (S13). The desktop speaks the same protocol from Rust; what both share
 * is the script logic above them (`sieveScript.ts`), so a rule written on one
 * device is the same rule on the other.
 *
 * Two rules of this protocol shape everything here:
 *
 * 1. **STARTTLS is not optional.** The password goes over this socket, and the
 *    default port 4190 starts in the clear. A server that offers no STARTTLS is
 *    refused rather than spoken to — the same stance the SMTP client takes.
 * 2. **Answers carry literals.** A script arrives as `{123+}` followed by
 *    exactly that many bytes, not as a line. Reading it as lines works right up
 *    until someone's rule contains a blank line, which is where a hand-written
 *    filter would be silently truncated.
 */

const CRLF = "\r\n";

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** A ManageSieve reply: the payload lines plus the final OK/NO/BYE. */
interface SieveReply {
  ok: boolean;
  /** Everything before the final status line, literals already resolved. */
  lines: string[];
  status: string;
}

/**
 * Reads one reply. Any line ending in a `{n}` or `{n+}` literal is followed by
 * exactly n bytes, which belong to that line — this is where a script's own
 * newlines live.
 */
async function readReply(sock: LineSocket): Promise<SieveReply> {
  const lines: string[] = [];
  for (;;) {
    const line = await sock.readLine();
    const literal = /\{(\d+)\+?\}$/.exec(line);
    if (literal) {
      const bytes = await sock.readBytes(Number(literal[1]));
      // The literal is followed by the REST of that line, which is normally
      // empty — but it belongs to the same entry. Treating it as a line of its
      // own appends a phantom newline to every script that comes back.
      const rest = await sock.readLine();
      lines.push(new TextDecoder().decode(bytes) + rest);
      continue;
    }
    if (/^(OK|NO|BYE)\b/i.test(line)) {
      return { ok: /^OK\b/i.test(line), lines, status: line };
    }
    lines.push(line);
  }
}

async function send(sock: LineSocket, command: string, what: string): Promise<SieveReply> {
  await sock.writeText(command + CRLF);
  const reply = await readReply(sock);
  if (!reply.ok) throw new Error(`${what}: ${reply.status}`);
  return reply;
}

/** Quotes a ManageSieve string argument (RFC 5804 §4: \ and " are special). */
function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Wraps a value as a literal, the only safe way to send a script body: its
 * own newlines would otherwise end the command mid-rule. */
function literal(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return `{${bytes}+}${CRLF}${text}`;
}

function capabilities(lines: readonly string[]): Set<string> {
  const caps = new Set<string>();
  for (const line of lines) {
    const name = /^"([^"]+)"/.exec(line);
    if (name) caps.add(name[1].toUpperCase());
  }
  return caps;
}

export interface SieveCreds {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface SieveSession {
  getScript(name: string): Promise<string>;
  putScript(name: string, body: string): Promise<void>;
  setActive(name: string): Promise<void>;
  listScripts(): Promise<{ name: string; active: boolean }[]>;
  close(): Promise<void>;
}

/**
 * Opens a session: greeting, STARTTLS, PLAIN authentication.
 *
 * The greeting is read again after STARTTLS because the capabilities before an
 * encrypted channel are not the ones that count — a server may only announce
 * SASL mechanisms once it can be trusted with the answer.
 */
export async function sieveConnect(creds: SieveCreds, timeoutMs = 30_000): Promise<SieveSession> {
  const sock = await LineSocket.connect(creds.host, creds.port, false, timeoutMs);
  try {
    const greeting = await readReply(sock);
    if (!capabilities(greeting.lines).has("STARTTLS")) {
      throw new Error("this server offers no STARTTLS for ManageSieve");
    }
    await send(sock, "STARTTLS", "starttls");
    await sock.startTls();
    await readReply(sock); // capabilities again, now over TLS

    const sasl = `\0${creds.user}\0${creds.pass}`;
    await send(sock, `AUTHENTICATE "PLAIN" ${quote(b64(sasl))}`, "authenticate");

    return {
      async getScript(name) {
        const reply = await send(sock, `GETSCRIPT ${quote(name)}`, "getscript");
        return reply.lines.join("\n");
      },
      async putScript(name, body) {
        await send(sock, `PUTSCRIPT ${quote(name)} ${literal(body)}`, "putscript");
      },
      async setActive(name) {
        await send(sock, `SETACTIVE ${quote(name)}`, "setactive");
      },
      async listScripts() {
        const reply = await send(sock, "LISTSCRIPTS", "listscripts");
        return reply.lines
          .map((line) => {
            const name = /^"((?:[^"\\]|\\.)*)"/.exec(line);
            return name ? { name: name[1].replace(/\\(.)/g, "$1"), active: /\bACTIVE\b/i.test(line) } : null;
          })
          .filter((s): s is { name: string; active: boolean } => s !== null);
      },
      async close() {
        await sock.writeText("LOGOUT" + CRLF).catch(() => undefined);
        await sock.close();
      },
    };
  } catch (e) {
    await sock.close().catch(() => undefined);
    throw e;
  }
}

/** The script Plainva reads and writes when the server has no active one yet. */
export const DEFAULT_SIEVE_SCRIPT = "plainva";

/**
 * Which script to work on: the ACTIVE one, because that is the only one the
 * server runs. Writing into a second, inactive script would look like it worked
 * and filter nothing.
 */
export function activeScriptName(scripts: readonly { name: string; active: boolean }[]): string {
  return scripts.find((s) => s.active)?.name ?? DEFAULT_SIEVE_SCRIPT;
}
