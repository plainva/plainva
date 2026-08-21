import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLeaveGuard } from "../../hooks/useLeaveGuard";
import { Banner, Button, presetById, presetForEmail, TextInput } from "@plainva/ui";
import type { MailAccountConfig } from "@plainva/ui/mail";

/**
 * Connecting or editing an IMAP mailbox on the phone (mail feinplan G4 / B4).
 *
 * Until now mobile could only add a mailbox the provider catalog knew, and told
 * everyone else to "connect it on the desktop" — while the desktop simply lets
 * you type host, port and SMTP. That sentence is gone: the address still picks
 * a preset (the usual case stays address + app password), and **Advanced**
 * opens the same fields the desktop has, pre-filled from the preset.
 *
 * Editing an existing mailbox uses the same form. An untouched password field
 * means "keep the stored one" — a server move must not force the user to dig
 * out an app password again.
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

const DEFAULTS = { host: "", port: 993, smtpHost: "", smtpPort: 587 };

export function MailImapForm({
  editing,
  busy,
  available,
  onSubmit,
  onCancel,
  presetId,
  prefill,
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
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(editing?.user ?? prefill?.user ?? "");
  const [pass, setPass] = useState(editing ? "" : (prefill?.pass ?? ""));
  const [advanced, setAdvanced] = useState(false);
  const [server, setServer] = useState({
    host: editing?.host ?? DEFAULTS.host,
    port: editing?.port ?? DEFAULTS.port,
    smtpHost: editing?.smtpHost ?? DEFAULTS.smtpHost,
    smtpPort: editing?.smtpPort ?? DEFAULTS.smtpPort,
  });
  /** Set once the user edits a server field: the preset stops overwriting it. */
  const [serverTouched, setServerTouched] = useState(!!editing);

  // The app password typed here exists only in this state until submit. The bar
  // sits above the form and a tap on it clears the overlay, so without this the
  // password is discarded in silence — the same defect P0 fixed for the mail
  // draft and the vault credentials, on a screen the sweep never reached (S45).
  // The guard lives in the form, not the host screen, because the form owns the
  // secret; the host only receives it once submit has run.
  useLeaveGuard(
    "mail-imap",
    !!(pass || email !== (editing?.user ?? "") || serverTouched !== !!editing),
    t("mobile.leaveCredentials"),
  );
  // The address wins; the tile fills the gap when it matches nothing.
  const preset = presetForEmail(email) ?? (presetId ? presetById(presetId) : null);

  // The address picks the preset — but never over values the user typed, and
  // never over the account being edited.
  useEffect(() => {
    if (serverTouched || !preset) return;
    setServer({ host: preset.host, port: preset.port, smtpHost: preset.smtpHost, smtpPort: preset.smtpPort });
  }, [preset, serverTouched]);

  const effective = preset && !serverTouched
    ? { host: preset.host, port: preset.port, smtpHost: preset.smtpHost, smtpPort: preset.smtpPort }
    : server;
  const complete =
    email.trim() !== "" && effective.host.trim() !== "" && (editing ? true : pass !== "");

  const field = (key: "host" | "smtpHost", label: string) => (
    <label className="m-field">
      <span>{label}</span>
      <TextInput
        value={effective[key]}
        onChange={(e) => {
          setServerTouched(true);
          setServer((s) => ({ ...s, [key]: e.target.value }));
        }}
        autoCapitalize="none"
      />
    </label>
  );

  const portField = (key: "port" | "smtpPort", label: string) => (
    <label className="m-field">
      <span>{label}</span>
      <TextInput
        value={String(effective[key])}
        inputMode="numeric"
        onChange={(e) => {
          setServerTouched(true);
          const n = Number(e.target.value.replace(/\D/g, ""));
          setServer((s) => ({ ...s, [key]: Number.isFinite(n) ? n : 0 }));
        }}
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
          onChange={(e) => setEmail(e.target.value)}
          inputMode="email"
          autoCapitalize="none"
          placeholder="name@example.com"
        />
      </label>

      {preset && !serverTouched ? (
        <p className="m-hint">
          {preset.label} · {preset.host}:{preset.port}
        </p>
      ) : (
        email.trim() !== "" && !advanced && <p className="m-hint">{t("mail.enterServerYourself")}</p>
      )}

      <label className="m-field">
        <span>{t("mail.password")}</span>
        <TextInput
          type="password"
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
        onClick={() =>
          onSubmit({
            label: email.trim(),
            host: effective.host.trim(),
            port: effective.port,
            smtpHost: effective.smtpHost.trim(),
            smtpPort: effective.smtpPort,
            user: email.trim(),
            pass,
          })
        }
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
