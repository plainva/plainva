import type { ConfirmedAccess, IPimTarget, PimAccountRow } from "@plainva/core";
import { isSignedOutSlot } from "./accountSignOut.js";

/**
 * Moving a password calendar account to an address another device confirmed
 * later (review 2026-11-18, the server move): the worker decides when
 * (`PimWorker`, `otherAccess`), this is what both shells do with it. The
 * target signs in with THIS device's own password — nothing travels to the
 * new address that this device did not already hold — and only for the same
 * user; adopting writes the new address into this device's sign-in and row.
 */
export interface PasswordAccessMovePorts {
  readSignIn(accountId: string): Promise<unknown>;
  /** Replaces the sign-in only if it is still `previous`. */
  rotateSignIn(accountId: string, previous: CalDavSignIn, next: CalDavSignIn): Promise<void>;
  /** The row's own address (`config.url`), on this device. */
  setRowAddress(accountId: string, url: string): Promise<void>;
  caldavTarget(creds: { url: string; user: string; pass: string }): IPimTarget;
}

export interface CalDavSignIn {
  kind: "caldav";
  url: string;
  user: string;
  pass: string;
  [key: string]: unknown;
}

function usableSignIn(value: unknown, access: ConfirmedAccess): CalDavSignIn | null {
  if (!value || typeof value !== "object" || isSignedOutSlot(value)) return null;
  const v = value as Partial<CalDavSignIn>;
  if (v.kind !== "caldav" || typeof v.url !== "string" || typeof v.user !== "string" || typeof v.pass !== "string" || !v.pass) return null;
  if (v.user !== access.user) return null;
  return v as CalDavSignIn;
}

export function passwordAccessMove(ports: PasswordAccessMovePorts): {
  target(account: PimAccountRow, access: ConfirmedAccess): Promise<IPimTarget | null>;
  adopt(account: PimAccountRow, access: ConfirmedAccess): Promise<void>;
} {
  return {
    async target(account, access) {
      if (account.provider !== "caldav") return null;
      const signIn = usableSignIn(await ports.readSignIn(account.id), access);
      return signIn ? ports.caldavTarget({ url: access.url, user: signIn.user, pass: signIn.pass }) : null;
    },
    async adopt(account, access) {
      const signIn = usableSignIn(await ports.readSignIn(account.id), access);
      if (!signIn) return;
      if (signIn.url !== access.url) await ports.rotateSignIn(account.id, signIn, { ...signIn, url: access.url });
      await ports.setRowAddress(account.id, access.url);
    },
  };
}
