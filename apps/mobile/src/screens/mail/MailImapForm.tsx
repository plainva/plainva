import { useTranslation } from "react-i18next";
import { useLeaveGuard } from "../../hooks/useLeaveGuard";
import { accountInputProps, Banner, Button, connectSecretLabelKey, getPlatformServices, TextInput } from "@plainva/ui";
import { useImapMailboxForm, type MailAccountConfig, type ImapFormValues } from "@plainva/ui/mail";

export type { ImapFormValues };

/**
 * Connecting or editing an IMAP mailbox on the phone (mail feinplan G4 / B4),
 * in its sheet. What the form holds, fills in and submits is the shared
 * `useImapMailboxForm` — the desktop's dialog on the mailbox row is the same
 * form (review 2026-11-25).
 *
 * Until now mobile could only add a mailbox the provider catalog knew, and told
 * everyone else to "connect it on the desktop" — while the desktop simply lets
 * you type host, port and SMTP. That sentence is gone: the address still picks
 * a preset (the usual case stays address + app password), and **Advanced**
 * opens the same fields the desktop has, pre-filled from the preset.
 */

export function MailImapForm({
  editing,
  busy,
  available,
  onSubmit,
  onCancel,
  presetId,
  prefill,
  onUseMicrosoft,
}: {
  /** Account being edited; absent = a new mailbox. */
  editing?: MailAccountConfig;
  busy: boolean;
  /** False only on the web dev server, which has no socket to a mail server. */
  available: boolean;
  onSubmit: (values: ImapFormValues) => void;
  onCancel?: () => void;
  /**
   * Preset implied by the provider tile the user came from (S0a). The address
   * still wins — but somebody on a custom domain hosted at Fastmail types an
   * address no preset matches, and we already know the servers from the tile.
   */
  presetId?: string;
  /**
   * Address and password the SAME wizard run already collected (P4d). A suite
   * asks for one credential and uses it for every service; typing it three
   * times is the thing the run exists to avoid. Only ever passed when the
   * screen was opened by a run, and `editing` always wins.
   */
  prefill?: { user?: string; pass?: string };
  /** The address belongs to a provider whose IMAP is closed (Outlook): the note's button goes there. */
  onUseMicrosoft?: () => void;
}) {
  const { t } = useTranslation();
  const form = useImapMailboxForm({ editing, presetId, prefill });
  const { email, setEmail, pass, setPass, advanced, setAdvanced, effective, preset, plan, complete, serverTouched } = form;

  // The app password typed here exists only in this state until submit. The bar
  // sits above the form and a tap on it clears the overlay, so without this the
  // password is discarded in silence — the same defect P0 fixed for the mail
  // draft and the vault credentials, on a screen the sweep never reached (S45).
  // The guard lives in the form, not the host screen, because the form owns the
  // secret; the host only receives it once submit has run.
  useLeaveGuard("mail-imap", form.dirty, t("mobile.leaveCredentials"));

  const field = (key: "host" | "smtpHost", label: string) => (
    <label className="m-field">
      <span>{label}</span>
      <TextInput
        {...accountInputProps("address")}
        value={effective[key]}
        onChange={(e) => form.setServer(key, e.target.value)}
      />
    </label>
  );

  const portField = (key: "port" | "smtpPort", label: string) => (
    <label className="m-field">
      <span>{label}</span>
      <TextInput
        {...accountInputProps("port")}
        value={String(effective[key])}
        onChange={(e) => form.setServer(key, e.target.value)}
      />
    </label>
  );

  return (
    <>
      {!available && <Banner kind="warning" rounded>{t("mail.imapMobileUnavailable")}</Banner>}
      <p className="m-hint">{t("mail.imapHint")}</p>

      <label className="m-field">
        <span>{t("mail.emailAddress")}</span>
        <TextInput
          value={email}
          {...accountInputProps("email")}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
        />
      </label>

      {preset && !serverTouched ? (
        <>
          <p className="m-hint">
            {preset.label} · {preset.host}:{preset.port}
          </p>
          {/* What the provider demands, and where to get it (finding
              2026-09-19). The desktop wizard has said all of this per preset
              since the catalog exists; the phone knew the preset and showed
              its name and port — a tester with a Gmail address got no word
              that his normal password would be refused, and no way to the
              page that issues the other one. */}
          {plan.notes.map((note) => (
            <p className="m-hint" key={note.key} data-testid="imap-note">
              {t(note.key, note.values)}
              {plan.useTileInstead && onUseMicrosoft && (
                <>
                  {" "}
                  <Button size="sm" variant="ghost" data-testid="imap-open-microsoft" onClick={onUseMicrosoft}>{t("cloudAccounts.presetOpenMicrosoft")}</Button>
                </>
              )}
            </p>
          ))}
          {plan.step && !plan.useTileInstead && <p className="m-hint" data-testid="imap-hint-app-password">{t(plan.step.key, plan.step.values)}</p>}
          {plan.guide && !plan.useTileInstead && (
            <div className="m-config-actions">
              {preset.appPasswordUrl && (
                <Button size="sm" variant="ghost" data-testid="imap-app-password-link" onClick={() => void getPlatformServices().openExternal(preset.appPasswordUrl!)}>
                  {t("cloudAccounts.gmailAppPasswordLink")}
                </Button>
              )}
              {preset.helpUrl && (
                <Button size="sm" variant="ghost" data-testid="imap-provider-help" onClick={() => void getPlatformServices().openExternal(preset.helpUrl!)}>
                  {t("cloudAccounts.providerHelp", { provider: preset.label })}
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        email.trim() !== "" && !advanced && <p className="m-hint">{t("mail.enterServerYourself")}</p>
      )}

      <label className="m-field">
        <span>{t(connectSecretLabelKey(plan.secret ?? "password"))}</span>
        <TextInput
          {...accountInputProps("secret")}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={editing ? t("mail.passwordKeep") : undefined}
        />
      </label>

      {advanced ? (
        <>
          {field("host", t("mail.imapHost"))}
          {portField("port", t("mail.imapPort"))}
          {field("smtpHost", t("mail.smtpHost"))}
          {portField("smtpPort", t("mail.smtpPort"))}
        </>
      ) : (
        <Button variant="ghost" onClick={() => setAdvanced(true)}>
          {t("mail.advanced")}
        </Button>
      )}

      <Button
        variant="primary"
        disabled={busy || !available || !complete}
        onClick={() => onSubmit(form.values())}
      >
        {editing ? t("common.save") : t("mail.connect")}
      </Button>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      )}
    </>
  );
}
