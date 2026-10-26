import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, GroupCard, Row, RowList, accountServices, serviceCheckAction, serviceCheckText, type CloudAccountRecord, type CloudServiceId, type ServiceCheck } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { checkMobileAccount, type CheckedCard } from "../services/accountCheck";

/**
 * "Check connection" on the phone (account sign-in plan E6, mockup view 5):
 * the same rows as the desktop's dialog, as a sheet.
 *
 * Every row that does not work carries its action (plan "Verbinden", V0):
 * sign in, sign in again, or - where this phone cannot sign the card in from
 * here - the service's own settings. Only a lapsed or ungranted row offered
 * one before; a row that just failed was a dead end.
 */
export function AccountCheckSheet({
  vaultId,
  record,
  card,
  canSignIn,
  standardAvailable = false,
  onUseStandard,
  serviceLabel,
  onSignInAgain,
  onOpenService,
  onClose,
}: {
  vaultId: string;
  record: CloudAccountRecord;
  /** What the account page shows - the calendar row it names, its services. */
  card?: CheckedCard;
  canSignIn: boolean;
  /** This phone uses an own client and the build carries the standard one. */
  standardAvailable?: boolean;
  onUseStandard?: () => void;
  serviceLabel: (service: CloudServiceId) => string;
  onSignInAgain: () => void;
  onOpenService: (service: CloudServiceId) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [results, setResults] = useState<ServiceCheck[] | null>(null);
  useEffect(() => {
    let alive = true;
    void checkMobileAccount(vaultId, record, card).then((checked) => { if (alive) setResults(checked); });
    return () => { alive = false; };
  }, [vaultId, record, card]);
  const shown = (["files", "calendar", "mail"] as const).filter((service) => card?.services?.includes(service) || accountServices(record).includes(service));
  const pending = shown.map((service) => ({ service, state: "pending" as const }));
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="cloudacct-check">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("cloudAccounts.checkConnection")}</p>
        <p className="m-hint">{record.label}</p>
        <GroupCard>
          <RowList>
            {(results ?? pending).map((row) => {
              const action = row.state === "pending" ? null : serviceCheckAction(row, canSignIn, standardAvailable && !!onUseStandard);
              return (
                <Row
                  key={row.service}
                  data-testid={`cloudacct-check-${row.service}`}
                  data-state={row.state}
                  title={serviceLabel(row.service)}
                  subtitle={row.state === "pending" ? t("cloudAccounts.checkRunning") : serviceCheckText(row, (key) => t(key))}
                  wrap
                  end={action && (
                    <Button
                      size="sm"
                      variant="tonal"
                      data-testid={action === "openService" ? `cloudacct-check-open-${row.service}` : action === "useStandard" ? "cloudacct-check-standard" : "cloudacct-check-signin"}
                      onClick={() => {
                        if (action === "openService") onOpenService(row.service);
                        else if (action === "useStandard") onUseStandard?.();
                        else { onClose(); onSignInAgain(); }
                      }}
                    >
                      {t(action === "signIn" ? "deviceSignIn.submit" : action === "signInAgain" ? "cloudAccounts.reconnect" : action === "useStandard" ? "accountAccess.useStandard" : "settings.title")}
                    </Button>
                  )}
                />
              );
            })}
          </RowList>
        </GroupCard>
        {results && <p className="m-hint">{t("cloudAccounts.checkNoted")}</p>}
      </div>
    </div>
  );
}
