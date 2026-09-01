import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share } from "@capacitor/share";
import { Copy } from "lucide-react";
import type { PublicationRecipient, WorkspacePublicationRecord } from "@plainva/core";
import { Banner, Button, ICON, IconButton, QrImage, Row, RowList, SettingField, TextInput, toast } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * Who may read one publication (M5) — the mobile shape of the desktop's
 * recipient list, on the same core calls and the same wording.
 *
 * The list comes from the PUBLICATION's own policy, never from the vault's
 * members. That separation is the promise Stufe B is built on: a recipient
 * holds a key for this folder and nothing else, and a screen that read the
 * vault's members here would quietly say otherwise.
 *
 * Inviting and withdrawing sit in one sheet on purpose. S6 built the way back
 * out on the desktop because a recipient who can be let in and never out is a
 * door without a handle on the inside; splitting the two across screens would
 * rebuild that asymmetry in the layout.
 */
export function PublicationRecipientsSheet({
  record,
  recipients,
  locked,
  busy,
  onClose,
  onInvite,
  onRevoke,
}: {
  record: WorkspacePublicationRecord;
  recipients: PublicationRecipient[];
  /** The publication's key is not on this device — read-only, with a reason. */
  locked: boolean;
  busy: boolean;
  onClose: () => void;
  /** Resolves with the code to show once; it is derived, never stored. */
  onInvite: (displayName: string) => Promise<{ memberId: string; invite: string }>;
  onRevoke: (memberId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<{ displayName: string; memberId: string; invite: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Aimed at exactly one person: a shared confirm flag would let a second tap
     land on whichever row happened to be under the finger. */
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  useEffect(() => { setConfirmRevoke(null); }, [recipients]);

  const invite = () => {
    const displayName = name.trim();
    if (!displayName || busy) return;
    setError(null);
    void onInvite(displayName)
      .then((result) => { setMinted({ displayName, ...result }); setName(""); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const revoke = (memberId: string) => {
    if (busy) return;
    if (confirmRevoke !== memberId) { setConfirmRevoke(memberId); return; }
    setError(null);
    setConfirmRevoke(null);
    void onRevoke(memberId).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid="publication-recipients-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("workspaceSecurity.publicationRecipients", { defaultValue: "Recipients" })}</p>
        <p className="m-hint">{record.config.name}</p>

        {locked ? (
          <Banner kind="info" rounded>
            {t("workspaceSecurity.publicationLocked", {
              defaultValue:
                "This device does not hold the key for this publication, so its recipients cannot be read or changed here.",
            })}
          </Banner>
        ) : minted ? (
          /* Shown once, then gone from the screen — but recoverable: the code is
             derived from the member id, the workspace id and the genesis
             fingerprint, so inviting the same person again mints the same code
             rather than a second way in. */
          <>
            <Banner kind="info" rounded>
              {t("workspaceSecurity.publicationRecipientHint", {
                defaultValue:
                  "The recipient gets a key for this publication. It does not open the vault, and it stops working as soon as you withdraw them.",
              })}
            </Banner>
            <div className="m-pairing">
              <div className="m-pairing-qr">
                <QrImage
                  value={minted.invite}
                  label={t("workspaceSecurity.inviteCode", { defaultValue: "Invitation code" })}
                />
                <p className="m-onramp-sub">
                  {t("workspaceSecurity.inviteQrCaption", {
                    defaultValue: "Or scan this code with the Plainva app on your other device",
                  })}
                </p>
              </div>
              <div className="m-codefield">
                <span className="m-codefield-label">{t("workspaceSecurity.inviteCode", { defaultValue: "Invitation code" })}</span>
                <div className="m-codefield-row">
                  <code className="m-code" data-testid="publication-invite-code">{minted.invite}</code>
                  <IconButton
                    label={t("workspaceSecurity.copyInvite", { defaultValue: "Copy invitation" })}
                    onClick={() => void navigator.clipboard.writeText(minted.invite)
                      .then(() => toast.info(t("workspaceSecurity.copied")))}
                  ><Copy size={ICON.head} /></IconButton>
                </div>
              </div>
              <div className="m-codefield">
                <span className="m-codefield-label">{t("workspaceSecurity.memberIdFull", { defaultValue: "Member ID" })}</span>
                <code className="m-code">{minted.memberId}</code>
              </div>
            </div>
            <div className="m-btnrow">
              <Button variant="ghost" onClick={() => setMinted(null)}>{t("common.close", { defaultValue: "Close" })}</Button>
              {/* The phone's own way of handing something over — the same sheet
                  every other export in this app uses (M5). */}
              <Button
                variant="primary"
                data-testid="publication-invite-share"
                onClick={() => void Share.share({
                  title: record.config.name,
                  text: minted.invite,
                  dialogTitle: t("mobile.share"),
                }).catch(() => { /* user cancelled the system sheet */ })}
              >
                {t("mobile.share")}
              </Button>
            </div>
          </>
        ) : (
          <>
            {recipients.length === 0 ? (
              <p className="m-hint">
                {t("workspaceSecurity.publicationNoRecipients", {
                  defaultValue:
                    "Nobody has been invited yet. A publication without recipients is encrypted and unreadable - that is the safe state, not a broken one.",
                })}
              </p>
            ) : (
              /* One row per person rather than a joined string: a name you
                 cannot act on is a list, and withdrawing has to be aimed at
                 exactly one recipient. */
              <RowList>
                {recipients.map((person) => (
                  <Row
                    key={person.memberId}
                    subtitle={`${person.state} · ${person.memberId.slice(0, 12)}`}
                    title={person.displayName}
                    end={person.state === "active" ? (
                      <span className="m-revoke">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          data-testid="publication-revoke-recipient"
                          onClick={() => revoke(person.memberId)}
                        >
                          {busy && confirmRevoke === null ? <span className="m-actionspin" aria-hidden /> : null}
                          <span className="m-danger">
                            {confirmRevoke === person.memberId
                              ? t("common.confirm", { defaultValue: "Confirm" })
                              : t("workspaceSecurity.revokeRecipient", { defaultValue: "Withdraw access" })}
                          </span>
                        </Button>
                      </span>
                    ) : undefined}
                  />
                ))}
              </RowList>
            )}

            {/* Stated before the tap, not after it: what a withdrawal can and
                cannot buy. The object store is put-only. */}
            {confirmRevoke && (
              <Banner kind="warning" rounded>
                {t("workspaceSecurity.withdrawBoundary", {
                  defaultValue:
                    "Withdrawing does not take back what someone already has. Whoever copied the bytes and holds the key can still read them. What it does: from now on nothing new reaches them, and the next epoch is unreadable for them.",
                })}
              </Banner>
            )}

            <RowList>
              <SettingField label={t("workspaceSecurity.name")}>
                <TextInput
                  value={name}
                  disabled={busy}
                  data-testid="publication-recipient-name"
                  onChange={(event) => setName(event.target.value)}
                />
              </SettingField>
            </RowList>
            <div className="m-btnrow">
              <Button variant="ghost" disabled={busy} onClick={onClose}>{t("common.close", { defaultValue: "Close" })}</Button>
              <Button
                variant="primary"
                disabled={busy || !name.trim()}
                data-testid="publication-invite-recipient"
                onClick={invite}
              >
                {busy ? <span className="m-actionspin" aria-hidden /> : null}
                {t("workspaceSecurity.inviteRecipient", { defaultValue: "Invite recipient" })}
              </Button>
            </div>
          </>
        )}

        {error && <Banner kind="error" rounded>{error}</Banner>}
      </div>
    </div>
  );
}
