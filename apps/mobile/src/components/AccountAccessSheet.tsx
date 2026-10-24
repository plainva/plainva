import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OAuthAccessEditor, plainvaGoogleClient, type OAuthFamily, type StoredOAuthAccess } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { devicePlatform, readDeviceAccess, saveDeviceAccess } from "../services/accountSignIn";

/**
 * This phone's access for Google or Microsoft (account sign-in plan E3), as a
 * sheet: the same editor as on the desktop, asking what a phone needs - for
 * an own Google project a client of type iOS, without a secret.
 *
 * It replaces the client-id sheet that asked for "the account's" client: a
 * client belongs to a device type, not to an account (finding 2026-10-23).
 */
export function AccountAccessSheet({
  family,
  onCancel,
  onSaved,
}: {
  family: OAuthFamily;
  onCancel: () => void;
  /** Called once the choice is stored; the caller usually signs in again. */
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<StoredOAuthAccess | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void readDeviceAccess(family).then((stored) => { if (alive) setValue(stored); });
    return () => { alive = false; };
  }, [family]);
  const platform = devicePlatform();
  return (
    <div className="m-sheet-backdrop" onClick={onCancel}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="account-access-sheet">
        <SheetGrip onClose={onCancel} />
        <p className="m-sheet-title">{t(family === "google" ? "accountAccess.title.google" : "accountAccess.title.microsoft")}</p>
        {value !== undefined && (
          <OAuthAccessEditor
            family={family}
            platform={platform}
            value={value}
            plainvaAvailable={family === "microsoft" || !!plainvaGoogleClient(import.meta.env as unknown as Record<string, unknown>, platform)}
            onSave={async (next) => {
              await saveDeviceAccess(family, next);
              onSaved();
            }}
            onCancel={onCancel}
          />
        )}
      </div>
    </div>
  );
}
