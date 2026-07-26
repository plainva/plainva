/**
 * The raw socket a mail connection needs (mail feinplan G2).
 *
 * This is the ONLY thing the native side provides: open a TCP connection,
 * optionally upgrade it to TLS, write bytes, read bytes, close. The IMAP and
 * SMTP protocols themselves live above this line in TypeScript, so they are
 * written once, tested once, and behave identically on Android and iOS —
 * instead of two hand-written protocol implementations in two languages
 * drifting apart on literals, line folding and timeouts.
 */
export interface MailSocket {
  /** Opens a connection. `tls: true` starts TLS immediately (port 993/465);
   *  `false` starts in the clear for a later STARTTLS (port 143/587). */
  open(opts: { host: string; port: number; tls: boolean }): Promise<string>;
  /** Upgrades an open plain connection to TLS (STARTTLS). */
  startTls(id: string): Promise<void>;
  /** Writes raw bytes (base64 over the bridge). */
  write(id: string, dataBase64: string): Promise<void>;
  /** Reads whatever has arrived, waiting up to `timeoutMs`. Empty string means
   *  the peer closed. */
  read(id: string, timeoutMs: number): Promise<string>;
  close(id: string): Promise<void>;
}

let socketImpl: MailSocket | null = null;

/** Registered by the shell that has a native socket (mobile). */
export function setMailSocket(impl: MailSocket | null): void {
  socketImpl = impl;
}

export function hasMailSocket(): boolean {
  return socketImpl !== null;
}

export function mailSocket(): MailSocket {
  if (!socketImpl) throw new Error("no mail socket available on this platform");
  return socketImpl;
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

function socketBytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * A buffered, line-oriented view of a socket. Mail protocols are CRLF-line
 * based but carry counted binary literals, so the buffer works on BYTES and
 * only decodes when a caller asks for text.
 */
export class LineSocket {
  private buf = new Uint8Array(0);
  private closed = false;

  constructor(
    private readonly sock: MailSocket,
    private readonly id: string,
    private readonly timeoutMs = 30_000,
  ) {}

  static async connect(host: string, port: number, tls: boolean, timeoutMs = 30_000): Promise<LineSocket> {
    const sock = mailSocket();
    const id = await sock.open({ host, port, tls });
    return new LineSocket(sock, id, timeoutMs);
  }

  async startTls(): Promise<void> {
    await this.sock.startTls(this.id);
  }

  async writeText(text: string): Promise<void> {
    await this.sock.write(this.id, socketBytesToBase64(enc.encode(text)));
  }

  async writeBytes(bytes: Uint8Array): Promise<void> {
    await this.sock.write(this.id, socketBytesToBase64(bytes));
  }

  private async fill(): Promise<void> {
    if (this.closed) throw new Error("mail connection closed by the server");
    const b64 = await this.sock.read(this.id, this.timeoutMs);
    if (!b64) {
      this.closed = true;
      throw new Error("mail connection closed by the server");
    }
    const chunk = base64ToBytes(b64);
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
  }

  /** Reads one CRLF-terminated line (without the terminator). */
  async readLine(): Promise<string> {
    for (;;) {
      const nl = this.buf.indexOf(0x0a);
      if (nl >= 0) {
        const end = nl > 0 && this.buf[nl - 1] === 0x0d ? nl - 1 : nl;
        const line = dec.decode(this.buf.subarray(0, end));
        this.buf = this.buf.subarray(nl + 1);
        return line;
      }
      await this.fill();
    }
  }

  /** Reads exactly `n` bytes (an IMAP literal). */
  async readBytes(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) await this.fill();
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return new Uint8Array(out);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.sock.close(this.id).catch(() => undefined);
  }
}
