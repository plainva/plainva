import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, familyLabel, GroupCard, ICON, IconButton, Row, RowList, SectionLabel, Segmented, Switch, TextArea, TextInput, toast, type CloudProviderFamily } from "@plainva/ui";
import { mailTargetForFamily } from "../services/familyTarget";
import type { MailAccountConfig, MailRule } from "@plainva/ui/mail";
import { checkMailLogin, getMailPassword, listMailRules, saveMailRules, setMailRules as putMailRules, mailAccountKind, normalizeSenderAddress, saveMailAccount, senderOptions, setVacation, updateMailAccount, vacationSupport } from "@plainva/ui/mail";
import { MailImapForm, type ImapFormValues } from "./mail/MailImapForm";
import { mConfirm, mPrompt, mSelect } from "../services/mobileDialogs";
import {
  connectMicrosoftMail,
  listMobileMailAccounts,
  mailVaultId,
  removeMobileMailAccount,
  MAIL_CHANGED_EVENT,
} from "../services/mail/mailRuntime";
import { deviceSignInStates, type DeviceSignInState } from "../services/deviceSignIn";
import { notifyMailChanged } from "../services/mail/mailRuntime";
import { hasNativeMailSocket } from "../adapters/mailNet";
import { DeviceSignInBadge } from "../components/DeviceSignInRow";
import { AppBar } from "../components/AppBar";
import { ConnectRunBanner } from "../components/ConnectRunBanner";

/**
 * Mobile mail accounts (mail feinplan G1). Stage one connects Microsoft only:
 * Graph is plain HTTPS and rides the bridge the sync already uses, while
 * IMAP/SMTP need raw TLS sockets and therefore the native plugin from G2.
 * The screen says that outright instead of offering a form that would fail.
 *
 * Accounts are the same records the desktop writes (settings store + secure
 * store); a mailbox that arrived through the settings sync shows the shared
 * "sign in on this device" badge, because credentials never travel.
 */
export function MailAccountsScreen({
  bump,
  onBack,
  onOpenRule,
  family,
}: {
  bump: number;
  onBack?: () => void;
  onOpenRule?: (id: string) => void;
  /**
   * Set when the user came through the connect wizard (S0a) — the backend is
   * then settled and the Microsoft/IMAP switch would only invite a second,
   * contradicting choice.
   */
  family?: CloudProviderFamily;
}) {
  const { t } = useTranslation();
  const mailPreset = family ? mailTargetForFamily(family) : null;
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [signIn, setSignIn] = useState<Map<string, DeviceSignInState>>(new Map());
  // Microsoft uses the shipped central client id; the field stays empty and
  // hidden (never expose our app id) unless the user brings their own.
  const [msClientId, setMsClientId] = useState("");
  const [msShowId, setMsShowId] = useState(false);
  const [busy, setBusy] = useState(false);
  // Per-account sending settings (issue #34 round 1): signature and the
  // additional sender addresses. Not credentials — editing them must never ask
  // for the password again, so they go through the metadata-only update.
  const [sendingId, setSendingId] = useState("");
  const [signature, setSignature] = useState("");
  const [senders, setSenders] = useState("");
  // P8.2: which address the signature field is pointed at. "" = the account
  // default, which every address without its own signature uses.
  const [sigAddress, setSigAddress] = useState("");
  // IMAP sign-in (G2): the address picks the preset, so the usual case is
  // address + app password and nothing else.
  const [kind, setKind] = useState<"microsoft" | "imap">(mailPreset?.backend ?? "microsoft");
  /** Account being edited (B4) — the same form serves adding and editing. */
  const [editing, setEditing] = useState<MailAccountConfig | null>(null);
  const imapAvailable = hasNativeMailSocket();

  const reload = useCallback(() => {
    void listMobileMailAccounts()
      .then(async (rows) => {
        setAccounts(rows);
        const vault = mailVaultId();
        setSignIn(vault ? await deviceSignInStates("mail", vault, rows.map((r) => r.id)) : new Map());
      })
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => { reload(); }, [reload, bump]);
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener(MAIL_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(MAIL_CHANGED_EVENT, onChanged);
  }, [reload]);

  // Keep the sending form on a real account and show ITS values; a removed
  // account falls back to the first one instead of editing a ghost.
  const sendingAccount = accounts.find((a) => a.id === sendingId) ?? accounts[0] ?? null;

  /**
   * The out-of-office notice (S13). Offered only where the server keeps
   * answering without Plainva — otherwise the section says why instead of
   * carrying a switch that writes nowhere.
   */
  const vacationKind = sendingAccount ? vacationSupport(sendingAccount).kind : "none";
  const [mailRules, setMailRules] = useState<MailRule[]>([]);
  const [publishing, setPublishing] = useState(false);
  useEffect(() => {
    const vault = mailVaultId();
    if (vault) void listMailRules(vault).then(setMailRules).catch(() => setMailRules([]));
  }, [bump]);

  /** A new rule starts as a whole one — name, one condition, one action — so
   * the editor opens on something that already means something. An empty rule
   * would never fire, and would look like the editor was broken. */
  const addRule = useCallback(async () => {
    const vault = mailVaultId();
    if (!vault) return;
    const { value, cancelled } = await mPrompt({ title: t("rules.name", { defaultValue: "Name" }), initial: t("rules.newRule") });
    if (cancelled || !value.trim()) return;
    const rule: MailRule = {
      id: `r${Date.now().toString(36)}`,
      name: value.trim(),
      enabled: true,
      match: "all",
      conditions: [{ field: "from", op: "contains", value: "" }],
      actions: [{ kind: "markRead" }],
    };
    const next = [...mailRules, rule];
    setMailRules(next);
    await saveMailRules(vault, next);
    onOpenRule?.(rule.id);
  }, [mailRules, onOpenRule, t]);

  /** Same call as the desktop card: one path, so a rule set from the phone and
   * one set from the desktop end up as the same thing on the server. */
  const publishRules = useCallback(async () => {
    const vault = mailVaultId();
    if (!vault || !sendingAccount) return;
    setPublishing(true);
    try {
      const result = await putMailRules(vault, sendingAccount, mailRules);
      if (result.unreadable) toast.error(t("rules.scriptForeign"));
      else if (result.ok)
        toast.info(result.skipped.length ? t("rules.publishedPartly", { count: result.skipped.length }) : t("rules.published"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }, [mailRules, sendingAccount, t]);
  const [vacEnabled, setVacEnabled] = useState(false);
  const [vacSubject, setVacSubject] = useState("");
  const [vacMessage, setVacMessage] = useState("");
  const [vacFrom, setVacFrom] = useState("");
  const [vacTo, setVacTo] = useState("");
  const [vacBusy, setVacBusy] = useState(false);

  const saveVacation = async () => {
    const vault = mailVaultId();
    if (!vault || !sendingAccount) return;
    setVacBusy(true);
    try {
      const ok = await setVacation(vault, sendingAccount, {
        enabled: vacEnabled,
        subject: vacSubject.trim() || undefined,
        message: vacMessage,
        from: vacFrom || undefined,
        to: vacTo || undefined,
        addresses: [sendingAccount.user],
      });
      if (ok) toast.success(t("vacation.saved"));
      else toast.error(t("vacation.scriptForeign"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setVacBusy(false);
    }
  };
  useEffect(() => {
    if (!sendingAccount) {
      setSendingId("");
      return;
    }
    if (sendingAccount.id !== sendingId) setSendingId(sendingAccount.id);
    setSignature(sendingAccount.signature ?? "");
    setSenders((sendingAccount.senders ?? []).join("\n"));
  }, [sendingAccount, sendingId]);

  const persistSending = useCallback(
    async (patch: Partial<MailAccountConfig>) => {
      const vault = mailVaultId();
      if (!vault || !sendingAccount) return;
      await updateMailAccount(vault, sendingAccount.id, patch);
      notifyMailChanged();
    },
    [sendingAccount]
  );

  const pickSendingAccount = () => {
    void mSelect({
      title: t("mail.account", { defaultValue: "Konto" }),
      options: accounts.map((a) => ({ value: a.id, label: a.label || a.user })),
      value: sendingId,
    }).then((v) => {
      if (v !== null) setSendingId(v);
    });
  };

  /** Saves to the selected address, or to the account default. An emptied
   * per-address signature is REMOVED, so the address falls back to the default —
   * which is what "no own signature" means. */
  const persistSignature = async (text: string) => {
    if (!sendingAccount) return;
    if (!sigAddress) {
      await persistSending({ signature: text });
      return;
    }
    const key = normalizeSenderAddress(sigAddress);
    const next = { ...(sendingAccount.signatures ?? {}) };
    if (text.trim()) next[key] = text;
    else delete next[key];
    await persistSending({ signatures: next });
  };

  const pickSignatureAddress = () => {
    if (!sendingAccount) return;
    void mSelect({
      title: t("mail.signatureAddress", { defaultValue: "Signatur für" }),
      options: [
        { value: "", label: t("mail.signatureDefault", { defaultValue: "Standard (alle Adressen)" }) },
        ...senderOptions(sendingAccount).map((address) => ({
          value: address,
          label: sendingAccount.signatures?.[normalizeSenderAddress(address)] ? `${address} ✓` : address,
        })),
      ],
      value: sigAddress,
    }).then((v) => {
      if (v !== null) setSigAddress(v);
    });
  };

  const connect = async () => {
    setBusy(true);
    try {
      await connectMicrosoftMail(msClientId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Adds a new IMAP mailbox, or saves an edited one (B4). */
  const submitImap = async (v: ImapFormValues) => {
    const vault = mailVaultId();
    if (!vault) return;
    setBusy(true);
    try {
      // An untouched password field means "keep the stored one" — changing a
      // server address must not cost the user their app password.
      const password = v.pass || (editing ? ((await getMailPassword(vault, editing.id)) ?? "") : "");
      if (!password) throw new Error(t("mail.passwordMissing"));
      const account: MailAccountConfig = {
        id: editing?.id ?? crypto.randomUUID(),
        label: v.label,
        host: v.host,
        port: v.port,
        user: v.user,
        smtpHost: v.smtpHost || undefined,
        smtpPort: v.smtpHost ? v.smtpPort : undefined,
        kind: "imap",
      };
      // Verify before storing: a rejected password must not leave a broken
      // account behind (the same guarantee the Microsoft path gives) — and an
      // edit must not break a mailbox that worked a moment ago.
      await checkMailLogin({ host: account.host, port: account.port, user: account.user, kind: "imap" }, password);
      await saveMailAccount(vault, account, password);
      setEditing(null);
      toast.success(t(editing ? "mail.accountSaved" : "mail.accountAdded"));
      notifyMailChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: MailAccountConfig) => {
    if (!(await mConfirm({ title: t("mail.removeAccountConfirm"), message: a.label, danger: true }))) return;
    try {
      await removeMobileMailAccount(a.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("mail.accounts", { defaultValue: "Postfächer" })} />
      <ConnectRunBanner service="mail" />

      <div className="m-sync">
        {/* Same truth as the calendar screen: settings sync, sign-ins do not. */}
        <p className="m-hint">{t("pim.perDeviceHint")}</p>

        {accounts.length === 0 ? (
          <p className="m-hint">{t("mail.noAccounts")}</p>
        ) : (
          accounts.map((a) => {
            const state = signIn.get(a.id) ?? "active";
            const imap = mailAccountKind(a) === "imap";
            return (
              <div key={a.id} style={{ marginBottom: 16 }}>
                <div className="m-row m-acct" data-testid={`mail-account-${a.id}`}>
                  <span className="m-acct-name">{a.label}</span>
                  <DeviceSignInBadge state={state} />
                  <span className="m-acct-provider">{imap ? "IMAP" : "Microsoft"}</span>
                  {imap && (
                    /* Editing an existing mailbox (B4) — a server move used to
                       mean removing the account and adding it again. */
                    <IconButton label={t("common.edit")} onClick={() => { setKind("imap"); setEditing(a); }}>
                      <Pencil size={ICON.ui} />
                    </IconButton>
                  )}
                  <IconButton
                    label={t("mail.removeAccount", { defaultValue: "Postfach entfernen" })}
                    onClick={() => void remove(a)}
                  >
                    <Trash2 size={ICON.ui} />
                  </IconButton>
                </div>
                {imap && !imapAvailable ? (
                  /* Only the web dev server lacks a socket; on a device IMAP
                     works and the row needs no caveat. */
                  <p className="m-hint m-acct-hint">{t("mail.imapMobileUnavailable")}</p>
                ) : (
                  state === "signin" && (
                    <p className="m-hint m-acct-hint">
                      {imap ? t("deviceSignIn.rowHintStatic") : t("deviceSignIn.rowHintOauth")}
                    </p>
                  )
                )}
              </div>
            );
          })
        )}

        {accounts.length > 0 && (
          <>
            {/* Was a naked <h2> with an inline font size — it rendered LARGER
                than the app-bar title above it, so the page had two competing
                first lines. It is a section heading like every other. */}
            {/* The out-of-office notice, and exactly where it belongs: this is
                the page a person opens on the way out the door, not at a desk
                (S13). It is offered ONLY where the server keeps answering after
                the phone is put away — otherwise a sentence saying why. */}
            {/* Rules (S14). The phone runs them locally, and "locally" is
                narrower here than on a desktop — so the label says the narrower
                thing. Editing them is its own step (S16b); what belongs here is
                the truth about when they run. */}
            <SectionLabel>{t("rules.section")}</SectionLabel>
            <GroupCard>
              <RowList>
                {mailRules.map((r) => (
                  <Row
                    key={r.id}
                    title={r.name}
                    end={
                      <>
                        <span className="m-prop-val">{r.enabled ? t("common.on") : t("common.off")}</span>
                        <ChevronRight size={ICON.ui} />
                      </>
                    }
                    data-testid={`rule-row-${r.id}`}
                    onClick={() => onOpenRule?.(r.id)}
                  />
                ))}
                <Row
                  icon={<Plus size={ICON.ui} />}
                  title={t("rules.add")}
                  data-testid="rule-add"
                  onClick={() => void addRule()}
                />
              </RowList>
            </GroupCard>
            {/* Where the mailbox can run them, say so; where it cannot, say the
                narrower truth instead of implying a server filter. */}
            <p className="m-hint" data-testid="rules-where">
              {vacationKind === "sieve"
                ? t("rules.sieveHint", { host: sendingAccount?.sieveHost ?? "" })
                : vacationKind === "graph"
                  ? t("rules.graphHint")
                  : t("rules.localMobile")}
            </p>
            {mailRules.length > 0 && vacationKind !== "none" && (
              <Button variant="primary" disabled={publishing} onClick={() => void publishRules()} data-testid="rules-publish">
                {t("rules.publish")}
              </Button>
            )}

            <SectionLabel>{t("vacation.section")}</SectionLabel>
            {vacationKind === "none" ? (
              <p className="m-hint" data-testid="vacation-unsupported">{t("vacation.unsupported")}</p>
            ) : (
              <>
                <GroupCard>
                  <RowList>
                    <Row
                      title={t("vacation.enabled")}
                      end={<Switch checked={vacEnabled} label={t("vacation.enabled")} onChange={setVacEnabled} />}
                    />
                  </RowList>
                </GroupCard>
                <label className="m-field">
                  <span>{t("vacation.subject")}</span>
                  <TextInput value={vacSubject} onChange={(e) => setVacSubject(e.target.value)} data-testid="vacation-subject" />
                </label>
                <label className="m-field">
                  <span>{t("vacation.message")}</span>
                  <TextArea rows={4} value={vacMessage} onChange={(e) => setVacMessage(e.target.value)} data-testid="vacation-message" />
                </label>
                <label className="m-field">
                  <span>{t("vacation.from")}</span>
                  <TextInput type="date" value={vacFrom} onChange={(e) => setVacFrom(e.target.value)} data-testid="vacation-from" />
                </label>
                <label className="m-field">
                  <span>{t("vacation.to")}</span>
                  <TextInput type="date" value={vacTo} onChange={(e) => setVacTo(e.target.value)} data-testid="vacation-to" />
                </label>
                <p className="m-hint">{t("vacation.windowHint")}</p>
                <Button variant="primary" disabled={vacBusy} onClick={() => void saveVacation()} data-testid="vacation-save">
                  {t("vacation.save")}
                </Button>
                <p className="m-hint">{vacationKind === "graph" ? t("vacation.viaGraph") : t("vacation.viaSieveShort")}</p>
              </>
            )}

            <SectionLabel>{t("mail.sendingGroup", { defaultValue: "Senden" })}</SectionLabel>
            {(accounts.length > 1 || (sendingAccount && senderOptions(sendingAccount).length > 1)) && (
              <GroupCard>
                <RowList>
                  {accounts.length > 1 && (
                    <Row
                      end={<><span className="m-prop-val">{sendingAccount?.label || sendingAccount?.user}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
                      onClick={pickSendingAccount}
                      title={t("mail.account", { defaultValue: "Konto" })}
                    />
                  )}
                  {sendingAccount && senderOptions(sendingAccount).length > 1 && (
                    <Row
                      data-testid="mail-signature-address"
                      end={<><span className="m-prop-val">{sigAddress || t("mail.signatureDefault", { defaultValue: "Standard (alle Adressen)" })}</span><ChevronRight className="m-chevron" size={ICON.ui} /></>}
                      onClick={pickSignatureAddress}
                      title={t("mail.signatureAddress", { defaultValue: "Signatur für" })}
                    />
                  )}
                </RowList>
              </GroupCard>
            )}
            <label className="m-field">
              <span>{t("mail.signature", { defaultValue: "Signatur" })}</span>
              <TextArea
                rows={4}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                onBlur={() => void persistSignature(signature)}
                data-testid="mail-signature"
              />
            </label>
            <p className="m-hint">{t("mail.signatureHint")}</p>
            <label className="m-field">
              <span>{t("mail.senders", { defaultValue: "Weitere Absender-Adressen" })}</span>
              <TextArea
                rows={3}
                value={senders}
                onChange={(e) => setSenders(e.target.value)}
                onBlur={() => void persistSending({ senders: senders.split("\n").map((l) => l.trim()).filter(Boolean) })}
                data-testid="mail-senders"
              />
            </label>
            <p className="m-hint">{t("mail.sendersHint")}</p>
          </>
        )}

        <SectionLabel>
          {editing
            ? t("common.edit")
            : family
              ? familyLabel(family)
              : t("mail.addAccount", { defaultValue: "Postfach hinzufügen" })}
        </SectionLabel>
        {/* The backend switch is hidden once the wizard settled the provider
            (S0a) — offering it again would let a Microsoft tile end on IMAP. */}
        {!editing && !family && (
          <Segmented
            ariaLabel={t("mail.backend")}
            options={[
              { value: "microsoft", label: "Microsoft" },
              { value: "imap", label: "IMAP" },
            ]}
            value={kind}
            onChange={(v) => setKind(v as "microsoft" | "imap")}
          />
        )}

        {kind === "imap" ? (
          <MailImapForm
            key={editing?.id ?? "new"}
            available={imapAvailable}
            busy={busy}
            editing={editing ?? undefined}
            onCancel={editing ? () => setEditing(null) : undefined}
            onSubmit={(v) => void submitImap(v)}
            presetId={editing ? undefined : mailPreset?.presetId}
          />
        ) : (
          <>
        <p className="m-hint">{t("mail.microsoftHint")}</p>

        {msShowId ? (
          <label className="m-field">
            <span>{t("settings.clientId")}</span>
            <TextInput onChange={(e) => setMsClientId(e.target.value)} value={msClientId} placeholder="00000000-0000-0000-0000-000000000000" />
          </label>
        ) : (
          <Button variant="ghost" onClick={() => setMsShowId(true)}>
            {t("settings.useOwnAppId")}
          </Button>
        )}

        <Button variant="primary" disabled={busy} onClick={() => void connect()}>
          {t("mail.connectMicrosoft")}
        </Button>
          </>
        )}
      </div>
    </div>
  );
}
