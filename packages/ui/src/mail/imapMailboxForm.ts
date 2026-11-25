import { useEffect, useState } from "react";
import { connectAccessPlan, type ConnectAccessPlan } from "../lib/connectAccess";
import { foldMachineText } from "../lib/machineText";
import { presetById, presetForEmail, type MailPreset } from "../lib/providerCatalog";
import { confirmTypedEndpointsIn, mailboxEndpoints, mailboxEndpointsNotInForm } from "../lib/endpointConfirmation";
import { checkMailLogin } from "./mailClient";
import { getMailPassword, saveMailAccount, type MailAccountConfig } from "./mailAccounts";

/**
 * Connecting or editing an IMAP mailbox — the form of both shells (mail
 * feinplan G4 / B4; the desktop's form to change a mailbox's servers, review
 * 2026-11-25). The phone shows it in a sheet, the desktop in a dialog on the
 * mailbox row; what it holds, what it fills in and what it saves is decided
 * here once.
 *
 * The address picks a preset (the usual case stays address + app password);
 * **Advanced** opens host, port and SMTP, filled from the preset or from the
 * mailbox being edited. An untouched password field while editing means
 * "keep the stored one" — a server move must not cost an app password.
 */

export interface ImapFormValues {
  label: string;
  host: string;
  port: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  /** Empty while editing = keep the stored password. */
  pass: string;
}

type ServerFields = { host: string; port: number; smtpHost: string; smtpPort: number };
const DEFAULTS: ServerFields = { host: "", port: 993, smtpHost: "", smtpPort: 587 };

export interface ImapMailboxForm {
  email: string;
  setEmail(value: string): void;
  pass: string;
  setPass(value: string): void;
  advanced: boolean;
  setAdvanced(value: boolean): void;
  /** The servers the form submits: the preset's while none was typed, else the typed ones. */
  effective: ServerFields;
  /** A server field typed: the preset stops overwriting the servers. */
  setServer(key: keyof ServerFields, value: string): void;
  serverTouched: boolean;
  preset: MailPreset | null;
  plan: ConnectAccessPlan;
  /** Everything a submit needs is there. */
  complete: boolean;
  /** Something was typed that a close would lose. */
  dirty: boolean;
  values(): ImapFormValues;
}

export function useImapMailboxForm({
  editing,
  presetId,
  prefill,
}: {
  /** Mailbox being edited; absent = a new one. */
  editing?: MailAccountConfig;
  /** Preset implied by the provider tile the user came from; the address still wins. */
  presetId?: string;
  /** Address and password a connect run already collected; `editing` always wins. */
  prefill?: { user?: string; pass?: string };
}): ImapMailboxForm {
  const [email, setEmail] = useState(editing?.user ?? prefill?.user ?? "");
  const [pass, setPass] = useState(editing ? "" : (prefill?.pass ?? ""));
  const [advanced, setAdvanced] = useState(false);
  const [server, setServerState] = useState<ServerFields>({
    host: editing?.host ?? DEFAULTS.host,
    port: editing?.port ?? DEFAULTS.port,
    smtpHost: editing?.smtpHost ?? DEFAULTS.smtpHost,
    smtpPort: editing?.smtpPort ?? DEFAULTS.smtpPort,
  });
  /** Set once the user edits a server field — and from the start when editing: the preset never overwrites a mailbox's servers. */
  const [serverTouched, setServerTouched] = useState(!!editing);
  // The address wins; the tile fills the gap when it matches nothing. Read
  // as a machine reads it: a keyboard set to Japanese types full-width forms
  // no preset and no server answers to (§ 3.43).
  const address = foldMachineText(email);
  const preset = presetForEmail(address) ?? (presetId ? presetById(presetId) : null) ?? null;

  useEffect(() => {
    if (serverTouched || !preset) return;
    setServerState({ host: preset.host, port: preset.port, smtpHost: preset.smtpHost, smtpPort: preset.smtpPort });
  }, [preset, serverTouched]);

  const effective = preset && !serverTouched ? { host: preset.host, port: preset.port, smtpHost: preset.smtpHost, smtpPort: preset.smtpPort } : server;
  // What the provider demands and where to get it — the description of the
  // sign-in step of both shells (settings plan 2026-10-29).
  const plan = connectAccessPlan({ family: "imap", services: ["mail"], providerName: preset?.label ?? "IMAP", preset });
  const complete = email.trim() !== "" && effective.host.trim() !== "" && (editing ? true : pass !== "") && !plan.useTileInstead;

  return {
    email,
    setEmail,
    pass,
    setPass,
    advanced,
    setAdvanced,
    effective,
    setServer: (key, value) => {
      setServerTouched(true);
      if (key === "port" || key === "smtpPort") {
        const n = Number(value.replace(/\D/g, ""));
        setServerState((s) => ({ ...s, [key]: Number.isFinite(n) ? n : 0 }));
      } else {
        setServerState((s) => ({ ...s, [key]: value }));
      }
    },
    serverTouched,
    preset,
    plan,
    complete,
    dirty: !!(pass || email !== (editing?.user ?? "") || serverTouched !== !!editing),
    values: () => ({
      label: address,
      host: foldMachineText(effective.host),
      port: effective.port,
      smtpHost: foldMachineText(effective.smtpHost),
      smtpPort: effective.smtpPort,
      user: address,
      pass,
    }),
  };
}

/** The mailbox a submit of the form describes: the one it found or edits, with what was typed. */
export function imapMailboxFromForm(existing: MailAccountConfig | undefined, values: ImapFormValues, newId: () => string): MailAccountConfig {
  return {
    ...existing,
    id: existing?.id ?? newId(),
    label: values.label,
    host: values.host,
    port: values.port,
    user: values.user,
    smtpHost: values.smtpHost || undefined,
    smtpPort: values.smtpHost ? values.smtpPort : undefined,
    kind: "imap",
  };
}

/**
 * The address rule of the form (review of F57, O3 and O-4): a server whose
 * endpoint was typed in this form — a new mailbox, or one changed while
 * editing — is confirmed by sending from it; one the form came with (the
 * edited mailbox's, unchanged) must have been confirmed before, also for an
 * edit that keeps the stored password; one the form does not show (Sieve,
 * carried over) is never typed.
 */
export async function confirmImapFormEndpoints(vaultKey: string, account: MailAccountConfig, editing: MailAccountConfig | undefined): Promise<void> {
  await confirmTypedEndpointsIn(vaultKey, mailboxEndpoints(account), [...(editing ? mailboxEndpoints(editing) : []), ...mailboxEndpointsNotInForm(account)]);
}

/** No password typed, and none stored for the mailbox being edited. */
export class MailPasswordMissingError extends Error {
  constructor() {
    super("mail password missing");
    this.name = "MailPasswordMissingError";
  }
}

/**
 * Saves an edited IMAP mailbox: its servers, its address, and its password
 * when one was typed (else the stored one stays). Verified before anything is
 * stored — an edit must not break a mailbox that worked a moment ago — and
 * only through the address rule above. An edit is no add
 * (`saveMailAccount(…, "edit")`).
 */
export async function saveEditedImapMailbox(vaultKey: string, editing: MailAccountConfig, values: ImapFormValues): Promise<MailAccountConfig> {
  const password = values.pass || ((await getMailPassword(vaultKey, editing.id)) ?? "");
  if (!password) throw new MailPasswordMissingError();
  const account = imapMailboxFromForm(editing, values, () => editing.id);
  await confirmImapFormEndpoints(vaultKey, account, editing);
  await checkMailLogin({ host: account.host, port: account.port, user: account.user, kind: "imap" }, password);
  await saveMailAccount(vaultKey, account, password, "edit");
  return account;
}
