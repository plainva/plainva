import { describe, expect, it, vi } from "vitest";
import { activeScriptName, setMailSocket, sieveConnect } from "@plainva/ui/mail";

/**
 * ManageSieve over the shared socket (S13, RFC 5804).
 *
 * Two properties decide whether a server-side filter can be trusted, and both
 * are invisible until they go wrong: the password never crosses an unencrypted
 * socket, and a script comes back WHOLE — literals carry the blank lines a
 * hand-written rule contains, which line-by-line reading would swallow.
 */

const enc = new TextEncoder();
const b64 = (text: string) => {
  let bin = "";
  for (const b of enc.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** A scripted server: each entry is what it answers to the next command. */
function fakeSocket(script: string[]) {
  const written: string[] = [];
  let queue = [...script];
  const impl = {
    open: vi.fn(async () => "s1"),
    startTls: vi.fn(async () => {}),
    write: vi.fn(async (_id: string, data: string) => {
      written.push(atob(data));
    }),
    read: vi.fn(async () => {
      const next = queue.shift();
      if (next === undefined) return "";
      return b64(next);
    }),
    close: vi.fn(async () => {}),
  };
  return { impl, written, remaining: () => queue.length, push: (s: string) => queue.push(s) };
}

const GREETING = '"IMPLEMENTATION" "Test"\r\n"SASL" "PLAIN"\r\n"STARTTLS"\r\nOK "ready"\r\n';
const AFTER_TLS = '"SASL" "PLAIN"\r\nOK "ready"\r\n';

describe("opening a session", () => {
  it("refuses a server that cannot encrypt the connection", async () => {
    // The password goes over this socket and port 4190 starts in the clear.
    const sock = fakeSocket(['"IMPLEMENTATION" "Test"\r\nOK "ready"\r\n']);
    setMailSocket(sock.impl);
    await expect(sieveConnect({ host: "h", port: 4190, user: "u", pass: "p" })).rejects.toThrow(/STARTTLS/);
    expect(sock.impl.close).toHaveBeenCalled();
    setMailSocket(null);
  });

  it("upgrades before it authenticates", async () => {
    const sock = fakeSocket([GREETING, 'OK "begin tls"\r\n', AFTER_TLS, 'OK "logged in"\r\n']);
    setMailSocket(sock.impl);
    const session = await sieveConnect({ host: "h", port: 4190, user: "u", pass: "p" });
    const tlsAt = sock.written.findIndex((w) => w.startsWith("STARTTLS"));
    const authAt = sock.written.findIndex((w) => w.startsWith("AUTHENTICATE"));
    expect(tlsAt).toBeGreaterThanOrEqual(0);
    expect(authAt).toBeGreaterThan(tlsAt);
    expect(sock.impl.startTls).toHaveBeenCalled();
    await session.close();
    setMailSocket(null);
  });

  it("reports what the server said when the login fails", async () => {
    const sock = fakeSocket([GREETING, 'OK "begin tls"\r\n', AFTER_TLS, 'NO "authentication failed"\r\n']);
    setMailSocket(sock.impl);
    await expect(sieveConnect({ host: "h", port: 4190, user: "u", pass: "p" })).rejects.toThrow(/authentication failed/);
    setMailSocket(null);
  });
});

describe("reading and writing a script", () => {
  const connect = async (extra: string[]) => {
    const sock = fakeSocket([GREETING, 'OK "begin tls"\r\n', AFTER_TLS, 'OK "logged in"\r\n', ...extra]);
    setMailSocket(sock.impl);
    return { sock, session: await sieveConnect({ host: "h", port: 4190, user: "u", pass: "p" }) };
  };

  it("brings a script back whole, blank lines and all", async () => {
    // A literal, not lines: the blank line inside a hand-written rule is
    // exactly what a line-by-line reader would drop.
    const body = 'require ["fileinto"];\n\nif true {\n  keep;\n}';
    const { session } = await connect([`{${enc.encode(body).length}}\r\n${body}\r\nOK "done"\r\n`]);
    expect(await session.getScript("plainva")).toBe(body);
    setMailSocket(null);
  });

  it("sends a script as a literal so its own newlines cannot end the command", async () => {
    const body = 'require ["vacation"];\nvacation "away";';
    const { sock, session } = await connect(['OK "stored"\r\n']);
    await session.putScript("plainva", body);
    const put = sock.written.find((w) => w.startsWith("PUTSCRIPT")) ?? "";
    expect(put).toContain(`{${enc.encode(body).length}+}`);
    expect(put).toContain(body);
    setMailSocket(null);
  });

  it("passes a server refusal on instead of reporting success", async () => {
    const { session } = await connect(['NO "script has errors"\r\n']);
    await expect(session.putScript("plainva", "bad")).rejects.toThrow(/script has errors/);
    setMailSocket(null);
  });

  it("lists scripts and knows which one runs", async () => {
    const { session } = await connect(['"plainva"\r\n"work" ACTIVE\r\nOK "done"\r\n']);
    expect(await session.listScripts()).toEqual([
      { name: "plainva", active: false },
      { name: "work", active: true },
    ]);
    setMailSocket(null);
  });
});

describe("choosing the script to work on", () => {
  it("takes the ACTIVE one, because that is the only one the server runs", () => {
    // Writing into a second, inactive script looks like it worked and filters
    // nothing.
    expect(activeScriptName([{ name: "plainva", active: false }, { name: "work", active: true }])).toBe("work");
  });

  it("falls back to its own name when nothing is active yet", () => {
    expect(activeScriptName([])).toBe("plainva");
  });
});
