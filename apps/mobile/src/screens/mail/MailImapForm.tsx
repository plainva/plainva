import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, presetForEmail, TextInput } from "@plainva/ui";
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
}: {
  /** Account being edited; absent = a new mailbox. */
  editing?: MailAccountConfig;
  busy: boolean;
  /** False only on the web dev server, which has no socket to a mail server. */
  available: boolean;
  onSubmit: (values: ImapFormValues) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(editing?.user ?? "");
  const [pass, setPass] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [server, setServer] = useState({
    host: editing?.host ?? DEFAULTS.host,
    port: editing?.port ?? DEFAULTS.port,
    smtpHost: editing?.smtpHost ?? DEFAULTS.smtpHost,
    smtpPort: editing?.smtpPort ?? DEFAULTS.smtpPort,
  });
  /** Set once the user edits a server field: the preset stops overwriting it. */
  const [serverTouched, setServerTouched] = useState(!!editing);
  const preset = presetForEmail(email);

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
      {!available && <p className="m-hint m-hint--warn">{t("mail.imapMobileUnavailable")}</p>}
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
