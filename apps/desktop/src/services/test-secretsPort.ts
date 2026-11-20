import { SECRETS_MARK_KEY_SLOT, createSecretsPort as createSharedSecretsPort, type SecretsPortHost } from "@plainva/ui";

/**
 * The shared secrets port for tests that count or compare a host's slots.
 *
 * The port keeps the key of its marks (`secretsMark.ts`, F67) in the same
 * credentials store as the passwords, through `readSlot`/`writeSlot`. A test
 * whose slots stand for account passwords only gets the key kept beside them
 * here instead, so its counts and snapshots stay about passwords. A host
 * that cannot store anything still gets a key: the port refuses to run
 * without one. One key serves every simulated device of a test run: marks
 * never leave a device, so sharing it changes no outcome, and a port made
 * anew for each round finds the key of the last.
 */
let key: unknown = null;

export function createSecretsPort(host: SecretsPortHost): ReturnType<typeof createSharedSecretsPort> {
  return createSharedSecretsPort({
    ...host,
    readSlot: (slot) => (slot === SECRETS_MARK_KEY_SLOT ? Promise.resolve(key) : host.readSlot(slot)),
    writeSlot: (slot, value) => (slot === SECRETS_MARK_KEY_SLOT ? Promise.resolve(void (key = value)) : host.writeSlot(slot, value)),
  });
}
