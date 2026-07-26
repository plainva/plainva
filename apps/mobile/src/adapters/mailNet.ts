import { registerPlugin, Capacitor } from "@capacitor/core";
import type { MailSocket } from "@plainva/ui/mail";

/**
 * The native socket the shared IMAP/SMTP client runs on (mail feinplan G2).
 * The plugin only moves bytes; the protocols live in `@plainva/ui/mail/net`.
 */
interface MailNetNative {
  open(options: { host: string; port: number; tls: boolean }): Promise<{ id: string }>;
  startTls(options: { id: string }): Promise<void>;
  write(options: { id: string; data: string }): Promise<void>;
  read(options: { id: string; timeoutMs: number }): Promise<{ data: string }>;
  close(options: { id: string }): Promise<void>;
}

const MailNet = registerPlugin<MailNetNative>("MailNet");

export const nativeMailSocket: MailSocket = {
  open: async (opts) => (await MailNet.open(opts)).id,
  startTls: (id) => MailNet.startTls({ id }),
  write: (id, dataBase64) => MailNet.write({ id, data: dataBase64 }),
  read: async (id, timeoutMs) => (await MailNet.read({ id, timeoutMs })).data,
  close: (id) => MailNet.close({ id }),
};

/** Only the native shells have raw sockets; the web dev server has none. */
export const hasNativeMailSocket = (): boolean => Capacitor.isNativePlatform();
