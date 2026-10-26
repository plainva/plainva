import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChipField, SettingCard, SettingRow } from "@plainva/ui";
import { normalizeSenderAddress, senderOptions, updateMailAccount, type MailAccountConfig } from "@plainva/ui/mail";
import { ComposeEditor } from "./ComposeEditor";
import { Select } from "../Select";

/** Raw chip input into addresses. A paste of several at once is split on the
 * usual separators; the angle-bracket form `Name <a@b.c>` stays intact. */
function splitAddresses(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Sender and signature of ONE mailbox (issue #34 round 1, P8.2) - on the mail
 * page of its account since plan "Verbinden" (V3): what belongs to this
 * mailbox sits with this mailbox; what holds for every mailbox (rules,
 * out-of-office, the filing folder) stays on the E-Mail settings page.
 *
 * Not part of the connect flow: these are not credentials, and changing a
 * signature must never ask for a password again.
 */
export function MailSendingCard({ vaultPath, account, onChanged }: { vaultPath: string; account: MailAccountConfig; onChanged: () => void }) {
  const { t } = useTranslation();
  // "" is the account default - the value every address without its own signature uses.
  const [sigAddress, setSigAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [senders, setSenders] = useState<string[]>(account.senders ?? []);

  useEffect(() => { setSenders(account.senders ?? []); }, [account]);
  // The editor always shows the signature of the SELECTED address; switching
  // the address must not carry the previous text over.
  useEffect(() => {
    setSignature(sigAddress ? (account.signatures?.[normalizeSenderAddress(sigAddress)] ?? "") : (account.signature ?? ""));
  }, [account, sigAddress]);

  const persist = useCallback(async (patch: Partial<MailAccountConfig>) => {
    await updateMailAccount(vaultPath, account.id, patch);
    onChanged();
  }, [vaultPath, account.id, onChanged]);

  /** An emptied per-address signature is REMOVED - the address falls back to the default. */
  const persistSignature = useCallback(async (text: string) => {
    if (!sigAddress) {
      await persist({ signature: text });
      return;
    }
    const key = normalizeSenderAddress(sigAddress);
    const next = { ...(account.signatures ?? {}) };
    if (text.trim()) next[key] = text;
    else delete next[key];
    await persist({ signatures: next });
  }, [account.signatures, sigAddress, persist]);

  return (
    <SettingCard label={t("mail.sendingGroup")}>
      {senderOptions(account).length > 1 && (
        <SettingRow label={t("mail.signatureAddress")} desc={t("mail.signatureAddressHint")}>
          <Select
            value={sigAddress}
            onChange={setSigAddress}
            ariaLabel={t("mail.signatureAddress")}
            data-testid="mail-signature-address"
            options={[
              { value: "", label: t("mail.signatureDefault") },
              ...senderOptions(account).map((address) => ({
                value: address,
                label: account.signatures?.[normalizeSenderAddress(address)] ? `${address} ✓` : address,
              })),
            ]}
          />
        </SettingRow>
      )}
      <SettingRow label={t("mail.signature")} desc={t("mail.signatureHint")} wide>
        <div onBlur={() => void persistSignature(signature)}>
          <ComposeEditor value={signature} onChange={setSignature} resizable data-testid="mail-signature" />
        </div>
      </SettingRow>
      <SettingRow label={t("mail.senders")} desc={t("mail.sendersHint")} wide>
        <ChipField
          values={senders}
          onChange={(next) => {
            setSenders(next);
            void persist({ senders: next });
          }}
          parse={splitAddresses}
          removeLabel={(value) => t("mail.senderRemove", { email: value })}
          placeholder={t("mail.sendersPlaceholder")}
          testId="mail-senders"
          ariaLabel={t("mail.senders")}
        />
      </SettingRow>
    </SettingCard>
  );
}
