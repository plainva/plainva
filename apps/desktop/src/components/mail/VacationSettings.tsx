import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, SettingCard, SettingCardNote, SettingRow, toast } from "@plainva/ui";
import { SIEVE_PORT, setVacation, vacationSupport, type MailAccountConfig } from "@plainva/ui/mail";

/**
 * The out-of-office notice — Settings → E-Mail (S13).
 *
 * The rule that shapes this card: **it appears only where it survives the
 * machine being switched off.** An account with neither a Sieve server nor
 * Microsoft Graph gets no switch, and a sentence saying why — a control that
 * needs Plainva running would be a promise that breaks when someone closes the
 * lid, which is precisely the moment the notice is supposed to answer.
 *
 * Where the account HAS a Sieve server, Plainva writes one clearly marked
 * section of the script and leaves everything else byte for byte. A script it
 * cannot parse is reported, not overwritten.
 */
export function VacationSettings({ vaultPath, account }: { vaultPath: string; account: MailAccountConfig | null }) {
  const { t } = useTranslation();
  const support = account ? vacationSupport(account) : { kind: "none" as const };

  const [enabled, setEnabled] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(false);
    setSubject("");
    setMessage("");
    setFrom("");
    setTo("");
  }, [account?.id]);

  const save = useCallback(async () => {
    if (!account) return;
    setBusy(true);
    try {
      const ok = await setVacation(vaultPath, account, {
        enabled,
        subject: subject.trim() || undefined,
        message,
        from: from || undefined,
        to: to || undefined,
        addresses: [account.user],
      });
      toast[ok ? "info" : "error"](
        ok
          ? t("vacation.saved", { defaultValue: "Abwesenheitsnotiz beim Anbieter hinterlegt" })
          : t("vacation.scriptForeign", { defaultValue: "Das Filterskript enthält einen Abschnitt, den Plainva nicht sicher lesen kann — es wurde nichts geändert." })
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultPath, account, enabled, subject, message, from, to, t]);

  if (!account) return null;

  if (support.kind === "none") {
    return (
      <SettingCard label={t("vacation.section", { defaultValue: "Abwesenheitsnotiz" })}>
        <SettingCardNote>
          <Banner kind="info" rounded>
            <span data-testid="vacation-unsupported">
            {t("vacation.unsupported", {
              defaultValue:
                "Dieses Postfach bietet keine serverseitige Abwesenheitsnotiz. Plainva bietet sie deshalb nicht an — eine Antwort, die nur läuft, während Plainva offen ist, wäre keine.",
            })}
            </span>
          </Banner>
        </SettingCardNote>
      </SettingCard>
    );
  }

  return (
    <SettingCard label={t("vacation.section", { defaultValue: "Abwesenheitsnotiz" })}>
      <SettingRow label={t("vacation.enabled", { defaultValue: "Abwesenheitsnotiz aktiv" })}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="pv-check" data-testid="vacation-enabled" />
      </SettingRow>

      <SettingRow label={t("vacation.subject", { defaultValue: "Betreff" })}>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="pv-field" data-testid="vacation-subject" style={{ width: 220 }} />
      </SettingRow>

      <SettingRow label={t("vacation.message", { defaultValue: "Text" })}>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} className="pv-field pv-field--area" data-testid="vacation-message" rows={4} style={{ width: 320 }} />
      </SettingRow>

      <SettingRow label={t("vacation.from", { defaultValue: "Von" })} desc={t("vacation.windowHint", { defaultValue: "Ohne Zeitraum läuft die Notiz, bis Du sie ausschaltest." })}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="pv-field" data-testid="vacation-from" />
      </SettingRow>

      <SettingRow label={t("vacation.to", { defaultValue: "Bis" })}>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="pv-field" data-testid="vacation-to" />
      </SettingRow>

      <SettingRow label="">
        <Button variant="primary" disabled={busy} onClick={() => void save()} data-testid="vacation-save">
          {t("vacation.save", { defaultValue: "Beim Anbieter hinterlegen" })}
        </Button>
      </SettingRow>

      <SettingCardNote>
        <span data-testid="vacation-where">
        {support.kind === "graph"
          ? t("vacation.viaGraph", { defaultValue: "Die Notiz liegt bei Microsoft und antwortet, auch wenn Plainva geschlossen ist." })
          : t("vacation.viaSieve", {
              host: support.host,
              port: support.port === SIEVE_PORT ? "" : `:${support.port}`,
              defaultValue:
                "Die Notiz liegt als Filterregel auf {{host}}{{port}} und antwortet, auch wenn Plainva geschlossen ist. Plainva schreibt nur seinen eigenen, gekennzeichneten Abschnitt — von Hand geschriebene Regeln bleiben unangetastet.",
            })}
        </span>
      </SettingCardNote>
    </SettingCard>
  );
}
