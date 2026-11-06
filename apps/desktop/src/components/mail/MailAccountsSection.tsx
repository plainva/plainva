import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Users } from "lucide-react";
import { Banner, Button, EmptyState, ICON, IconButton, MenuItem, MenuSurface, mailboxesSwitchedOn, SettingCard, SettingCardBlock, SettingCardNote, SettingRow, Switch, familyOfMailAccount, refuseVaultPathSetting, serviceConnectionMessage, toast, type CloudServiceId, InfoTip } from "@plainva/ui";
import { RulesSettings } from "./RulesSettings";
import { VacationSettings } from "./VacationSettings";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, mailRemoteImagesKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { CLOUD_ACCOUNTS_EVENT, loadCloudAccounts, refreshCloudAccounts } from "../../services/cloudAccounts";
import { DEFAULT_MAIL_ACCOUNT_EVENT, loadDefaultMailAccount, saveDefaultMailAccount } from "../../services/mail/defaultMailAccount";
import { appConfirm } from "../../services/appDialogs";
import { checkMailLogin, listMailAccounts, mailAccountKind, pickDefaultMailAccount, setMailPassword, orphanedMailServer, useOrphanedMailAccounts, type MailAccountConfig } from "@plainva/ui/mail";
import { deviceSignInStates, type DeviceSignInState } from "../../services/deviceSignIn";
import { AccountMark } from "../settings/cloudAccountsShared";
import { Select } from "../Select";

/**
 * One mailbox row. It stays quiet while the mailbox works: a row only grows an
 * action when this device is missing the password, because that is the single
 * case the user can act on here (P2).
 *
 * A Microsoft mailbox has no password to type — its sign-in is an OAuth consent
 * and belongs to the connect flow, so the row points there instead of offering
 * a field that could never be filled in correctly.
 */
function MailAccountRow({
  vaultPath,
  account,
  signedIn,
  onSignedIn,
  onOpenCloudAccounts,
  signInRequest,
  isDefault,
  onSetDefault,
}: {
  vaultPath: string;
  account: MailAccountConfig;
  signedIn: DeviceSignInState;
  /** The mailbox Mail shows first and a new message starts from (finding 2026-11-06, M1); marked only beside another one. */
  isDefault?: boolean;
  /** Offered in the row menu on every other mailbox that can be the default. */
  onSetDefault?: () => void;
  onSignedIn: () => void;
  onOpenCloudAccounts?: (accountRef?: string, service?: CloudServiceId) => void;
  /** Bumped by the incomplete-accounts notice: open this row's sign-in and show it. */
  signInRequest?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const oauth = mailAccountKind(account) !== "imap";
  const needsSignIn = signedIn !== "active";

  // The notice's "Sign in on this device" lands HERE, in the same flow every
  // unsigned mailbox already offers — not in a second copy of it.
  useEffect(() => {
    if (!signInRequest) return;
    if (!oauth) setOpen(true);
    rowRef.current?.scrollIntoView?.({ block: "center" });
  }, [signInRequest, oauth]);

  const signIn = useCallback(async () => {
    if (!pass) return;
    setBusy(true);
    setError("");
    try {
      // Verify BEFORE storing: a wrong password that lands in the keychain
      // looks exactly like a working one until the next fetch fails, and the
      // failure then reads as a server problem rather than a typo.
      await checkMailLogin(
        { kind: account.kind, host: account.host, port: account.port, user: account.user, smtpHost: account.smtpHost, smtpPort: account.smtpPort },
        pass
      );
      await setMailPassword(vaultPath, account.id, pass);
      setPass("");
      setOpen(false);
      onSignedIn();
    } catch (e) {
      // The same translation as the phone's form: the server's answer word for
      // word, framed as such (finding 2026-09-24).
      setError(serviceConnectionMessage(e, t));
    } finally {
      setBusy(false);
    }
  }, [account, pass, vaultPath, onSignedIn, t]);

  return (
    <>
      <div className="pv-acct" data-testid="mail-account" ref={rowRef}>
        <AccountMark family={familyOfMailAccount({ kind: mailAccountKind(account), user: account.user, host: account.host })} small />
        <div className="pv-acct-who">
          <div className="pv-acct-name">
            {account.label}
            {isDefault && <>{" "}<span className="pv-badge pv-badge--accent pv-badge--text" data-testid="mail-account-default">{t("mail.defaultBadge")}</span></>}
          </div>
          <div className="pv-acct-id">
            {account.kind === "gmail" ? "Gmail" : oauth ? "Microsoft" : `${account.host}:${account.port}`}
          </div>
        </div>
        {needsSignIn && !oauth && (
          <Button variant="primary" onClick={() => setOpen((v) => !v)} data-testid="mail-signin-open">
            {t("deviceSignIn.submit")}
          </Button>
        )}
        {/* An OAuth mailbox - Microsoft or Gmail - signs in at its account card:
            the one sign-in renews every service of the account at once. */}
        {needsSignIn && oauth && onOpenCloudAccounts && (
          <Button variant="primary" onClick={() => onOpenCloudAccounts(account.id)} data-testid="mail-signin-oauth">
            {t("deviceSignIn.submit")}
          </Button>
        )}
        {/* Sender and signature of THIS mailbox live on its account's mail page (plan "Verbinden", V3). */}
        {onOpenCloudAccounts && (
          <Button variant="ghost" onClick={() => onOpenCloudAccounts(account.id, "mail")} data-testid={`mail-account-settings-${account.id}`}>
            {t("cloudAccounts.manageAccount")}
          </Button>
        )}
        {/* "Set as default" lives in the row menu, the mark beside the name
            (the pattern of the default AI profile, plan KI-Oberflaechen E3). */}
        {onSetDefault && (
          <IconButton label={t("common.moreActions")} size="sm" onClick={(e) => setMenuAt({ x: e.clientX, y: e.clientY })} data-testid={`mail-account-more-${account.id}`}>
            <MoreHorizontal size={ICON.ui} />
          </IconButton>
        )}
      </div>
      {menuAt && onSetDefault && (
        <MenuSurface open onClose={() => setMenuAt(null)} at={menuAt} ariaLabel={t("common.moreActions")}>
          <MenuItem onSelect={() => { setMenuAt(null); onSetDefault(); }} data-testid="mail-account-set-default">
            {t("mail.setDefault")}
          </MenuItem>
        </MenuSurface>
      )}
      {/* The description is deliberately the SAME sentence the phone shows for
          the same situation — two surfaces explaining one fact in two wordings
          is how they drift apart. */}
      {needsSignIn && open && !oauth && (
        <SettingRow
          label={t("mail.password", { defaultValue: "Passwort" })}
          desc={t("deviceSignIn.cardBodyStaticShort")}
          info={t("deviceSignIn.cardBodyStaticInfo")}
        >
          <input
            type="password"
            autoComplete="off"
            className="pv-field"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void signIn();
            }}
            data-testid="mail-signin-password"
            style={{ width: 180 }}
          />
          <Button variant="primary" disabled={busy || !pass} onClick={() => void signIn()} data-testid="mail-signin-submit">
            {busy ? t("common.loading", { defaultValue: "Lädt …" }) : t("deviceSignIn.submit", { defaultValue: "Anmelden" })}
          </Button>
        </SettingRow>
      )}
      {error && (
        <SettingCardNote>
          <span data-testid="mail-signin-error">{error}</span>
        </SettingCardNote>
      )}
    </>
  );
}

/**
 * The one-time notice about incomplete mail accounts (finding 2026-09-24, E4):
 * entries a failed setup left behind — no password, never a fetch. The rule and
 * the removal live in the shared hook; this renders it with the desktop's
 * account rows and asks the desktop's confirmation. Never removes by itself.
 */
export function OrphanedMailNotice({ vaultPath, reloadToken, onRemoved, onSignIn }: {
  vaultPath: string;
  reloadToken: number;
  onRemoved: () => void;
  /** The mailbox's own sign-in — the right choice when it works on another device. */
  onSignIn: (account: MailAccountConfig) => void;
}) {
  const { t } = useTranslation();
  const { dbAdapter, pimRuntime } = useVault();
  const notice = useOrphanedMailAccounts(vaultPath, dbAdapter, reloadToken);
  const [open, setOpen] = useState(false);
  if (!notice.visible) return null;

  const remove = async (account: MailAccountConfig) => {
    const label = account.label || account.user;
    const ok = await appConfirm({
      title: t("mail.orphans.confirmTitle"),
      message: t("mail.orphans.confirmMessage", { label }),
      confirmLabel: t("mail.orphans.remove"),
      kind: "danger",
    });
    if (!ok) return;
    try {
      const result = await notice.remove(account);
      toast.success(t(result === "removed" ? "mail.orphans.removed" : "mail.orphans.keptSignedIn"));
      // The card that referenced it loses the reference, exactly as after any
      // other removal of a mailbox.
      await refreshCloudAccounts(vaultPath, pimRuntime ?? null).catch(() => undefined);
      onRemoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // A row of the mailboxes card like the account rows below it (settings plan
  // 2026-10-29, P1): the banner gets the row inset, the orphans are .pv-acct rows.
  return (
    <>
      <SettingCardBlock>
        <Banner
          kind="warning"
          rounded
          actions={
            <>
              <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="mail-orphans-review">
                {t("mail.orphans.review")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void notice.later()} data-testid="mail-orphans-later">
                {t("mail.orphans.later")}
              </Button>
            </>
          }
        >
          <strong>{t("mail.orphans.title", { count: notice.orphans.length })}</strong>
          <InfoTip label={t("mail.orphans.title", { count: notice.orphans.length })} info={t("mail.orphans.body")} />{" "}
          {t("mail.orphans.bodyShort")}
        </Banner>
      </SettingCardBlock>
      {open &&
        notice.orphans.map((account) => (
          <div className="pv-acct" data-testid="mail-orphan" key={account.id}>
            <AccountMark family={familyOfMailAccount({ kind: mailAccountKind(account), user: account.user, host: account.host })} small />
            <div className="pv-acct-who">
              <div className="pv-acct-name">{account.label || account.user}</div>
              <div className="pv-acct-id">{t("mail.orphans.rowMeta", { server: orphanedMailServer(account) })}</div>
            </div>
            <Button variant="primary" onClick={() => onSignIn(account)} data-testid="mail-orphan-signin">
              {t("deviceSignIn.submit")}
            </Button>
            <Button variant="danger-soft" onClick={() => void remove(account)} data-testid="mail-orphan-remove">
              {t("mail.orphans.remove")}
            </Button>
          </div>
        ))}
    </>
  );
}

/**
 * The "E-Mail" service page content (cloud-accounts split): mailbox REFERENCES
 * plus the capture/privacy behavior. Connecting and removing mailboxes lives
 * in the Cloud-Konten area (connect wizard / account detail).
 */

export function MailAccountsSection({ onOpenCloudAccounts }: { onOpenCloudAccounts?: (accountRef?: string, service?: CloudServiceId) => void }) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [mailFolder, setMailFolder] = useState("");
  // The mailbox rules and out-of-office are set for (S13). Sender and
  // signature moved to the mail page of each account (plan "Verbinden", V3).
  const [sendingId, setSendingId] = useState("");

  // P2: which mailboxes actually have a credential ON THIS DEVICE. Account
  // metadata travels with the settings sync, passwords deliberately do not — so
  // a synced mailbox is normally present here but not signed in, and until now
  // the only sign of that was a raw exception the moment someone opened it.
  const [signIn, setSignIn] = useState<Map<string, DeviceSignInState>>(new Map());

  const loadSignIn = useCallback(
    async (list: MailAccountConfig[]) => {
      if (!vaultPath) return;
      setSignIn(await deviceSignInStates("mail", vaultPath, list.map((a) => a.id)));
    },
    [vaultPath]
  );

  // "Sign in on this device" from the incomplete-accounts notice: a Microsoft
  // mailbox signs in through Cloud accounts, every other one opens its own row.
  const [signInRequest, setSignInRequest] = useState<{ id: string; n: number } | null>(null);
  const signInHere = useCallback(
    (account: MailAccountConfig) => {
      if (mailAccountKind(account) === "microsoft") {
        onOpenCloudAccounts?.(account.id);
        return;
      }
      setSignInRequest((prev) => ({ id: account.id, n: (prev?.n ?? 0) + 1 }));
    },
    [onOpenCloudAccounts]
  );

  // Bumped on every reload, so the orphan notice re-checks after a sign-in or
  // a removal instead of offering an entry that just changed.
  const [reloads, setReloads] = useState(0);
  /** The vault's default mailbox (device-local id) and the mailboxes whose mail is on (E3). */
  const [defaultId, setDefaultId] = useState("");
  const [switchedOn, setSwitchedOn] = useState<ReadonlySet<string>>(new Set());
  const reload = useCallback(async () => {
    if (!vaultPath) return;
    const [list, cards, chosen] = await Promise.all([
      listMailAccounts(vaultPath),
      loadCloudAccounts(vaultPath).catch(() => []),
      loadDefaultMailAccount(vaultPath).catch(() => ""),
    ]);
    setAccounts(list);
    setDefaultId(chosen);
    setSwitchedOn(new Set(mailboxesSwitchedOn(list, cards).map((a) => a.id)));
    setReloads((n) => n + 1);
    await loadSignIn(list);
  }, [vaultPath, loadSignIn]);

  useEffect(() => {
    void reload();
    const onChanged = () => void reload();
    window.addEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
    window.addEventListener(DEFAULT_MAIL_ACCOUNT_EVENT, onChanged);
    return () => {
      window.removeEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
      window.removeEventListener(DEFAULT_MAIL_ACCOUNT_EVENT, onChanged);
    };
  }, [reload]);

  // The mailbox the rest of the app falls to (`pickDefaultMailAccount`), among
  // those whose mail is on; marked only where there is another one.
  const effectiveDefault = accounts.length > 1 ? pickDefaultMailAccount(accounts.filter((a) => switchedOn.has(a.id)), defaultId)?.id : undefined;
  const setDefault = useCallback(async (id: string) => {
    if (!vaultPath) return;
    await saveDefaultMailAccount(vaultPath, id);
  }, [vaultPath]);

  // Keep the picker on a real account; without one it starts on the default mailbox.
  useEffect(() => {
    const current = accounts.find((a) => a.id === sendingId) ?? pickDefaultMailAccount(accounts, defaultId);
    if (!current) {
      setSendingId("");
      return;
    }
    if (current.id !== sendingId) setSendingId(current.id);
  }, [accounts, sendingId, defaultId]);
  const sendingAccount = useMemo(() => accounts.find((a) => a.id === sendingId) ?? null, [accounts, sendingId]);

  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      const v = (await store.get<string>(mailFolderKey(vaultPath))) ?? "";
      if (alive) setMailFolder(v);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);

  const persistMailFolder = useCallback(async () => {
    if (!vaultPath) return;
    const store = await getSettingsStore();
    // No folder under .plainva or outside the vault (3.127 no. 4): the field goes back to what is stored.
    if (refuseVaultPathSetting(mailFolder.trim())) {
      setMailFolder((await store.get<string>(mailFolderKey(vaultPath))) ?? "");
      return;
    }
    await store.set(mailFolderKey(vaultPath), mailFolder.trim());
    await store.save();
  }, [vaultPath, mailFolder]);

  // Remote-image opt-in (default OFF — loading remote images is tracking).
  const [remoteImages, setRemoteImages] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      const v = await store.get<boolean>(mailRemoteImagesKey(vaultPath));
      if (alive) setRemoteImages(v === true);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);
  const persistRemoteImages = useCallback(
    async (value: boolean) => {
      if (!vaultPath) return;
      setRemoteImages(value);
      const store = await getSettingsStore();
      await store.set(mailRemoteImagesKey(vaultPath), value);
      await store.save();
      window.dispatchEvent(new CustomEvent("plainva-mail-settings-changed"));
    },
    [vaultPath]
  );

  if (!vaultPath) return null;

  return (
    <div data-testid="mail-accounts">
      <SettingCard label={t("cloudAccounts.mailboxesGroup")} info={t("mail.defaultHint")}>
        <OrphanedMailNotice vaultPath={vaultPath} reloadToken={reloads} onRemoved={() => void reload()} onSignIn={signInHere} />
        {accounts.length === 0 && (
          <EmptyState title={t("mail.noAccounts", { defaultValue: "Noch kein E-Mail-Konto verbunden." })} icon={<Users size={ICON.empty} />}>
            {onOpenCloudAccounts && (
              <Button variant="primary" onClick={() => onOpenCloudAccounts(undefined, "mail")} data-testid="mail-open-cloudaccounts">
                {t("cloudAccounts.openArea")}
              </Button>
            )}
          </EmptyState>
        )}
        {accounts.map((account) => (
          <MailAccountRow
            key={account.id}
            vaultPath={vaultPath}
            account={account}
            signedIn={signIn.get(account.id) ?? "active"}
            onSignedIn={() => void reload()}
            onOpenCloudAccounts={onOpenCloudAccounts}
            signInRequest={signInRequest?.id === account.id ? signInRequest.n : undefined}
            isDefault={account.id === effectiveDefault}
            onSetDefault={effectiveDefault !== undefined && account.id !== effectiveDefault && switchedOn.has(account.id) ? () => void setDefault(account.id) : undefined}
          />
        ))}
      </SettingCard>

      <SettingCard label={t("cloudAccounts.mailCaptureGroup")}>
        <SettingRow label={t("mail.folder", { defaultValue: "E-Mail-Ordner" })} info={t("mail.folderHint")}>
          <input
            autoComplete="off"
            value={mailFolder}
            onChange={(e) => setMailFolder(e.target.value)}
            onBlur={() => void persistMailFolder()}
            placeholder={DEFAULT_MAIL_FOLDER}
            className="pv-field"
            data-testid="mail-folder"
            style={{ width: 180 }}
          />
        </SettingRow>
        {/* The privacy consequence and the spam exception stay visible; how
            the default works is behind the info. The switch does not reach
            into the spam folder (plan Befunde 06.10., E6) — said here, where
            the switch is, on both shells. */}
        <SettingRow
          label={t("mail.loadRemoteImages", { defaultValue: "Externe Bilder immer laden" })}
          desc={`${t("mail.loadRemoteImagesShort")} ${t("mail.loadRemoteImagesJunkShort")}`}
          info={[t("mail.loadRemoteImagesHint"), t("mail.loadRemoteImagesJunk")].join("\n\n")}
        >
          <Switch
            checked={remoteImages}
            onChange={(on) => void persistRemoteImages(on)}
            label={t("mail.loadRemoteImages", { defaultValue: "Externe Bilder immer laden" })}
            testId="mail-remote-images"
          />
        </SettingRow>
      </SettingCard>

      {/* The out-of-office notice belongs to the SENDING account, so it sits
          right below the account picker it shares (S13). */}
      {accounts.length > 1 && (
        <SettingCard label={t("mail.account")}>
          <SettingRow label={t("mail.account")} desc={t("cloudAccounts.mailAccountPickHint")}>
            <Select
              value={sendingId}
              onChange={setSendingId}
              ariaLabel={t("mail.account")}
              data-testid="mail-sending-account"
              options={accounts.map((a) => ({ value: a.id, label: a.label || a.user }))}
            />
          </SettingRow>
          {/* Sender and signature are on the account's e-mail page — a link
              rather than a sentence that names the place (Q4). */}
          {onOpenCloudAccounts && (
            <SettingRow label={t("cloudAccounts.mailAccountPickLink")}>
              <Button variant="ghost" size="sm" onClick={() => onOpenCloudAccounts(sendingId, "mail")} data-testid="mail-sender-signature">
                {t("mobile.open")} ›
              </Button>
            </SettingRow>
          )}
        </SettingCard>
      )}
      {accounts.length > 0 && <RulesSettings vaultPath={vaultPath} account={sendingAccount ?? null} />}
      {accounts.length > 0 && <VacationSettings vaultPath={vaultPath} account={sendingAccount ?? null} />}

    </div>
  );
}
