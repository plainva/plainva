import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, GroupCard, Row, RowList, accountServices, serviceCheckKey, type CloudAccountRecord, type CloudServiceId, type ServiceCheck } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { checkMobileAccount } from "../services/accountCheck";

/**
 * "Check connection" on the phone (account sign-in plan E6, mockup view 5):
 * the same rows as the desktop's dialog, as a sheet.
 */
export function AccountCheckSheet({
  vaultId,
  record,
  serviceLabel,
  onSignInAgain,
  onClose,
}: {
  vaultId: string;
  record: CloudAccountRecord;
  serviceLabel: (service: CloudServiceId) => string;
  onSignInAgain: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [results, setResults] = useState<ServiceCheck[] | null>(null);
  useEffect(() => {
    let alive = true;
    void checkMobileAccount(vaultId, record).then((checked) => { if (alive) setResults(checked); });
    return () => { alive = false; };
  }, [vaultId, record]);
  const oauth = record.family === "google" || record.family === "microsoft";
  const needsSignIn = oauth && !!results?.some((r) => r.state === "expired" || r.state === "notGranted");
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="cloudacct-check">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("cloudAccounts.checkConnection")}</p>
        <p className="m-hint">{record.label}</p>
        <GroupCard>
          <RowList>
            {(results ?? accountServices(record).map((service) => ({ service, state: "pending" as const }))).map((row) => (
              <Row
                key={row.service}
                data-testid={`cloudacct-check-${row.service}`}
                title={serviceLabel(row.service)}
                subtitle={row.state === "pending" ? t("cloudAccounts.checkRunning") : row.state === "failed" ? (row as ServiceCheck).detail : t(serviceCheckKey(row.state))}
                wrap
              />
            ))}
          </RowList>
        </GroupCard>
        {results && <p className="m-hint">{t("cloudAccounts.checkNoted")}</p>}
        {needsSignIn && (
          <Button variant="primary" data-testid="cloudacct-check-signin" onClick={() => { onClose(); onSignInAgain(); }}>
            {t("cloudAccounts.reconnect")}
          </Button>
        )}
      </div>
    </div>
  );
}
